import { ThemeToggle } from "./components/BotonTema";
import { useEffect, useRef, useState, useCallback } from "react";
import FpsViewer from "./components/FpsViewer";
import { createBoardRenderer } from "./rendering/boardRenderer";
import { createSimulation, formatRule, getPresetRule, getRuleMode } from "./simulation/life";
import { BoardView } from "./components/BoardView";
import { BoardSettings } from "./components/BoardSettings";
import { resizeSimulation } from "./simulation/resize";
import { RulesEditor } from "./components/RulesEditor";
import { PatternLibrary } from "./components/PatternLibrary";
import type { Pattern } from "./simulation/patternLibrary";
import { MAX_RLE_FILE_SIZE, parseRle, serializeRle } from "./simulation/rle";
import { useCounter } from "./hooks/useCounter";
import { GenerationCounter } from "./components/GenerationCounter";
import "./App.css";
import "./styles/estilos.css";
import "./styles/pattern-library.css";


const INITIAL_COLUMNS = 12000;
const INITIAL_ROWS = 8000;

function App() {
    // El tablero pertenece al motor: cambiarlo no necesita renderizar la interfaz de React.
    // Los dos buffers se crean al montar y se reutilizan al avanzar y resetear.
    const simulationRef = useRef<ReturnType<typeof createSimulation> | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [dimensions, setDimensions] = useState({ columns: INITIAL_COLUMNS, rows: INITIAL_ROWS });
    const [intervalMs, setIntervalMs] = useState(100);
    const { columns, rows } = dimensions;
    const [isLoading, setIsLoading] = useState(false);
    const [fileError, setFileError] = useState("");
    const [fileStatus, setFileStatus] = useState("");
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [rules, setRules] = useState(() => getPresetRule("conway"));
    const mode = getRuleMode(rules);
    const [isRulesOpen, setIsRulesOpen] = useState(false);
    const [allowMutation, setAllowMutation] = useState(false); // Ruido aleatorio
    const rendererRef = useRef<ReturnType<typeof createBoardRenderer>>(null);

    // Biblioteca de patrones: patrón seleccionado + modal abierto/cerrado.
    // `tool` se levanta a App para que seleccionar un patrón cambie el modo de un clic.
    const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [tool, setTool] = useState<"draw" | "pan" | "stamp">("draw");

    const { count, incrementar, resetear } = useCounter(0);

    // Se solicita el dibujo; el renderer agrupa las solicitudes en el próximo cuadro.
    const renderBoard = useCallback(() => {
        const board = simulationRef.current?.board;
        if (board) rendererRef.current?.renderBoard(board);
    }, []);

    const computeNextBoard = useCallback(() => {
        const simulation = simulationRef.current;
        if (!simulation) return;

        simulation.step(rules, allowMutation);
        incrementar();
        renderBoard();
    }, [rules, allowMutation, incrementar, renderBoard]);

    useEffect(() => {
        if (!isPlaying) {
            return;
        }

        const interval = setInterval(computeNextBoard, intervalMs);

        return () => clearInterval(interval);
    }, [isPlaying, computeNextBoard, intervalMs]);

    function resetBoard() {
        simulationRef.current?.reset();
        resetear();
        renderBoard();
    }

    function toggleMode() {
        setRules(getPresetRule(mode === "conway" ? "seeds" : "conway"));
    }

    async function loadRle(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = ""; // Permite volver a seleccionar el mismo archivo.
        if (!file) return;
        setIsPlaying(false);
        setIsLoading(true);
        setFileError("");
        setFileStatus("");
        try {
            if (file.size > MAX_RLE_FILE_SIZE) throw new Error("El archivo supera el límite de 1 MB.");
            const pattern = parseRle(await file.text(), columns, rows);
            const simulation = simulationRef.current;
            if (!simulation) return;
            simulation.reset();
            simulation.board.set(pattern.board);
            setRules(pattern.rules);
            setAllowMutation(false);
            resetear();
            renderBoard();
            setFileStatus(`Patrón cargado: ${file.name} (${pattern.width} × ${pattern.height}).`);
        } catch (error) {
            setFileError(error instanceof Error ? error.message : "No se pudo leer el archivo.");
        } finally {
            setIsLoading(false);
        }
    }

    function exportRle() {
        const board = simulationRef.current?.board;
        if (!board) return;
        const blob = new Blob([serializeRle(board, columns, rows, rules)], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `patron-${mode}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setFileError("");
        setFileStatus("Patrón exportado en formato RLE (.txt).");
    }

    function applySettings(nextColumns: number, nextRows: number, nextInterval: number) {
        if (nextColumns !== columns || nextRows !== rows) {
            const simulation = simulationRef.current;
            if (!simulation) return;
            try {
                const resized = resizeSimulation(simulation.board, columns, rows, nextColumns, nextRows);
                setIsPlaying(false);
                simulationRef.current = resized;
                setDimensions({ columns: nextColumns, rows: nextRows });
                resetear();
                setFileError("");
                setFileStatus(`Tablero redimensionado: ${nextColumns} × ${nextRows}.`);
            } catch {
                setFileError("No se pudo reservar memoria para ese tamaño de tablero.");
                return;
            }
        }
        setIntervalMs(nextInterval);
    }

    return (
        <>
            <ThemeToggle />
            <FpsViewer />
            <div>
                <h1>{mode === "conway" ? "Conway's Game of Life" : mode === "seeds" ? "Seeds" : `Reglas personalizadas: ${formatRule(rules)}`}</h1>
                <div className="canvas-container">
                    <fieldset className="button-bar" disabled={isLoading} aria-label="Controles del tablero">
                        <button onClick={computeNextBoard}>Siguiente</button>
                        <button onClick={resetBoard}>Reset</button>
                        <button onClick={() => setIsPlaying(!isPlaying)}>
                            {isPlaying ? "Stop" : "Play"}
                        </button>

                        <button onClick={toggleMode}
                            className={`btn-mode ${mode === "conway" ? "btn-mode-conway" : "btn-mode-seeds"}`}>
                            Modo: {mode === "conway" ? "Conway" : mode === "seeds" ? "Seeds" : "Personalizado"}
                        </button>
                        <button onClick={() => {
                            setIsPlaying(false);
                            setIsRulesOpen(true);
                        }}>Editar reglas</button>

                        <button
                            onClick={() => setAllowMutation(!allowMutation)}
                            className={allowMutation ? "btn-mutation-on" : "btn-mutation-off"}
                        >
                            Mutación: {allowMutation ? "ON" : "OFF"}
                        </button>
                        <button onClick={() => {
                            setIsPlaying(false);
                            fileInputRef.current?.click();
                        }}>Cargar RLE (.txt)</button>
                        <button onClick={exportRle}>Exportar RLE (.txt)</button>
                        <button onClick={() => {
                            setIsPlaying(false);
                            setIsLibraryOpen(true);
                        }}>Biblioteca de patrones</button>
                    </fieldset>
                    <BoardSettings columns={columns} rows={rows} intervalMs={intervalMs}
                        disabled={isLoading} onApply={applySettings} />
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.rle,text/plain"
                        hidden
                        aria-label="Archivo de patrón RLE"
                        onChange={loadRle}
                    />
                    {fileError && <p className="error" role="alert">{fileError}</p>}
                    <p className="file-status" role="status">{isLoading ? "Cargando patrón…" : fileStatus}</p>

                    <BoardView key={`${columns}x${rows}`} columns={columns} rows={rows}
                        disabled={isLoading || isRulesOpen || isLibraryOpen}
                        tool={tool} onToolChange={setTool}
                        selectedRle={selectedPattern?.rle ?? null}
                        onOpenLibrary={() => setIsLibraryOpen(true)}
                        simulationRef={simulationRef} rendererRef={rendererRef} />
                    <GenerationCounter valor={count}/>
                </div>
            </div>
            {isRulesOpen && <RulesEditor rules={rules}
                onClose={() => setIsRulesOpen(false)}
                onApply={nextRules => {
                    setRules(nextRules);
                    setIsRulesOpen(false);
                }} />}
            {isLibraryOpen && (
                <PatternLibrary
                    onClose={() => setIsLibraryOpen(false)}
                    onSelect={pattern => {
                        setSelectedPattern(pattern);
                        setTool("stamp");
                        setIsLibraryOpen(false);
                    }}
                />
            )}
        </>
    );
}

export default App;