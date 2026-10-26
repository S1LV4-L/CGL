export type Camera = { x: number; y: number; scale: number };
export type ViewSize = { width: number; height: number };
export const MIN_SCALE = 0.005;
export const MAX_SCALE = 40;

export function screenToCell(x: number, y: number, camera: Camera, view: ViewSize) {
    return {
        x: (x - view.width / 2) / camera.scale + camera.x,
        y: (y - view.height / 2) / camera.scale + camera.y,
    };
}

export function zoomAt(camera: Camera, view: ViewSize, x: number, y: number, factor: number): Camera {
    const anchor = screenToCell(x, y, camera, view);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale * factor));
    return {
        x: anchor.x - (x - view.width / 2) / scale,
        y: anchor.y - (y - view.height / 2) / scale,
        scale,
    };
}

export function fitCamera(columns: number, rows: number, view: ViewSize): Camera {
    return {
        x: columns / 2, y: rows / 2,
        scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, (view.width - 24) / columns, (view.height - 24) / rows)),
    };
}
