import { useEffect, useMemo, useRef, useState } from 'react';
import { PATTERNS } from '../simulation/patternLibrary';
import type { Pattern } from '../simulation/patternLibrary';
import { inspectRle } from '../simulation/rleStream';

type Props = {
    onClose: () => void;
    onSelect: (pattern: Pattern) => void;
};

function PatternPreview({
    rle,
    width,
    height,
}: {
    rle: string;
    width: number;
    height: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const size = 64;
        ctx.fillStyle = '#17202a';
        ctx.fillRect(0, 0, size, size);
        if (!width || !height) return;
        let result;
        try {
            result = inspectRle(rle, width, height);
        } catch {
            return;
        }
        // Escala el patrón para que quepa en el cuadro de previsualización.
        const cellSize = Math.min(size / width, size / height);
        const px = Math.floor((size - width * cellSize) / 2);
        const py = Math.floor((size - height * cellSize) / 2);
        ctx.fillStyle = 'white';
        result.visit((x, y, length) =>
            ctx.fillRect(
                Math.floor(px + x * cellSize),
                Math.floor(py + y * cellSize),
                Math.max(1, Math.ceil(length * cellSize)),
                Math.max(1, Math.ceil(cellSize)),
            ),
        );
    }, [rle, width, height]);

    return (
        <canvas
            ref={canvasRef}
            width={64}
            height={64}
            aria-hidden="true"
            className="pattern-preview-canvas"
        />
    );
}

export function PatternLibrary({ onClose, onSelect }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [query, setQuery] = useState('');

    useEffect(() => {
        const dialog = dialogRef.current;
        dialog?.showModal();
        return () => dialog?.close();
    }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return PATTERNS;
        return PATTERNS.filter(
            (p) =>
                p.name.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q),
        );
    }, [query]);

    return (
        <dialog
            ref={dialogRef}
            className="pattern-library"
            aria-labelledby="pattern-library-title"
            aria-describedby="pattern-library-description"
            onCancel={onClose}
        >
            <h2 id="pattern-library-title">Biblioteca de patrones</h2>
            <p id="pattern-library-description">
                Elige un patrón para estamparlo donde hagas clic en el tablero.
                Se colocará centrado en el cursor y se dibujará con las reglas
                actuales.
            </p>
            <input
                type="search"
                className="pattern-search"
                placeholder="Buscar por nombre o descripción..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Buscar patrón"
            />
            <div className="pattern-grid">
                {filtered.map((pattern) => (
                    <button
                        key={pattern.id}
                        className="pattern-card"
                        onClick={() => onSelect(pattern)}
                        aria-label={`Estampar ${pattern.name}, ${pattern.width} × ${pattern.height}`}
                        title={pattern.description}
                    >
                        <PatternPreview
                            rle={pattern.rle}
                            width={pattern.width}
                            height={pattern.height}
                        />
                        <span className="pattern-name">{pattern.name}</span>
                        <span className="pattern-size">
                            {pattern.width} × {pattern.height}
                        </span>
                    </button>
                ))}
                {filtered.length === 0 && (
                    <p className="pattern-empty">
                        Sin coincidencias para "{query}".
                    </p>
                )}
            </div>
            <div className="pattern-library-actions">
                <button onClick={onClose}>Cerrar</button>
            </div>
        </dialog>
    );
}
