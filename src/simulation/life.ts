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

/** Dos buffers y un borde auxiliar; toda la memoria se reserva al crear el motor. */
export function createSimulation(columns: number, rows: number) {
    let currentBoard: Board = new Uint8Array(columns * rows);
    let nextBoard: Board = new Uint8Array(columns * rows);
    const stride = columns + 2;
    const halo = new Uint8Array(stride * (rows + 2));

    function refreshHalo() {
        // El tablero público sigue siendo plano y sin bordes. Copiamos su contenido
        // al interior del auxiliar y envolvemos los extremos una vez por generación.
        for (let y = 0; y < rows; y++) {
            const sourceRow = y * columns;
            const haloRow = (y + 1) * stride;
            for (let x = 0; x < columns; x++) {
                halo[haloRow + x + 1] = currentBoard[sourceRow + x];
            }
            halo[haloRow] = currentBoard[sourceRow + columns - 1];
            halo[haloRow + columns + 1] = currentBoard[sourceRow];
        }

        // Copiamos filas completas, incluidas las esquinas ya envueltas.
        const lastRow = rows * stride;
        const bottomBorder = (rows + 1) * stride;
        for (let x = 0; x < stride; x++) {
            halo[x] = halo[lastRow + x];
            halo[bottomBorder + x] = halo[stride + x];
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
            return true;
        },

        step(mode: GameMode, allowMutation: boolean, random = Math.random) {
            refreshHalo();
            const rule = mode === "conway" ? CONWAY_RULE : SEEDS_RULE;

            for (let y = 0; y < rows; y++) {
                let index = y * columns;
                let center = (y + 1) * stride + 1;
                for (let x = 0; x < columns; x++) {
                    const above = center - stride;
                    const below = center + stride;
                    // Ocho lecturas directas: sin módulos, bucles de vecinos ni
                    // condiciones de borde dentro del recorrido de las células.
                    const neighbors = halo[above - 1] + halo[above] + halo[above + 1]
                        + halo[center - 1] + halo[center + 1]
                        + halo[below - 1] + halo[below] + halo[below + 1];

                    // Escribimos TODAS las células, incluidos los ceros. El buffer
                    // destino contiene una generación antigua y no se limpia ni copia.
                    nextBoard[index] = rule[halo[center] * 9 + neighbors];
                    index++;
                    center++;
                }
            }

            // Solo se recorre para mutar cuando está activado. Conserva el mismo
            // orden de llamadas a random y el mismo umbral del motor anterior.
            if (allowMutation) {
                for (let index = 0; index < nextBoard.length; index++) {
                    if (random() < 0.0001) nextBoard[index] = 1 - nextBoard[index];
                }
            }

            // Solo intercambiamos referencias cuando terminó la generación completa.
            // El intercambio no copia datos ni crea arrays.
            const previousBoard = currentBoard;
            currentBoard = nextBoard;
            nextBoard = previousBoard;
        },

        reset() {
            currentBoard.fill(0);
            nextBoard.fill(0);
            halo.fill(0);
        },
    };
}
