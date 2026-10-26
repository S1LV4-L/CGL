import type { Board } from "../simulation/life.ts";
import type { Camera } from "./camera.ts";

/** Los canvas solo ocupan el área visible, independientemente del tablero. */
export function createBoardRenderer(
    canvas: HTMLCanvasElement,
    gridCanvas: HTMLCanvasElement,
    columns: number,
    rows: number,
    cellSize: number,
) {
    const context = canvas.getContext("2d", { alpha: false });
    const grid = gridCanvas.getContext("2d");
    if (!context || !grid) return null;
    let camera: Camera = { x: columns / 2, y: rows / 2, scale: cellSize };
    let latestBoard: Board | null = null;
    let frameId: number | null = null;
    let disposed = false;
    let gridDirty = true;

    const flush = () => {
        frameId = null;
        if (!latestBoard || disposed) return;
        const { scale } = camera;
        const left = canvas.width / 2 - camera.x * scale;
        const top = canvas.height / 2 - camera.y * scale;
        const minX = Math.max(0, Math.floor(-left / scale));
        const minY = Math.max(0, Math.floor(-top / scale));
        const maxX = Math.min(columns, Math.ceil((canvas.width - left) / scale));
        const maxY = Math.min(rows, Math.ceil((canvas.height - top) / scale));
        context.fillStyle = "#17202a";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "black";
        context.fillRect(left, top, columns * scale, rows * scale);
        context.fillStyle = "white";
        for (let y = minY; y < maxY; y++) {
            const row = y * columns;
            for (let x = minX; x < maxX; x++) {
                if (!latestBoard[row + x]) continue;
                const px = Math.floor(left + x * scale);
                const py = Math.floor(top + y * scale);
                // Incluso al alejar, una célula viva ocupa como mínimo un píxel.
                context.fillRect(px, py, Math.max(1, Math.ceil(left + (x + 1) * scale) - px),
                    Math.max(1, Math.ceil(top + (y + 1) * scale) - py));
            }
        }
        if (gridDirty) {
            grid.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
            if (scale >= 6 && minX <= maxX && minY <= maxY) {
                grid.strokeStyle = "rgba(128,128,128,0.35)";
                grid.lineWidth = 1;
                grid.beginPath();
                for (let x = minX; x <= maxX; x++) {
                    const px = Math.floor(left + x * scale) + 0.5;
                    grid.moveTo(px, Math.max(0, top));
                    grid.lineTo(px, Math.min(canvas.height, top + rows * scale));
                }
                for (let y = minY; y <= maxY; y++) {
                    const py = Math.floor(top + y * scale) + 0.5;
                    grid.moveTo(Math.max(0, left), py);
                    grid.lineTo(Math.min(canvas.width, left + columns * scale), py);
                }
                grid.stroke();
            }
            gridDirty = false;
        }
    };

    function schedule() {
        if (!disposed && frameId === null) frameId = requestAnimationFrame(flush);
    }

    return {
        renderBoard(board: Board) { latestBoard = board; schedule(); },
        renderCell(board: Board) { latestBoard = board; schedule(); },
        setView(nextCamera: Camera) { camera = nextCamera; gridDirty = true; schedule(); },
        resize(width: number, height: number) {
            canvas.width = gridCanvas.width = Math.max(1, Math.round(width));
            canvas.height = gridCanvas.height = Math.max(1, Math.round(height));
            gridDirty = true;
            schedule();
        },
        dispose() {
            disposed = true;
            if (frameId !== null) cancelAnimationFrame(frameId);
            frameId = null;
            latestBoard = null;
        },
    };
}
