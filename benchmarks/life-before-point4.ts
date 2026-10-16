// Referencia congelada del motor anterior al punto 4, solo para benchmarks.
// La aplicación importa exclusivamente src/simulation/life.ts.
/** Una célula ocupa un byte: 0 = muerta, 1 = viva. Índice: y * ancho + x. */
export type Board = Uint8Array;
export type GameMode = "conway" | "seeds";

/** Dos buffers por simulación; step y reset reutilizan siempre la misma memoria. */
export function createSimulation(columns: number, rows: number) {
    let currentBoard: Board = new Uint8Array(columns * rows);
    let nextBoard: Board = new Uint8Array(columns * rows);

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
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < columns; x++) {
                    let neighbors = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            // Se conservan los bordes toroidales del motor anterior.
                            const nx = (x + dx + columns) % columns;
                            const ny = (y + dy + rows) % rows;
                            neighbors += currentBoard[ny * columns + nx];
                        }
                    }

                    const index = y * columns + x;
                    const alive = currentBoard[index] === 1;
                    const survives = mode === "conway"
                        ? neighbors === 3 || (alive && neighbors === 2)
                        : !alive && neighbors === 2;

                    // Escribimos TODAS las células, incluidos los ceros. El buffer
                    // destino contiene una generación antigua y no se limpia ni copia.
                    let value = survives ? 1 : 0;
                    if (allowMutation && random() < 0.0001) value = 1 - value;
                    nextBoard[index] = value;
                }
            }

            // Solo intercambiamos referencias cuando terminó la generación completa.
            // No hay copias ni arrays nuevos por paso.
            const previousBoard = currentBoard;
            currentBoard = nextBoard;
            nextBoard = previousBoard;
        },

        reset() {
            currentBoard.fill(0);
            nextBoard.fill(0);
        },
    };
}
