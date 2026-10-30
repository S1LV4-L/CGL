import { ThemeToggle } from './components/BotonTema';
import {
    useEffect,
    useRef,
    useState,
    useCallback,
    lazy,
    Suspense,
} from 'react';
import { formatRule, getPresetRule, getRuleMode } from './simulation/life';
import { BoardView } from './components/BoardView';
import { BoardSettings } from './components/BoardSettings';
import { RulesEditor } from './components/RulesEditor';
import type { Pattern } from './simulation/patternLibrary';
import type {
    Engine,
    LifeRuntime,
    LoadResult,
    Metrics,
} from './simulation/runtime';
import { transferFileStream } from './simulation/runtime';
import { GenerationCounter } from './components/GenerationCounter';
import './App.css';
import './styles/estilos.css';
import './styles/pattern-library.css';

const INITIAL_COLUMNS = 12000;
const INITIAL_ROWS = 8000;
const PatternLibrary = lazy(() =>
    import('./components/PatternLibrary').then((module) => ({
        default: module.PatternLibrary,
    })),
);

function App() {
    // El tablero pertenece al motor: cambiarlo no necesita renderizar la interfaz de React.
    // Los dos buffers se crean al montar y se reutilizan al avanzar y resetear.
    const simulationRef = useRef<LifeRuntime | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [dimensions, setDimensions] = useState({
        columns: INITIAL_COLUMNS,
        rows: INITIAL_ROWS,
    });
    const [intervalMs, setIntervalMs] = useState(100);
    const { columns, rows } = dimensions;
    const [isLoading, setIsLoading] = useState(false);
    const [fileError, setFileError] = useState('');
    const [fileStatus, setFileStatus] = useState('');
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [rules, setRules] = useState(() => getPresetRule('conway'));
    const mode = getRuleMode(rules);
    const [isRulesOpen, setIsRulesOpen] = useState(false);
    const [allowMutation, setAllowMutation] = useState(false); // Ruido aleatorio
    const [metrics, setMetrics] = useState<Metrics | null>(null);
    const [engine, setEngine] = useState<Engine>('cpu');
    const onMetrics = useCallback((next: Metrics) => {
        setMetrics(next);
        setDimensions((old) =>
            old.columns === next.columns && old.rows === next.rows
                ? old
                : { columns: next.columns, rows: next.rows },
        );
    }, []);
    const onError = useCallback((message: string) => {
        setFileError(message);
        setIsPlaying(false);
    }, []);

    // Biblioteca de patrones: patrón seleccionado + modal abierto/cerrado.
    // `tool` se levanta a App para que seleccionar un patrón cambie el modo de un clic.
    const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(
        null,
    );
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [tool, setTool] = useState<'draw' | 'pan' | 'stamp'>('draw');

    const count = metrics?.generation ?? 0;
    useEffect(() => {
        simulationRef.current?.send({
            type: 'configure',
            rule: rules,
            mutation: allowMutation,
            playing: isPlaying,
            interval: intervalMs,
            engine,
        });
    }, [rules, allowMutation, isPlaying, intervalMs, engine]);
    function computeNextBoard() {
        simulationRef.current?.send({ type: 'step' });
    }
    function resetBoard() {
        setIsPlaying(false);
        simulationRef.current?.send({ type: 'reset' });
    }

    function toggleMode() {
        setRules(getPresetRule(mode === 'conway' ? 'seeds' : 'conway'));
    }

    async function loadRle(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = ''; // Permite volver a seleccionar el mismo archivo.
        if (!file) return;
        setIsPlaying(false);
        setIsLoading(true);
        setFileError('');
        setFileStatus('');
        try {
            const result = await simulationRef.current?.request<LoadResult>({
                type: 'load',
                file,
            });
            if (!result) return;
            setRules(result.rule);
            setAllowMutation(false);
            setDimensions({ columns: result.columns, rows: result.rows });
            setFileStatus(`Patrón cargado: ${file.name}.`);
        } catch (error) {
            setFileError(
                error instanceof Error
                    ? error.message
                    : 'No se pudo leer el archivo.',
            );
        } finally {
            setIsLoading(false);
        }
    }

    async function exportBoard(format: 'rle' | 'binary') {
        setIsLoading(true);
        setIsPlaying(false);
        setFileError('');
        try {
            const picker = (
                window as Window & {
                    showSaveFilePicker?: (options: {
                        suggestedName: string;
                        types: {
                            description: string;
                            accept: Record<string, string[]>;
                        }[];
                    }) => Promise<FileSystemFileHandle>;
                }
            ).showSaveFilePicker;
            if (format === 'rle' && picker) {
                const handle = await picker.call(window, {
                    suggestedName: `patron-${mode}.rle`,
                    types: [
                        {
                            description: 'Patrón RLE',
                            accept: { 'text/plain': ['.rle'] },
                        },
                    ],
                });
                const output = transferFileStream(
                    await handle.createWritable(),
                );
                try {
                    await simulationRef.current?.request(
                        { type: 'export-stream', stream: output.stream },
                        [output.stream],
                    );
                    await output.finished;
                } catch (error) {
                    await output.abort(error).catch(() => {});
                    throw error;
                }
                setFileStatus('Estado exportado.');
                return;
            }
            const blob = await simulationRef.current?.request<Blob>({
                type: 'export',
                format,
            });
            if (!blob) return;
            const url = URL.createObjectURL(blob),
                link = document.createElement('a');
            link.href = url;
            link.download = `patron-${mode}.${format === 'binary' ? 'cgl' : 'rle'}`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 60000);
            setFileStatus('Estado exportado.');
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError'))
                onError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsLoading(false);
        }
    }
    async function applySettings(
        nextColumns: number,
        nextRows: number,
        nextInterval: number,
    ) {
        if (nextColumns !== columns || nextRows !== rows) {
            setIsPlaying(false);
            setIsLoading(true);
            try {
                await simulationRef.current?.request({
                    type: 'resize',
                    columns: nextColumns,
                    rows: nextRows,
                });
                setDimensions({ columns: nextColumns, rows: nextRows });
                setFileError('');
                setFileStatus(
                    `Tablero redimensionado: ${nextColumns} × ${nextRows}.`,
                );
            } catch (error) {
                onError(
                    error instanceof Error
                        ? error.message
                        : 'No se pudo reservar memoria.',
                );
            } finally {
                setIsLoading(false);
            }
        }
        setIntervalMs(nextInterval);
    }
    return (
        <>
            <ThemeToggle />
            <div>
                <h1>
                    {mode === 'conway'
                        ? "Conway's Game of Life"
                        : mode === 'seeds'
                          ? 'Seeds'
                          : `Reglas personalizadas: ${formatRule(rules)}`}
                </h1>
                <div className="canvas-container">
                    <fieldset
                        className="button-bar"
                        disabled={isLoading}
                        aria-label="Controles del tablero"
                    >
                        <button disabled={isPlaying} onClick={computeNextBoard}>
                            Siguiente
                        </button>
                        <button onClick={resetBoard}>Reset</button>
                        <button onClick={() => setIsPlaying(!isPlaying)}>
                            {isPlaying ? 'Stop' : 'Play'}
                        </button>

                        <button
                            onClick={toggleMode}
                            className={`btn-mode ${mode === 'conway' ? 'btn-mode-conway' : 'btn-mode-seeds'}`}
                        >
                            Modo:{' '}
                            {mode === 'conway'
                                ? 'Conway'
                                : mode === 'seeds'
                                  ? 'Seeds'
                                  : 'Personalizado'}
                        </button>
                        <button
                            onClick={() => {
                                setIsPlaying(false);
                                setIsRulesOpen(true);
                            }}
                        >
                            Editar reglas
                        </button>

                        <button
                            onClick={() => setAllowMutation(!allowMutation)}
                            className={
                                allowMutation
                                    ? 'btn-mutation-on'
                                    : 'btn-mutation-off'
                            }
                        >
                            Mutación: {allowMutation ? 'ON' : 'OFF'}
                        </button>
                        <button
                            onClick={() => {
                                setIsPlaying(false);
                                fileInputRef.current?.click();
                            }}
                        >
                            Cargar patrón o estado
                        </button>
                        <button onClick={() => exportBoard('rle')}>
                            Exportar RLE
                        </button>
                        <button onClick={() => exportBoard('binary')}>
                            Guardar estado compacto
                        </button>
                        <button
                            onClick={() => {
                                setIsPlaying(false);
                                setIsLibraryOpen(true);
                            }}
                        >
                            Biblioteca de patrones
                        </button>
                    </fieldset>
                    <label className="engine-selector">
                        Motor
                        <select
                            value={engine}
                            disabled={isLoading}
                            onChange={(event) =>
                                setEngine(event.target.value as Engine)
                            }
                        >
                            <option value="cpu">CPU</option>
                            <option value="gpu">GPU (WebGPU)</option>
                            <option value="auto">Automático</option>
                        </select>
                    </label>
                    {metrics && (
                        <p className="performance-metrics" role="status">
                            {metrics.engine} · {metrics.gps.toFixed(1)}{' '}
                            generaciones/s · Cálculo:{' '}
                            {metrics.stepMs.toFixed(2)} ms · Dibujo:{' '}
                            {metrics.drawMs.toFixed(2)} ms
                            {metrics.active >= 0 &&
                                ` · Regiones activas: ${(metrics.active * 100).toFixed(1)}%`}
                            {` · Estado CPU: ${(metrics.stateBytes / 1048576).toFixed(1)} MiB`}
                            {metrics.notice && ` · ${metrics.notice}`}
                        </p>
                    )}
                    <BoardSettings
                        columns={columns}
                        rows={rows}
                        intervalMs={intervalMs}
                        disabled={isLoading}
                        onApply={applySettings}
                    />
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.rle,.cgl,text/plain,application/octet-stream"
                        hidden
                        aria-label="Archivo de patrón RLE"
                        onChange={loadRle}
                    />
                    {fileError && (
                        <p className="error" role="alert">
                            {fileError}
                        </p>
                    )}
                    <p className="file-status" role="status">
                        {isLoading ? 'Cargando patrón…' : fileStatus}
                    </p>

                    <BoardView
                        columns={columns}
                        rows={rows}
                        disabled={isLoading || isRulesOpen || isLibraryOpen}
                        tool={tool}
                        onToolChange={setTool}
                        selectedRle={selectedPattern?.rle ?? null}
                        onOpenLibrary={() => setIsLibraryOpen(true)}
                        simulationRef={simulationRef}
                        onMetrics={onMetrics}
                        onError={onError}
                    />
                    <GenerationCounter valor={count} />
                </div>
            </div>
            {isRulesOpen && (
                <RulesEditor
                    rules={rules}
                    onClose={() => setIsRulesOpen(false)}
                    onApply={(nextRules) => {
                        setRules(nextRules);
                        setIsRulesOpen(false);
                    }}
                />
            )}
            {isLibraryOpen && (
                <Suspense fallback={<p role="status">Cargando biblioteca…</p>}>
                    <PatternLibrary
                        onClose={() => setIsLibraryOpen(false)}
                        onSelect={(pattern) => {
                            setSelectedPattern(pattern);
                            setTool('stamp');
                            setIsLibraryOpen(false);
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}

export default App;
