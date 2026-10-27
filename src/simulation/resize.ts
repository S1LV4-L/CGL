import { createSimulation } from "./life.ts";
import type { Board } from "./life.ts";

export const MAX_BOARD_SIDE = 12699;
export const MAX_BOARD_CELLS = 160667748;

export function validBoardSize(columns: number, rows: number): boolean {
    return Number.isInteger(columns) && Number.isInteger(rows)
        && columns >= 1 && rows >= 1 && columns <= MAX_BOARD_SIDE && rows <= MAX_BOARD_SIDE
        && columns * rows <= MAX_BOARD_CELLS;
}

/** Conserva la intersección centrada. Al reducir, se recortan los bordes. */
export function resizeSimulation(board: Board, oldColumns: number, oldRows: number, columns: number, rows: number) {
    const simulation = createSimulation(columns, rows);
    const width = Math.min(oldColumns, columns);
    const height = Math.min(oldRows, rows);
    const sourceX = Math.floor((oldColumns - width) / 2);
    const sourceY = Math.floor((oldRows - height) / 2);
    const targetX = Math.floor((columns - width) / 2);
    const targetY = Math.floor((rows - height) / 2);
    for (let y = 0; y < height; y++) {
        const start = (sourceY + y) * oldColumns + sourceX;
        simulation.board.set(board.subarray(start, start + width), (targetY + y) * columns + targetX);
    }
    return simulation;
}
