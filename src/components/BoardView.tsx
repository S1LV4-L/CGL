import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, PointerEvent } from 'react';
import { createRuntime } from '../simulation/runtime';
import type { LifeRuntime, Metrics } from '../simulation/runtime';
import {
    fitCamera,
    MAX_SCALE,
    MIN_SCALE,
    screenToCell,
    zoomAt,
} from '../rendering/camera';
import type { Camera } from '../rendering/camera';

type Tool = 'draw' | 'pan' | 'stamp';

type Props = {
    columns: number;
    rows: number;
    disabled: boolean;
    tool: Tool;
    onToolChange: (tool: Tool) => void;
    selectedRle: string | null;
    onOpenLibrary: () => void;
    simulationRef: RefObject<LifeRuntime | null>;
    onMetrics: (metrics: Metrics) => void;
    onError: (message: string) => void;
};
type Gesture = { id: number; kind: 'pan' | 'draw'; x: number; y: number };
const DEFAULT_SCALE = 5;

export function BoardView({
    columns,
    rows,
    disabled,
    tool,
    onToolChange,
    selectedRle,
    onOpenLibrary,
    simulationRef,
    onMetrics,
    onError,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<Camera>({
        x: columns / 2,
        y: rows / 2,
        scale: DEFAULT_SCALE,
    });
    const sizeRef = useRef({ width: 1, height: 1 });
    const gestureRef = useRef<Gesture | null>(null);
    const initialSize = useRef({ columns, rows });
    const [scale, setScale] = useState(DEFAULT_SCALE);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const updateCamera = useCallback(
        (camera: Camera) => {
            const next = {
                ...camera,
                x: Math.max(0, Math.min(columns, camera.x)),
                y: Math.max(0, Math.min(rows, camera.y)),
            };
            cameraRef.current = next;
            setScale(next.scale);
            simulationRef.current?.send({
                type: 'view',
                camera: next,
                ...sizeRef.current,
            });
        },
        [columns, rows, simulationRef],
    );

    const toggleFullscreen = useCallback(async () => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        try {
            if (document.fullscreenElement === viewport)
                await document.exitFullscreen();
            else await viewport.requestFullscreen();
        } catch (error) {
            onError(
                `No se pudo cambiar la pantalla completa: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }, [onError]);

    useEffect(() => {
        function onChange() {
            setIsFullscreen(document.fullscreenElement === viewportRef.current);
            canvasRef.current?.focus({ preventScroll: true });
        }
        function onKeyDown(event: KeyboardEvent) {
            if (
                event.defaultPrevented ||
                event.repeat ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey
            )
                return;
            if (event.key === 'Escape') {
                if (document.fullscreenElement === viewportRef.current) {
                    event.preventDefault();
                    void toggleFullscreen();
                }
                return;
            }
            if (event.key.toLowerCase() !== 'f') return;
            const target = event.target;
            if (
                target instanceof Element &&
                target.closest(
                    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
                )
            )
                return;
            if (document.querySelector('dialog[open]')) return;
            event.preventDefault();
            void toggleFullscreen();
        }
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('fullscreenchange', onChange);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [toggleFullscreen]);

    useEffect(() => {
        const canvas = canvasRef.current,
            viewport = viewportRef.current;
        if (!canvas || !viewport) return;
        const runtime = createRuntime(canvas, onMetrics, onError);
        simulationRef.current = runtime;
        runtime.send({ type: 'init', ...initialSize.current });
        const observer = new ResizeObserver(() => {
            const { width, height } = viewport.getBoundingClientRect();
            sizeRef.current = { width, height };
            runtime.send({
                type: 'view',
                camera: cameraRef.current,
                width,
                height,
            });
        });
        observer.observe(viewport);
        return () => {
            observer.disconnect();
            runtime.dispose();
            simulationRef.current = null;
        };
    }, [simulationRef, onMetrics, onError]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            if (gestureRef.current) return;
            const rect = canvas.getBoundingClientRect();
            const delta =
                event.deltaY *
                (event.deltaMode === 1
                    ? 16
                    : event.deltaMode === 2
                      ? rect.height
                      : 1);
            updateCamera(
                zoomAt(
                    cameraRef.current,
                    sizeRef.current,
                    event.clientX - rect.left,
                    event.clientY - rect.top,
                    Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002),
                ),
            );
        };
        canvas.addEventListener('wheel', wheel, { passive: false });
        return () => canvas.removeEventListener('wheel', wheel);
    }, [updateCamera]);

    useEffect(() => {
        cameraRef.current = {
            ...cameraRef.current,
            x: columns / 2,
            y: rows / 2,
        };
        simulationRef.current?.send({
            type: 'view',
            camera: cameraRef.current,
            ...sizeRef.current,
        });
    }, [columns, rows, simulationRef]);

    function zoom(factor: number) {
        const view = sizeRef.current;
        updateCamera(
            zoomAt(
                cameraRef.current,
                view,
                view.width / 2,
                view.height / 2,
                factor,
            ),
        );
    }

    function pan(dx: number, dy: number) {
        const camera = cameraRef.current;
        updateCamera({
            ...camera,
            x: camera.x + dx / camera.scale,
            y: camera.y + dy / camera.scale,
        });
    }

    function cellAt(event: PointerEvent<HTMLCanvasElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        const point = screenToCell(
            event.clientX - rect.left,
            event.clientY - rect.top,
            cameraRef.current,
            sizeRef.current,
        );
        return { x: Math.floor(point.x), y: Math.floor(point.y) };
    }

    function paint(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        first = false,
    ) {
        simulationRef.current?.send({ type: 'paint', x0, y0, x1, y1, first });
    }
    function stampPattern(rle: string, x: number, y: number) {
        simulationRef.current?.send({ type: 'stamp', rle, x, y });
    }

    return (
        <section className="board-navigation" aria-label="Vista del tablero">
            <p id="navigation-help" className="settings-hint">
                Rueda: zoom · Mover o Mayús + arrastrar: desplazar · Flechas:
                mover la vista · + / −: zoom · 0: ver todo · F: pantalla
                completa · Esc: salir
                {selectedRle &&
                    ' · Patrón activo: haz clic en el tablero para estampar.'}
            </p>
            <div ref={viewportRef} className="board-viewport">
                <canvas
                    ref={canvasRef}
                    className={`canvas tool-${tool}`}
                    tabIndex={0}
                    aria-label="Tablero del juego"
                    aria-describedby="navigation-help"
                    onContextMenu={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                        if (event.ctrlKey || event.metaKey || event.altKey)
                            return;
                        const actions: Record<string, () => void> = {
                            ArrowLeft: () => pan(-80, 0),
                            ArrowRight: () => pan(80, 0),
                            ArrowUp: () => pan(0, -80),
                            ArrowDown: () => pan(0, 80),
                            '+': () => zoom(1.5),
                            '=': () => zoom(1.5),
                            '-': () => zoom(1 / 1.5),
                            '0': () =>
                                updateCamera(
                                    fitCamera(columns, rows, sizeRef.current),
                                ),
                        };
                        if (actions[event.key]) {
                            event.preventDefault();
                            actions[event.key]();
                        }
                    }}
                    onPointerDown={(event) => {
                        if (
                            gestureRef.current ||
                            (event.button !== 0 &&
                                event.button !== 1 &&
                                event.button !== 2)
                        )
                            return;
                        if (tool === 'stamp') {
                            if (!selectedRle || disabled) return;
                            const cell = cellAt(event);
                            event.preventDefault();
                            event.currentTarget.focus({ preventScroll: true });
                            stampPattern(selectedRle, cell.x, cell.y);
                            return;
                        }
                        const isPan =
                            tool === 'pan' ||
                            event.shiftKey ||
                            event.button !== 0;
                        if (!isPan && disabled) return;
                        const cell = cellAt(event);
                        const simulation = simulationRef.current;
                        if (
                            !isPan &&
                            (!simulation ||
                                cell.x < 0 ||
                                cell.x >= columns ||
                                cell.y < 0 ||
                                cell.y >= rows)
                        )
                            return;
                        event.preventDefault();
                        event.currentTarget.focus({ preventScroll: true });
                        event.currentTarget.setPointerCapture(event.pointerId);
                        gestureRef.current = {
                            id: event.pointerId,
                            kind: isPan ? 'pan' : 'draw',
                            x: isPan ? event.clientX : cell.x,
                            y: isPan ? event.clientY : cell.y,
                        };
                        if (!isPan) paint(cell.x, cell.y, cell.x, cell.y, true);
                    }}
                    onPointerMove={(event) => {
                        const gesture = gestureRef.current;
                        if (!gesture || gesture.id !== event.pointerId) return;
                        if (gesture.kind === 'pan') {
                            pan(
                                gesture.x - event.clientX,
                                gesture.y - event.clientY,
                            );
                            gesture.x = event.clientX;
                            gesture.y = event.clientY;
                        } else if (!disabled) {
                            const cell = cellAt(event);
                            const x = Math.max(
                                0,
                                Math.min(columns - 1, cell.x),
                            );
                            const y = Math.max(0, Math.min(rows - 1, cell.y));
                            paint(gesture.x, gesture.y, x, y);
                            gesture.x = x;
                            gesture.y = y;
                        }
                    }}
                    onPointerUp={(event) => {
                        if (gestureRef.current?.id !== event.pointerId) return;
                        gestureRef.current = null;
                        event.currentTarget.releasePointerCapture(
                            event.pointerId,
                        );
                    }}
                    onPointerCancel={() => {
                        gestureRef.current = null;
                    }}
                    onLostPointerCapture={() => {
                        gestureRef.current = null;
                    }}
                />
                <div
                    className="navigation-bar"
                    role="group"
                    aria-label="Navegación del tablero"
                >
                    <button
                        aria-pressed={tool === 'draw'}
                        onClick={() => onToolChange('draw')}
                    >
                        Dibujar
                    </button>
                    <button
                        aria-pressed={tool === 'pan'}
                        onClick={() => onToolChange('pan')}
                    >
                        Mover
                    </button>
                    <button
                        aria-pressed={tool === 'stamp'}
                        onClick={() =>
                            selectedRle
                                ? onToolChange('stamp')
                                : onOpenLibrary()
                        }
                    >
                        Estampar{selectedRle ? '' : '…'}
                    </button>
                    <button
                        aria-label="Alejar"
                        disabled={scale <= MIN_SCALE}
                        onClick={() => zoom(1 / 1.5)}
                    >
                        −
                    </button>
                    <output aria-label="Zoom">
                        {Number(((scale / DEFAULT_SCALE) * 100).toFixed(1))}%
                    </output>
                    <button
                        aria-label="Acercar"
                        disabled={scale >= MAX_SCALE}
                        onClick={() => zoom(1.5)}
                    >
                        +
                    </button>
                    <button
                        onClick={() =>
                            updateCamera(
                                fitCamera(columns, rows, sizeRef.current),
                            )
                        }
                    >
                        Ver todo
                    </button>
                    <button
                        onClick={() =>
                            updateCamera({
                                x: columns / 2,
                                y: rows / 2,
                                scale: DEFAULT_SCALE,
                            })
                        }
                    >
                        Centrar · 100%
                    </button>
                    <button
                        aria-label="Mover vista a la izquierda"
                        onClick={() => pan(-sizeRef.current.width / 4, 0)}
                    >
                        ←
                    </button>
                    <button
                        aria-label="Mover vista hacia arriba"
                        onClick={() => pan(0, -sizeRef.current.height / 4)}
                    >
                        ↑
                    </button>
                    <button
                        aria-label="Mover vista hacia abajo"
                        onClick={() => pan(0, sizeRef.current.height / 4)}
                    >
                        ↓
                    </button>
                    <button
                        aria-label="Mover vista a la derecha"
                        onClick={() => pan(sizeRef.current.width / 4, 0)}
                    >
                        →
                    </button>
                    <button
                        aria-pressed={isFullscreen}
                        onClick={toggleFullscreen}
                        aria-keyshortcuts="F Escape"
                        title={
                            isFullscreen
                                ? 'Salir de pantalla completa (Esc)'
                                : 'Pantalla completa (F)'
                        }
                    >
                        {isFullscreen
                            ? 'Salir pantalla completa'
                            : 'Pantalla completa'}
                    </button>
                </div>
            </div>
        </section>
    );
}
