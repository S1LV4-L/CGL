/** Una célula ocupa un byte: 0 = muerta, 1 = viva. Índice: y * ancho + x. */
export type Board = Uint8Array;
export type GameMode = "conway" | "seeds";

// Tabla de 18 resultados: nueve conteos posibles para muertas y nueve para vivas.
// Índice: estadoActual * 9 + vecinos. Se construyen una sola vez por módulo.
const CONWAY_RULE = new Uint8Array(18);
CONWAY_RULE[3] = 1; // B3
CONWAY_RULE[9 + 2] = 1; // S23
CONWAY_RULE[9 + 3] = 1;
const SEEDS_RULE = new Uint8Array(18);
SEEDS_RULE[2] = 1; // B2/S0

/** Copia editable de las reglas de un modo predefinido. */
export function getPresetRule(mode: GameMode): Uint8Array {
    return (mode === "conway" ? CONWAY_RULE : SEEDS_RULE).slice();
}

export function formatRule(rule: Uint8Array): string {
    const counts = (offset: number) => Array.from({ length: 9 }, (_, n) => rule[offset + n] ? n : "").join("");
    return `B${counts(0)}/S${counts(9)}`;
}

export function getRuleMode(rule: Uint8Array): GameMode | "custom" {
    const notation = formatRule(rule);
    return notation === "B3/S23" ? "conway" : notation === "B2/S" ? "seeds" : "custom";
}

/** Dos buffers planos; toda la memoria se reserva al crear el motor. */
export function createSimulation(columns: number, rows: number) {
    let currentBoard: Board = new Uint8Array(columns * rows);
    let nextBoard: Board = new Uint8Array(columns * rows);

    // Actividad por CAMBIO, no por ocupación:
    //  - dirty[t]   = la tesela t debe recalcularse en el próximo paso.
    //  - changed[t] = la tesela t cambió en el paso que se está calculando.
    // Invariante: una tesela que se omite es idéntica en ambos buffers, así que
    // no hace falta limpiar ni copiar nada para ella.
    const tileSize = 32;
    const tileColumns = Math.ceil(columns / tileSize);
    const tileRows = Math.ceil(rows / tileSize);
    const tileCount = tileColumns * tileRows;
    const dirty = new Uint8Array(tileCount).fill(1);
    const changed = new Uint8Array(tileCount);
    let lastRuleKey = -1;

    /** Marca la tesela y sus 8 vecinas (con envoltura toroidal). */
    function wake(target: Uint8Array, tx: number, ty: number) {
        for (let dy = -1; dy <= 1; dy++) {
            const row = ((ty + dy + tileRows) % tileRows) * tileColumns;
            for (let dx = -1; dx <= 1; dx++) target[row + (tx + dx + tileColumns) % tileColumns] = 1;
        }
    }

    function ruleKey(rule: Uint8Array) {
        let key = 0;
        for (let i = 0; i < 18; i++) if (rule[i]) key |= 1 << i;
        return key;
    }

    // Solo los extremos de cada fila necesitan envolver las columnas.
    // Devuelve 1 si la célula cambió.
    function updateEdge(row: number, above: number, below: number, x: number,
        left: number, right: number, rule: Uint8Array) {
        const alive = currentBoard[row + x];
        const neighbors = currentBoard[above + left] + currentBoard[above + x] + currentBoard[above + right]
            + currentBoard[row + left] + currentBoard[row + right]
            + currentBoard[below + left] + currentBoard[below + x] + currentBoard[below + right];
        const value = rule[alive * 9 + neighbors];
        nextBoard[row + x] = value;
        return value ^ alive;
    }

    /** Calcula una región y devuelve distinto de 0 si alguna célula cambió. */
    function updateRegion(left: number, right: number, top: number, bottom: number, rule: Uint8Array) {
        const cur = currentBoard;
        const next = nextBoard;
        let diff = 0;
        for (let y = top; y < bottom; y++) {
            const row = y * columns;
            let above = y === 0 ? (rows - 1) * columns : row - columns;
            let below = y === rows - 1 ? 0 : row + columns;
            if (left === 0) diff |= updateEdge(row, above, below, 0, columns - 1, columns === 1 ? 0 : 1, rule);
            if (right === columns && columns > 1) diff |= updateEdge(row, above, below, columns - 1, columns - 2, 0, rule);
            const startX = Math.max(1, left);
            const endX = Math.min(columns - 1, right);
            if (startX >= endX) continue;

            // Ventana de tres sumas verticales, también en el borde de una tesela.
            let leftSum = cur[above + startX - 1] + cur[row + startX - 1] + cur[below + startX - 1];
            let index = row + startX;
            above += startX;
            below += startX;
            let alive = cur[index];
            let centerSum = cur[above] + alive + cur[below];
            const end = row + endX;
            for (; index < end; index++, above++, below++) {
                const rightCell = cur[index + 1];
                const rightSum = cur[above + 1] + rightCell + cur[below + 1];
                const neighbors = leftSum + centerSum + rightSum - alive;
                const value = rule[alive * 9 + neighbors];
                next[index] = value;
                diff |= value ^ alive;
                leftSum = centerSum;
                centerSum = rightSum;
                alive = rightCell;
            }
        }
        return diff;
    }

    // Motor de referencia por bytes. Mantiene la semántica Bernoulli histórica;
    // la aplicación usa PackedLife con muestreo geométrico equivalente.
    function mutate(random: () => number) {
        for (let index = 0; index < nextBoard.length; index++) {
            if (random() >= 0.0001) continue;
            nextBoard[index] ^= 1;
            const y = Math.floor(index / columns);
            const x = index - y * columns;
            changed[Math.floor(y / tileSize) * tileColumns + Math.floor(x / tileSize)] = 1;
        }
    }

    return {
        // Leer esta propiedad después de cada paso: el buffer actual va alternando.
        get board(): Board {
            return currentBoard;
        },

        // La edición siempre apunta al buffer vigente, incluso después de un paso.
        setCell(x: number, y: number, value: 0 | 1) {
            const index = y * columns + x;
            if (currentBoard[index] === value) return false;
            currentBoard[index] = value;
            wake(dirty, Math.floor(x / tileSize), Math.floor(y / tileSize));
            return true;
        },

        /** Llamar si se modificó `board` directamente sin pasar por setCell. */
        invalidate() {
            dirty.fill(1);
        },

        step(mode: GameMode | Uint8Array, allowMutation: boolean, random = Math.random) {
            const rule = typeof mode === "string" ? (mode === "conway" ? CONWAY_RULE : SEEDS_RULE) : mode;

            // Si cambia la regla, lo que era estable ya no tiene por qué serlo.
            const key = ruleKey(rule);
            if (key !== lastRuleKey) {
                lastRuleKey = key;
                dirty.fill(1);
            }

            changed.fill(0);
            for (let ty = 0; ty < tileRows; ty++) {
                for (let tx = 0; tx < tileColumns; tx++) {
                    const tile = ty * tileColumns + tx;
                    if (!dirty[tile]) continue;
                    const left = tx * tileSize;
                    const top = ty * tileSize;
                    if (updateRegion(left, Math.min(columns, left + tileSize),
                        top, Math.min(rows, top + tileSize), rule)) changed[tile] = 1;
                }
            }
            if (allowMutation) mutate(random);

            const previousBoard = currentBoard;
            currentBoard = nextBoard;
            nextBoard = previousBoard;

            // Próximo paso: teselas que cambiaron + vecinas.
            dirty.fill(0);
            for (let ty = 0; ty < tileRows; ty++) {
                for (let tx = 0; tx < tileColumns; tx++) {
                    if (changed[ty * tileColumns + tx]) wake(dirty, tx, ty);
                }
            }
        },

        reset() {
            currentBoard.fill(0);
            nextBoard.fill(0);
            dirty.fill(1);
        },
    };
}
