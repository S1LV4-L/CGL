import type { Board } from "../simulation/life.ts";

const ALIVE = 0xffffffff;
const DEAD = 0xff000000;

export function createBoardRenderer(
  canvas: HTMLCanvasElement,
  gridCanvas: HTMLCanvasElement,
  columns: number,
  rows: number,
  cellSize: number,
) {
  // El canvas visible mide 1 px por célula; el tamaño en pantalla lo da el CSS.
  canvas.width = columns;
  canvas.height = rows;
  canvas.style.width = `${columns * cellSize}px`;
  canvas.style.height = `${rows * cellSize}px`;
  canvas.style.imageRendering = "pixelated";

  const context = canvas.getContext("2d", { alpha: false });
  const gridContext = gridCanvas.getContext("2d");
  if (!context || !gridContext) return null;

  const total = columns * rows;
  const width = columns * cellSize;
  const height = rows * cellSize;

  const image = context.createImageData(columns, rows);
  const pixels = new Uint32Array(image.data.buffer);
  pixels.fill(DEAD);

  // Rejilla estática (sin cambios respecto a la versión anterior).
  gridContext.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  if (cellSize >= 4) {
    gridContext.strokeStyle = "rgba(128,128,128,0.35)";
    gridContext.lineWidth = 1;
    gridContext.beginPath();
    for (let x = 0; x <= columns; x++) {
      const px = x * cellSize + 0.5;
      gridContext.moveTo(px, 0);
      gridContext.lineTo(px, height);
    }
    for (let y = 0; y <= rows; y++) {
      const py = y * cellSize + 0.5;
      gridContext.moveTo(0, py);
      gridContext.lineTo(width, py);
    }
    gridContext.stroke();
  }

  let frameId: number | null = null;
  let latestBoard: Board | null = null;
  let needsFullRedraw = false;
  let disposed = false;
  const dirtyCells = new Set<number>();

  const flush = () => {
    frameId = null;
    if (!latestBoard || disposed) return;
    const board = latestBoard;

    if (needsFullRedraw) {
      for (let i = 0; i < total; i++) {
        pixels[i] = board[i] === 1 ? ALIVE : DEAD;
      }
      // Directo al canvas visible, sin drawImage ni escalado.
      context.putImageData(image, 0, 0);
    } else {
      for (const index of dirtyCells) {
        const alive = board[index] === 1;
        pixels[index] = alive ? ALIVE : DEAD;
        context.fillStyle = alive ? "white" : "black";
        context.fillRect(index % columns, (index / columns) | 0, 1, 1);
      }
    }

    needsFullRedraw = false;
    dirtyCells.clear();
  };

  function schedule() {
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