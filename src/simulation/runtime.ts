import type { Camera } from '../rendering/camera.ts';

export type Engine = 'cpu' | 'gpu' | 'auto';
export type Metrics = {
    generation: number;
    stepMs: number;
    drawMs: number;
    gps: number;
    active: number;
    engine: string;
    columns: number;
    rows: number;
    stateBytes: number;
    notice: string;
};
export type Command =
    | { type: 'init'; columns: number; rows: number }
    | { type: 'view'; camera: Camera; width: number; height: number }
    | {
          type: 'configure';
          rule: Uint8Array;
          mutation: boolean;
          playing: boolean;
          interval: number;
          engine?: Engine;
      }
    | { type: 'step' | 'reset' }
    | {
          type: 'paint';
          x0: number;
          y0: number;
          x1: number;
          y1: number;
          first: boolean;
      }
    | { type: 'stamp'; rle: string; x: number; y: number }
    | { type: 'resize'; columns: number; rows: number }
    | { type: 'load'; file: File }
    | { type: 'export-stream'; stream: WritableStream<Uint8Array> }
    | { type: 'export'; format: 'rle' | 'binary' };
export type Envelope = { id?: number; command: Command };
export type LoadResult = { rule: Uint8Array; columns: number; rows: number };

/** Native file streams are not transferable in every browser. This standard
 * WritableStream forwards bounded chunks to the file with backpressure. */
export function transferFileStream(file: FileSystemWritableFileStream) {
    let complete!: () => void, fail!: (reason: unknown) => void;
    const finished = new Promise<void>((resolve, reject) => {
        complete = resolve;
        fail = reject;
    });
    // A transfer can fail before the caller starts awaiting file completion.
    void finished.catch(() => {});
    const abort = async (reason: unknown) => {
        fail(reason);
        await file.abort(reason);
    };
    const stream = new WritableStream<Uint8Array>(
        {
            async write(chunk) {
                try {
                    await file.write(chunk as Uint8Array<ArrayBuffer>);
                } catch (error) {
                    fail(error);
                    throw error;
                }
            },
            async close() {
                try {
                    await file.close();
                    complete();
                } catch (error) {
                    fail(error);
                    throw error;
                }
            },
            abort,
        },
        { highWaterMark: 1 },
    );
    return { stream, finished, abort };
}

export function createRuntime(
    canvas: HTMLCanvasElement,
    onMetrics: (metrics: Metrics) => void,
    onError: (message: string) => void,
) {
    const worker = new Worker(new URL('./life.worker.ts', import.meta.url), {
        type: 'module',
    });
    const bitmapContext = canvas.getContext('bitmaprenderer');
    const fallback = bitmapContext ? null : canvas.getContext('2d');
    let sequence = 0,
        disposed = false;
    const pending = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    const fail = (message: string) => {
        for (const task of pending.values()) task.reject(new Error(message));
        pending.clear();
        onError(message);
    };
    worker.onerror = (event) => {
        disposed = true;
        worker.terminate();
        fail(event.message || 'No se pudo iniciar el motor de simulación.');
    };
    worker.onmessage = ({ data }) => {
        if (disposed) {
            data.bitmap?.close();
            return;
        }
        if (data.type === 'frame') {
            const bitmap = data.bitmap as ImageBitmap;
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            if (bitmapContext) bitmapContext.transferFromImageBitmap(bitmap);
            else fallback?.drawImage(bitmap, 0, 0);
            bitmap.close();
            worker.postMessage({ type: 'frame-consumed' });
        } else if (data.type === 'metrics') onMetrics(data.metrics);
        else if (data.type === 'reply') {
            const task = pending.get(data.id);
            pending.delete(data.id);
            if (data.error) {
                task?.reject(new Error(data.error));
                if (!task) onError(data.error);
            } else task?.resolve(data.value);
        } else if (data.type === 'error') onError(data.message);
    };
    return {
        send(command: Command) {
            if (!disposed) worker.postMessage({ command } satisfies Envelope);
        },
        request<T>(
            command: Command,
            transfer: Transferable[] = [],
        ): Promise<T> {
            if (disposed)
                return Promise.reject(new Error('El motor está cerrado.'));
            const id = ++sequence;
            return new Promise((resolve, reject) => {
                pending.set(id, {
                    resolve: (value) => resolve(value as T),
                    reject,
                });
                try {
                    worker.postMessage(
                        { id, command } satisfies Envelope,
                        transfer,
                    );
                } catch (error) {
                    pending.delete(id);
                    reject(error);
                }
            });
        },
        dispose() {
            disposed = true;
            worker.terminate();
            for (const task of pending.values())
                task.reject(new Error('El motor está cerrado.'));
            pending.clear();
        },
    };
}
export type LifeRuntime = ReturnType<typeof createRuntime>;
