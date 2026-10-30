import { useState } from "react";
import { MAX_BOARD_SIDE, validBoardSize } from "../simulation/resize";

type Props = {
    columns: number;
    rows: number;
    intervalMs: number;
    disabled: boolean;
    onApply: (columns: number, rows: number, intervalMs: number) => void;
};

export function BoardSettings({ columns, rows, intervalMs, disabled, onApply }: Props) {
    const [error, setError] = useState("");
    return (
        <form className="board-settings" onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const width = Number(data.get("columns"));
            const height = Number(data.get("rows"));
            const interval = Number(data.get("interval"));
            if (!validBoardSize(width, height)) {
                setError("El tablero admite hasta 12.699 células por lado y 160.667.748 células en total.");
                return;
            }
            if (!Number.isInteger(interval) || interval < 1 || interval > 60000) return;
            setError("");
            onApply(width, height, interval);
        }}>
            <fieldset disabled={disabled}>
                <legend>Configuración</legend>
                <label>Intervalo (ms)
                    <input name="interval" type="number" min="1" max="60000" step="1" required defaultValue={intervalMs} />
                </label>
                <label>Columnas (células)
                    <input name="columns" type="number" min="1" max={MAX_BOARD_SIDE} step="1" required defaultValue={columns} />
                </label>
                <label>Filas (células)
                    <input name="rows" type="number" min="1" max={MAX_BOARD_SIDE} step="1" required defaultValue={rows} />
                </label>
                <button type="submit">Aplicar configuración</button>
            </fieldset>
            <p className="settings-hint">Tamaño actual: {columns} × {rows} células · {intervalMs} ms entre generaciones.
                Al cambiar el tamaño se pausa el juego y se conserva el centro; al reducir, se recortan los bordes.</p>
            {error && <p className="error" role="alert">{error}</p>}
        </form>
    );
}
