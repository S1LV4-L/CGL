// Referencia congelada del motor sin halo, antes de reutilizar sumas de vecinos.
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

    // Solo los extremos de cada fila necesitan envolver las columnas.
    function updateEdge(row: number, above: number, below: number, x: number,
        left: number, right: number, rule: Uint8Array) {
        const neighbors = currentBoard[above + left] + currentBoard[above + x] + currentBoard[above + right]
            + currentBoard[row + left] + currentBoard[row + right]
            + currentBoard[below + left] + currentBoard[below + x] + currentBoard[below + right];
        nextBoard[row + x] = rule[currentBoard[row + x] * 9 + neighbors];
    }

    function finishStep(allowMutation: boolean, random: () => number) {
        if (allowMutation) {
            for (let index = 0; index < nextBoard.length; index++) {
                if (random() < 0.0001) nextBoard[index] = 1 - nextBoard[index];
            }
        }
        const previousBoard = currentBoard;
        currentBoard = nextBoard;
        nextBoard = previousBoard;
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
            return true;
        },

        step(mode: GameMode | Uint8Array, allowMutation: boolean, random = Math.random) {
            const rule = typeof mode === "string" ? (mode === "conway" ? CONWAY_RULE : SEEDS_RULE) : mode;

            for (let y = 0; y < rows; y++) {
                const row = y * columns;
                let above = y === 0 ? (rows - 1) * columns : row - columns;
                let below = y === rows - 1 ? 0 : row + columns;
                updateEdge(row, above, below, 0, columns - 1, columns === 1 ? 0 : 1, rule);
                if (columns > 1) updateEdge(row, above, below, columns - 1, columns - 2, 0, rule);

                // Interior sin copias, módulos ni condiciones de borde por célula.
                let index = row + 1;
                above++;
                below++;
                const end = row + columns - 1;
                for (; index < end; index++, above++, below++) {
                    const neighbors = currentBoard[above - 1] + currentBoard[above] + currentBoard[above + 1]
                        + currentBoard[index - 1] + currentBoard[index + 1]
                        + currentBoard[below - 1] + currentBoard[below] + currentBoard[below + 1];

                    // Escribimos TODAS las células, incluidos los ceros. El buffer
                    // destino contiene una generación antigua y no se limpia ni copia.
                    nextBoard[index] = rule[currentBoard[index] * 9 + neighbors];
                }
            }

            finishStep(allowMutation, random);
        },

        reset() {
            currentBoard.fill(0);
            nextBoard.fill(0);
        },
    };
}
