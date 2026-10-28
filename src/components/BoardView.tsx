import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject, PointerEvent } from "react";
import { createBoardRenderer } from "../rendering/boardRenderer";
import { fitCamera, MAX_SCALE, MIN_SCALE, screenToCell, zoomAt } from "../rendering/camera";
import type { Camera } from "../rendering/camera";
import { createSimulation } from "../simulation/life";
import { parseRle } from "../simulation/rle";

type Tool = "draw" | "pan" | "stamp";

type Props = {
    columns: number;
    rows: number;
    disabled: boolean;
    tool: Tool;
    onToolChange: (tool: Tool) => void;
    selectedRle: string | null;
    onOpenLibrary: () => void;
    simulationRef: RefObject<ReturnType<typeof createSimulation> | null>;
    rendererRef: RefObject<ReturnType<typeof createBoardRenderer>>;
};
type Gesture = { id: number; kind: "pan" | "draw"; x: number; y: number; value: 0 | 1 };
const DEFAULT_SCALE = 5;

export function BoardView({ columns, rows, disabled, tool, onToolChange, selectedRle, onOpenLibrary, simulationRef, rendererRef }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gridRef = useRef<HTMLCanvasElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<Camera>({ x: columns / 2, y: rows / 2, scale: DEFAULT_SCALE });
    const sizeRef = useRef({ width: 1, height: 1 });
    const gestureRef = useRef<Gesture | null>(null);
    const [scale, setScale] = useState(DEFAULT_SCALE);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const updateCamera = useCallback((camera: Camera) => {
        const next = { ...camera, x: Math.max(0, Math.min(columns, camera.x)), y: Math.max(0, Math.min(rows, camera.y)) };
        cameraRef.current = next;
        setScale(next.scale);
        rendererRef.current?.setView(next);
    }, [columns, rows, rendererRef]);

    // Sincroniza el estado local con el documento: el usuario puede salir con Esc.
    useEffect(() => {
        function onChange() {
            setIsFullscreen(document.fullscreenElement === viewportRef.current);
        }
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    function toggleFullscreen() {
        const viewport = viewportRef.current;
        if (!viewport) return;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            viewport.requestFullscreen().catch(() => {});
        }
    }

    useEffect(() => {
        const canvas = canvasRef.current;
        const grid = gridRef.current;
        const viewport = viewportRef.current;
        if (!canvas || !grid || !viewport) return;
        if (!simulationRef.current) simulationRef.current = createSimulation(columns, rows);
        const renderer = createBoardRenderer(canvas, grid, columns, rows, DEFAULT_SCALE);
        rendererRef.current = renderer;
        renderer?.setView(cameraRef.current);
        renderer?.renderBoard(simulationRef.current.board);
        const observer = new ResizeObserver(() => {
            const { width, height } = viewport.getBoundingClientRect();
            sizeRef.current = { width, height };
            renderer?.resize(width, height);
        });
        observer.observe(viewport);
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            if (gestureRef.current) return;
            const rect = canvas.getBoundingClientRect();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
            updateCamera(zoomAt(cameraRef.current, sizeRef.current,
                event.clientX - rect.left, event.clientY - rect.top, Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002)));
        };
        canvas.addEventListener("wheel", wheel, { passive: false });
        return () => {
            observer.disconnect();
            canvas.removeEventListener("wheel", wheel);
            renderer?.dispose();
            rendererRef.current = null;
        };
    }, [columns, rows, simulationRef, rendererRef, updateCamera]);

    function zoom(factor: number) {
        const view = sizeRef.current;
        updateCamera(zoomAt(cameraRef.current, view, view.width / 2, view.height / 2, factor));
    }

    function pan(dx: number, dy: number) {
        const camera = cameraRef.current;
        updateCamera({ ...camera, x: camera.x + dx / camera.scale, y: camera.y + dy / camera.scale });
    }

    function cellAt(event: PointerEvent<HTMLCanvasElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        const point = screenToCell(event.clientX - rect.left, event.clientY - rect.top, cameraRef.current, sizeRef.current);
        return { x: Math.floor(point.x), y: Math.floor(point.y) };
    }

    function paint(x0: number, y0: number, x1: number, y1: number, value: 0 | 1) {
        const simulation = simulationRef.current;
        if (!simulation) return;
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let error = dx + dy;
        while (true) {
            if (x0 >= 0 && x0 < columns && y0 >= 0 && y0 < rows) simulation.setCell(x0, y0, value);
            if (x0 === x1 && y0 === y1) break;
            const twice = error * 2;
            if (twice >= dy) { error += dy; x0 += sx; }
            if (twice <= dx) { error += dx; y0 += sy; }
        }
        rendererRef.current?.renderCell(simulation.board);
    }

    function stampPattern(rle: string, centerX: number, centerY: number) {
        const header = /x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i.exec(rle);
        if (!header) return;
        const patternWidth = Number(header[1]);
        const patternHeight = Number(header[2]);
        let result;
        try {
            result = parseRle(rle, patternWidth, patternHeight);
        } catch {
            return;
        }
        const simulation = simulationRef.current;
        if (!simulation) return;
        const startX = centerX - Math.floor(patternWidth / 2);
        const startY = centerY - Math.floor(patternHeight / 2);
        for (let y = 0; y < patternHeight; y++) {
            for (let x = 0; x < patternWidth; x++) {
                if (!result.board[y * patternWidth + x]) continue;
                const tx = startX + x;
                const ty = startY + y;
                if (tx >= 0 && tx < columns && ty >= 0 && ty < rows) {
                    simulation.setCell(tx, ty, 1);
                }
            }
        }
        rendererRef.current?.renderCell(simulation.board);
    }

    return (
        <section className="board-navigation" aria-label="Vista del tablero">
            <div className="navigation-bar" role="group" aria-label="Navegación del tablero">
                <button aria-pressed={tool === "draw"} onClick={() => onToolChange("draw")}>Dibujar</button>
                <button aria-pressed={tool === "pan"} onClick={() => onToolChange("pan")}>Mover</button>
                <button
                    aria-pressed={tool === "stamp"}
                    onClick={() => (selectedRle ? onToolChange("stamp") : onOpenLibrary())}
                >
                    Estampar{selectedRle ? "" : "…"}
                </button>
                <button aria-label="Alejar" disabled={scale <= MIN_SCALE} onClick={() => zoom(1 / 1.5)}>−</button>
                <output aria-label="Zoom">{Number((scale / DEFAULT_SCALE * 100).toFixed(1))}%</output>
                <button aria-label="Acercar" disabled={scale >= MAX_SCALE} onClick={() => zoom(1.5)}>+</button>
                <button onClick={() => updateCamera(fitCamera(columns, rows, sizeRef.current))}>Ver todo</button>
                <button onClick={() => updateCamera({ x: columns / 2, y: rows / 2, scale: DEFAULT_SCALE })}>Centrar · 100%</button>
                <button aria-label="Mover vista a la izquierda" onClick={() => pan(-sizeRef.current.width / 4, 0)}>←</button>
                <button aria-label="Mover vista hacia arriba" onClick={() => pan(0, -sizeRef.current.height / 4)}>↑</button>
                <button aria-label="Mover vista hacia abajo" onClick={() => pan(0, sizeRef.current.height / 4)}>↓</button>
                <button aria-label="Mover vista a la derecha" onClick={() => pan(sizeRef.current.width / 4, 0)}>→</button>
                <button
                    aria-pressed={isFullscreen}
                    onClick={toggleFullscreen}
                    title="Pantalla completa (F)"
                >
                    {isFullscreen ? "Salir pantalla completa" : "Pantalla completa"}
                </button>
            </div>
            <p id="navigation-help" className="settings-hint">
                Rueda: zoom · Mover o Mayús + arrastrar: desplazar · Flechas: mover la vista · + / −: zoom · 0: ver todo · F: pantalla completa · Esc: salir
                {selectedRle && " · Patrón activo: haz clic en el tablero para estampar."}
            </p>
            <div ref={viewportRef} className="board-viewport">
                <canvas ref={canvasRef} className={`canvas tool-${tool}`} tabIndex={0}
                    aria-label="Tablero del juego" aria-describedby="navigation-help"
                    onContextMenu={event => event.preventDefault()}
                    onKeyDown={event => {
                        if (event.ctrlKey || event.metaKey || event.altKey) return;
                        const actions: Record<string, () => void> = {
                            ArrowLeft: () => pan(-80, 0), ArrowRight: () => pan(80, 0),
                            ArrowUp: () => pan(0, -80), ArrowDown: () => pan(0, 80),
                            "+": () => zoom(1.5), "=": () => zoom(1.5), "-": () => zoom(1 / 1.5),
                            "0": () => updateCamera(fitCamera(columns, rows, sizeRef.current)),
                            "f": () => toggleFullscreen(), "F": () => toggleFullscreen(),
                        };
                        if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
                    }}
                    onPointerDown={event => {
                        if (gestureRef.current || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
                        if (tool === "stamp") {
                            if (!selectedRle || disabled) return;
                            const cell = cellAt(event);
                            event.preventDefault();
                            event.currentTarget.focus({ preventScroll: true });
                            stampPattern(selectedRle, cell.x, cell.y);
                            return;
                        }
                        const isPan = tool === "pan" || event.shiftKey || event.button !== 0;
                        if (!isPan && disabled) return;
                        const cell = cellAt(event);
                        const simulation = simulationRef.current;
                        if (!isPan && (!simulation || cell.x < 0 || cell.x >= columns || cell.y < 0 || cell.y >= rows)) return;
                        event.preventDefault();
                        event.currentTarget.focus({ preventScroll: true });
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const value = simulation?.board[cell.y * columns + cell.x] ? 0 : 1;
                        gestureRef.current = { id: event.pointerId, kind: isPan ? "pan" : "draw",
                            x: isPan ? event.clientX : cell.x, y: isPan ? event.clientY : cell.y, value };
                        if (!isPan) paint(cell.x, cell.y, cell.x, cell.y, value);
                    }}
                    onPointerMove={event => {
                        const gesture = gestureRef.current;
                        if (!gesture || gesture.id !== event.pointerId) return;
                        if (gesture.kind === "pan") {
                            pan(gesture.x - event.clientX, gesture.y - event.clientY);
                            gesture.x = event.clientX; gesture.y = event.clientY;
                        } else if (!disabled) {
                            const cell = cellAt(event);
                            const x = Math.max(0, Math.min(columns - 1, cell.x));
                            const y = Math.max(0, Math.min(rows - 1, cell.y));
                            paint(gesture.x, gesture.y, x, y, gesture.value);
                            gesture.x = x; gesture.y = y;
                        }
                    }}
                    onPointerUp={event => {
                        if (gestureRef.current?.id !== event.pointerId) return;
                        gestureRef.current = null;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    onPointerCancel={() => { gestureRef.current = null; }}
                    onLostPointerCapture={() => { gestureRef.current = null; }} />
                <canvas ref={gridRef} className="board-grid" aria-hidden="true" />
                {isFullscreen && (
                    <button
                        className="fullscreen-exit"
                        onClick={toggleFullscreen}
                        aria-label="Salir de pantalla completa"
                        title="Salir de pantalla completa (Esc)"
                    >
                        ✕
                    </button>
                )}
            </div>
        </section>
    );
}