import type { Board } from "../simulation/life.ts";

/** El renderer solo lee el tablero; nunca modifica los buffers de simulación. */
export function createBoardRenderer(
    canvas: HTMLCanvasElement,
    gridCanvas: HTMLCanvasElement,
    columns: number,
    rows: number,
    cellSize: number,
) {
    const context = canvas.getContext("2d");
    const gridContext = gridCanvas.getContext("2d");
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = columns;
    imageCanvas.height = rows;
    const imageContext = imageCanvas.getContext("2d");
    if (!context || !gridContext || !imageContext) return null;

    // Un píxel RGBA por célula. Se reutiliza la misma imagen en cada generación.
    const image = imageContext.createImageData(columns, rows);
    context.imageSmoothingEnabled = false;

    // Capa transparente estática: las líneas no se vuelven a trazar al editar.
    gridContext.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
    gridContext.strokeStyle = "gray";
    gridContext.lineWidth = 0.1;
    gridContext.beginPath();
    for (let x = 0; x <= columns; x++) {
        gridContext.moveTo(x * cellSize, 0);
        gridContext.lineTo(x * cellSize, rows * cellSize);
    }
    for (let y = 0; y <= rows; y++) {
        gridContext.moveTo(0, y * cellSize);
        gridContext.lineTo(columns * cellSize, y * cellSize);
    }
    gridContext.stroke();

    let frameId: number | null = null;
    let latestBoard: Board | null = null;
    let needsFullRedraw = false;
    let disposed = false;
    const dirtyCells = new Set<number>();

    const flush = () => {
        frameId = null;
        if (!latestBoard || disposed) return;

        if (needsFullRedraw) {
            for (let index = 0; index < columns * rows; index++) {
                const offset = index * 4;
                const color = latestBoard[index] === 1 ? 255 : 0;
                image.data[offset] = color;
                image.data[offset + 1] = color;
                image.data[offset + 2] = color;
                image.data[offset + 3] = 255;
            }
            imageContext.putImageData(image, 0, 0);
            context.drawImage(imageCanvas, 0, 0, columns * cellSize, rows * cellSize);
        } else {
            // Durante la edición no recorremos el tablero ni subimos la imagen completa.
            // La próxima generación reconstruirá ImageData desde el tablero vigente.
            for (const index of dirtyCells) {
                const x = index % columns;
                const y = Math.floor(index / columns);
                context.fillStyle = latestBoard[index] === 1 ? "white" : "black";
                context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
        }

        needsFullRedraw = false;
        dirtyCells.clear();
    };

    function schedule() {
        // Todos los eventos previos al siguiente cuadro comparten una actualización.
        if (!disposed && frameId === null) frameId = requestAnimationFrame(flush);
    }

    return {
        renderBoard(board: Board) {
            latestBoard = board;
            needsFullRedraw = true;
            dirtyCells.clear();
            schedule();
        },
        renderCell(board: Board, x: number, y: number) {
            latestBoard = board;
            if (!needsFullRedraw) dirtyCells.add(y * columns + x);
            schedule();
        },
        dispose() {
            disposed = true;
            if (frameId !== null) cancelAnimationFrame(frameId);
            frameId = null;
            latestBoard = null;
            dirtyCells.clear();
        },
    };
}
