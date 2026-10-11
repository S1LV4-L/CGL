import { ThemeToggle } from "./components/BotonTema";
import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";
import "./styles/estilos.css";

const WIDTH = 700;
const HEIGHT = 700;
const CELL_SIZE = 20;
const NUM_ROWS = WIDTH / CELL_SIZE;
const NUM_COLS = HEIGHT / CELL_SIZE;

const colors = ["black", "white"];

type Board = number[][];
type GameMode = "conway" | "seeds";


function createBoard(): Board {
    return Array.from({ length: NUM_ROWS }, () => Array.from({ length: NUM_COLS }, () => 0));
}

function App() {
    const initialBoard = createBoard();
    
    const [boardState, setBoardState] = useState<Board>(initialBoard);
    const [isPlaying, setIsPlaying] = useState(false);
    const [mode, setMode] = useState<GameMode>("conway");
    const [allowMutation, setAllowMutation] = useState(false); // Ruido aleatorio
    const canvasRef = useRef<null | HTMLCanvasElement>(null);
    
    // Se usan refs en vez de estados para no disparar re-renders del componente cada vez que el ratón se mueve.
    const isDrawing = useRef(false);
    const drawValue = useRef(1); // 1 dibujar, 0 borrar

    function countNeighbors(r0: number, c0: number, board: Board) {
        let count = 0;
        for (let dr = -1; dr <= 1; ++dr) {
            for (let dc = -1; dc <= 1; ++dc) {
                if (dr != 0 || dc != 0) {
                    // (posición + desplazamiento + tamaño_total) % tamaño_total: wrap del canvas
                    const r = (r0 + dr + NUM_ROWS) % NUM_ROWS;
                    const c = (c0 + dc + NUM_COLS) % NUM_COLS;
                    
                    if (board[r][c] === 1) ++count;
                }
            }
        }
        return count;
    }

    // Lógica unificada usando useCallback para evitar re-renders infinitos en el useEffect
    const computeNextBoard = useCallback(() => {
        setBoardState((prevBoardState) => {
            let newBoard = prevBoardState.map((row) => [...row]);

            for (let r = 0; r < NUM_ROWS; ++r) {
                for (let c = 0; c < NUM_COLS; ++c) {
                    const aliveCount = countNeighbors(r, c, prevBoardState);
                    
                    // Reglas puras (conway o seed)
                    if (prevBoardState[r][c] === 0) {
                        // CÉLULA MUERTA: Revisa si debe nacer
                        if (mode === "conway" && aliveCount === 3) newBoard[r][c] = 1; // Conway (B3): Nace con 3 vecinos
                        else if (mode === "seeds" && aliveCount === 2) newBoard[r][c] = 1; // Seeds (B2): Nace con 2 vecinos
                    } else {
                        // CÉLULA VIVA: Revisa si debe morir
                        if (mode === "conway" && aliveCount !== 2 && aliveCount !== 3) newBoard[r][c] = 0; // Conway (S23): Sobrevive solo con 2 o 3
                        else if (mode === "seeds") newBoard[r][c] = 0; // Seeds: Una célula viva siempre muere
                    }

                    // modo chido
                    if (allowMutation) {
                        // Probabilidad del 0.01% (0.0001) de mutar (revivir).
                        if (Math.random() < 0.0001) {
                            newBoard[r][c] = newBoard[r][c] === 1 ? 0 : 1;
                        }
                    }
                }
            }
            return newBoard;
        });
    }, [mode, allowMutation]); // Cambia el modo de juego según las dependencias

    useEffect(() => {
        if (!isPlaying) {
            return;
        }
        const interval = setInterval(computeNextBoard, 100);
        return () => clearInterval(interval);
    }, [isPlaying, computeNextBoard]);

    // Renderiza el estado actual de la cuadrícula en el canvas.
    useEffect(() => {
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            if (!ctx) return;

            ctx.clearRect(0, 0, WIDTH, HEIGHT);
            ctx.strokeStyle = "gray";
            ctx.lineWidth = 0.1;

            for (let r = 0; r < NUM_ROWS; ++r) {
                for (let c = 0; c < NUM_COLS; ++c) {
                    ctx.fillStyle = colors[boardState[r][c]];
                    
                    ctx.fillRect(
                        Math.floor((WIDTH / NUM_ROWS) * r),
                        Math.floor((HEIGHT / NUM_COLS) * c),
                        CELL_SIZE,
                        CELL_SIZE,
                    );

                    ctx.strokeRect(
                        Math.floor((WIDTH / NUM_ROWS) * r),
                        Math.floor((HEIGHT / NUM_COLS) * c),
                        CELL_SIZE,
                        CELL_SIZE,
                    );
                }
            }
        }
    }, [boardState, canvasRef]);

    function resetBoard() {
        const board = createBoard();
        setBoardState(board);
    }

    function toggleMode() {
        setMode((prevMode) => (prevMode === "conway" ? "seeds" : "conway"));
    }

    // Función auxiliar para obtener las coordenadas de la celda
    const getCellCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const x = Math.floor(e.nativeEvent.offsetX / CELL_SIZE);
        const y = Math.floor(e.nativeEvent.offsetY / CELL_SIZE);
        if (x < 0 || x >= NUM_ROWS || y < 0 || y >= NUM_COLS) return null; // Validar no salir del tablero
        return { x, y };
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getCellCoords(e);
        if (!coords) return;

        isDrawing.current = true;
        
        // Determina si renderizar o borrar en base a la celda actual
        drawValue.current = boardState[coords.x][coords.y] === 0 ? 1 : 0;

        setBoardState(prev => {
            if (prev[coords.x][coords.y] === drawValue.current) return prev;
            const newBoard = prev.map(row => [...row]);
            newBoard[coords.x][coords.y] = drawValue.current;
            return newBoard;
        });
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current) return; // Ignora el movimiento al no hacer click
        
        const coords = getCellCoords(e);
        if (!coords) return;

        setBoardState(prev => {
            // Optimización: si la celda ya tiene el valor que queremos, no hacemos nada (evita re-renders innecesarios)
            if (prev[coords.x][coords.y] === drawValue.current) return prev;
            const newBoard = prev.map(row => [...row]);
            newBoard[coords.x][coords.y] = drawValue.current;
            return newBoard;
        });
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

                    <canvas
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeave}
                        ref={canvasRef}
                        width={WIDTH}
                        height={HEIGHT}
                        className="canvas"
                    ></canvas>
                </div>
            </div>
        </>
    );
}

export default App;