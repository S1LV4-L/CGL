import { useEffect, useRef, useState } from "react";
import { formatRule, getPresetRule } from "../simulation/life";

type Props = {
    rules: Uint8Array;
    onApply: (rules: Uint8Array) => void;
    onClose: () => void;
};

const columns = [
    { title: "Sobrevive", offset: 9 },
    { title: "Revive", offset: 0 },
];

export function RulesEditor({ rules, onApply, onClose }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [draft, setDraft] = useState<Uint8Array>(() => rules.slice());

    useEffect(() => {
        const dialog = dialogRef.current;
        dialog?.showModal();
        return () => dialog?.close();
    }, []);

    function toggle(offset: number, neighbors: number) {
        setDraft(previous => {
            const next = previous.slice();
            next[offset + neighbors] = 1 - next[offset + neighbors];
            return next;
        });
    }

    return (
        <dialog ref={dialogRef} className="rules-dialog" aria-labelledby="rules-title"
            aria-describedby="rules-description" onCancel={onClose}>
            <h2 id="rules-title">Reglas del juego</h2>
            <p id="rules-description">Selecciona con cuántos vecinos (0–8) una célula viva
                sobrevive o una célula muerta revive. Sin marcar, muere o sigue muerta, respectivamente.</p>
            <div className="rules-presets">
                <span>Preajustes:</span>
                <button onClick={() => setDraft(getPresetRule("conway"))}>Conway</button>
                <button onClick={() => setDraft(getPresetRule("seeds"))}>Seeds</button>
            </div>
            <div className="rules-columns">
                {columns.map(({ title, offset }) => (
                    <fieldset key={title} className="rules-column">
                        <legend>{title}</legend>
                        {Array.from({ length: 9 }, (_, neighbors) => (
                            <label key={neighbors} className="rules-choice">
                                <input type="checkbox" checked={draft[offset + neighbors] === 1}
                                    aria-label={`${title}: ${neighbors} vecinos`}
                                    onChange={() => toggle(offset, neighbors)} />
                                <span>{neighbors}</span>
                            </label>
                        ))}
                    </fieldset>
                ))}
            </div>
            <p className="rules-notation">Regla: <strong>{formatRule(draft)}</strong></p>
            <div className="rules-actions">
                <button onClick={onClose}>Cancelar</button>
                <button className="rules-apply" onClick={() => onApply(draft)}>Aplicar reglas</button>
            </div>
        </dialog>
    );
}
