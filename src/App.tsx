import { ThemeToggle } from "./components/BotonTema";
import { useEffect, useRef, useState, useCallback } from "react";
import FpsViewer from "./components/FpsViewer";
import { createBoardRenderer } from "./rendering/boardRenderer";
import { createSimulation } from "./simulation/life";
import type { GameMode } from "./simulation/life";
import { useCounter } from "./hooks/useCounter";
import { GenerationCounter } from "./components/GenerationCounter";
import "./App.css";
import "./styles/estilos.css";


const WIDTH = 1000;
const HEIGHT = 1000;
const CELL_SIZE = 10;
const GRID_WIDTH = WIDTH / CELL_SIZE;
const GRID_HEIGHT = HEIGHT / CELL_SIZE;
const renderInterval = 10;

function App() {
    // El tablero pertenece al motor: cambiarlo no necesita renderizar la interfaz de React.
    // Los dos buffers se crean al montar y se reutilizan al avanzar y resetear.
    const simulationRef = useRef<ReturnType<typeof createSimulation> | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [mode, setMode] = useState<GameMode>("conway");
    const [allowMutation, setAllowMutation] = useState(false); // Ruido aleatorio
    const canvasRef = useRef<null | HTMLCanvasElement>(null);
    const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<ReturnType<typeof createBoardRenderer>>(null);
    
    
    const { count, incrementar, resetear } = useCounter(0);



    // Se usan refs en vez de estados para no disparar re-renders del componente cada vez que el ratón se mueve.
    const isDrawing = useRef(false);
    const drawValue = useRef<0 | 1>(1); // 1 dibujar, 0 borrar

    // Se solicita el dibujo; el renderer agrupa las solicitudes en el próximo cuadro.
    const renderBoard = useCallback(() => {
        const board = simulationRef.current?.board;
        if (board) rendererRef.current?.renderBoard(board);
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const gridCanvas = gridCanvasRef.current;
        if (!canvas || !gridCanvas) return;

        const renderer = createBoardRenderer(canvas, gridCanvas, GRID_WIDTH, GRID_HEIGHT, CELL_SIZE);
        rendererRef.current = renderer;
        simulationRef.current = createSimulation(GRID_WIDTH, GRID_HEIGHT);
        renderBoard();

        // También se cancela cualquier cuadro pendiente al desmontar o en StrictMode.
        return () => {
            renderer?.dispose();
            rendererRef.current = null;
        };
    }, [renderBoard]);

    const computeNextBoard = useCallback(() => {
        const simulation = simulationRef.current;
        if (!simulation) return;

        simulation.step(mode, allowMutation);
        incrementar();
        renderBoard();
    }, [mode, allowMutation, incrementar, renderBoard]);

    useEffect(() => {
        if (!isPlaying) {
            return;
        }

        const interval = setInterval(computeNextBoard, renderInterval);

        return () => clearInterval(interval);
    }, [isPlaying, computeNextBoard]);

    function resetBoard() {
        simulationRef.current?.reset();
        resetear();
        renderBoard();
    }

    function toggleMode() {
        setMode((prevMode) => (prevMode === "conway" ? "seeds" : "conway"));
    }

    // Función auxiliar para obtener las coordenadas de la celda
    const getCellCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const x = Math.floor(e.nativeEvent.offsetX / CELL_SIZE);
        const y = Math.floor(e.nativeEvent.offsetY / CELL_SIZE);
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return null; // Validar no salir del tablero
        return { x, y };
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getCellCoords(e);
        const simulation = simulationRef.current;
        if (!coords || !simulation) return;
        const index = coords.y * GRID_WIDTH + coords.x;

        isDrawing.current = true;

        // Determina si renderizar o borrar en base a la celda actual
        drawValue.current = simulation.board[index] === 0 ? 1 : 0;
        simulation.setCell(coords.x, coords.y, drawValue.current);
        rendererRef.current?.renderCell(simulation.board, coords.x, coords.y);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current) return; // Ignora el movimiento al no hacer click

        const coords = getCellCoords(e);
        const simulation = simulationRef.current;
        if (!coords || !simulation) return;

        // Si la celda ya tiene el valor deseado, no se solicita otro dibujo.
        if (!simulation.setCell(coords.x, coords.y, drawValue.current)) return;
        rendererRef.current?.renderCell(simulation.board, coords.x, coords.y);
    };

    const handleMouseUp = () => {
        isDrawing.current = false; // Deja de dibujar al soltar el botón
    };

    const handleMouseLeave = () => {
        isDrawing.current = false; // Si el ratón sale del canvas deja de dibujar para evitar bugs
    };

    return (
        <>
            <ThemeToggle />
            <FpsViewer />
            <div>
                <h1>{mode === "conway" ? "Conway's Game of Life" : "Seeds"}</h1>
                <div className="canvas-container">
                    <div className="button-bar">
                        <button onClick={computeNextBoard}>Siguiente</button>
                        <button onClick={resetBoard}>Reset</button>
                        <button onClick={() => setIsPlaying(!isPlaying)}>
                            {isPlaying ? "Stop" : "Play"}
                        </button>

                        <button onClick={toggleMode}
                            className={`btn-mode ${mode === "conway" ? "btn-mode-conway" : "btn-mode-seeds"}`}>
                            Modo: {mode === "conway" ? "Conway" : "Seeds"}
                        </button>

                        <button
                            onClick={() => setAllowMutation(!allowMutation)}
                            className={allowMutation ? "btn-mutation-on" : "btn-mutation-off"}
                        >
                            Mutación: {allowMutation ? "ON" : "OFF"}
                        </button>
                    </div>

                    <div className="board-viewport">
                        <canvas
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseLeave}
                            ref={canvasRef}
                            width={WIDTH}
                            height={HEIGHT}
                            className="canvas"
                        />
                        <canvas
                            ref={gridCanvasRef}
                            width={WIDTH}
                            height={HEIGHT}
                            className="board-grid"
                            aria-hidden="true"
                        />
                    </div>
                    <GenerationCounter valor={count}/>
                </div>
            </div>
        </>
    );
}

export default App;
