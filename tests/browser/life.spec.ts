import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('slow GPU previews do not impose one render wait per generation', async ({
    page,
}) => {
    await page.route('**/src/simulation/gpuLife.ts*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        await route.fulfill({
            response,
            body:
                source +
                `
const normalDraw = GpuLife.prototype.draw;
GpuLife.prototype.draw = async function (...args) {
    await new Promise(resolve => setTimeout(resolve, 250));
    return normalDraw.apply(this, args);
};
`,
        });
    });
    await page.goto('/');
    const result = await page.evaluate(async () => {
        if (!navigator.gpu || !(await navigator.gpu.requestAdapter()))
            return {
                skipped: true,
                generations: 0,
                frames: 0,
                painted: false,
                errors: [],
            };
        const { createRuntime } = await import('/src/simulation/runtime.ts');
        const { getPresetRule } = await import('/src/simulation/life.ts');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('bitmaprenderer')!;
        const transfer = context.transferFromImageBitmap.bind(context);
        let frames = 0,
            generation = 0;
        context.transferFromImageBitmap = (bitmap) => {
            frames++;
            transfer(bitmap);
        };
        const errors: string[] = [];
        const runtime = createRuntime(
            canvas,
            (metrics) => {
                generation = metrics.generation;
            },
            (error) => errors.push(error),
        );
        const rule = getPresetRule('conway');
        try {
            await runtime.request({ type: 'init', columns: 65, rows: 37 });
            await runtime.request({
                type: 'view',
                camera: { x: 32, y: 18, scale: 5 },
                width: 128,
                height: 128,
            });
            const before = frames;
            await runtime.request({
                type: 'configure',
                rule,
                mutation: false,
                playing: true,
                interval: 1,
                engine: 'gpu',
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await runtime.request({
                type: 'configure',
                rule,
                mutation: false,
                playing: false,
                interval: 1,
                engine: 'cpu',
            });
            // A pending preview and its completion must not clear a newer edit.
            await runtime.request({
                type: 'paint',
                x0: 32,
                y0: 18,
                x1: 32,
                y1: 18,
                first: true,
            });
            let painted = false;
            const reader = new OffscreenCanvas(128, 128).getContext('2d')!;
            for (let i = 0; i < 30 && !painted; i++) {
                const image = await createImageBitmap(canvas);
                try {
                    reader.drawImage(image, 0, 0);
                    painted = reader
                        .getImageData(66, 66, 1, 1)
                        .data.every((value) => value === 255);
                } finally {
                    image.close();
                }
                if (!painted)
                    await new Promise((resolve) => setTimeout(resolve, 20));
            }
            return {
                skipped: false,
                generations: generation,
                frames: frames - before,
                painted,
                errors,
            };
        } finally {
            runtime.dispose();
        }
    });
    test.skip(result.skipped, 'No WebGPU adapter in this browser.');
    expect(result.errors).toEqual([]);
    expect(result.generations).toBeGreaterThan(10);
    expect(result.frames).toBeLessThanOrEqual(5);
    expect(result.painted).toBe(true);
});

test('engine selector restores CPU, GPU and automatic without HashLife controls', async ({
    page,
}) => {
    await page.goto('/');
    const selector = page.getByRole('combobox', { name: 'Motor', exact: true });
    await expect(selector).toHaveValue('cpu');
    await expect(selector.getByRole('option')).toHaveCount(3);
    await page.locator('input[type="file"]').setInputFiles({
        name: 'glider.rle',
        mimeType: 'text/plain',
        buffer: Buffer.from('x=3,y=3\nbo$2bo$3o!'),
    });
    await expect(page.locator('.file-status')).toContainText('glider.rle');
    const hasGpu = await page.evaluate(
        async () => !!(await navigator.gpu?.requestAdapter()),
    );
    await selector.selectOption('gpu');
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Generaciones: 1', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.performance-metrics')).toContainText(
        hasGpu ? 'GPU' : 'CPU',
    );
    await selector.selectOption('cpu');
    await expect(page.locator('.performance-metrics')).toContainText('CPU');
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Generaciones: 2', exact: true }),
    ).toBeVisible();
    await selector.selectOption('auto');
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Generaciones: 3', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.performance-metrics')).toContainText('CPU');
    await expect(
        page.getByRole('button', { name: 'Avanzar', exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByText('Generaciones a avanzar', { exact: true }),
    ).toHaveCount(0);
});

test('fullscreen shortcuts work from toolbar and page, while respecting inputs and dialogs', async ({
    page,
}) => {
    await page.goto('/');
    await expect(page.locator('.performance-metrics')).toContainText('CPU');
    const toolbar = page.getByRole('group', { name: 'Navegación del tablero' });
    const fullscreen = () =>
        page.evaluate(
            () =>
                document.fullscreenElement?.classList.contains(
                    'board-viewport',
                ) ?? false,
        );
    await toolbar.getByRole('button', { name: 'Mover', exact: true }).click();
    await page.keyboard.press('f');
    await expect.poll(fullscreen).toBe(true);
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole('button')).toHaveCount(12);
    await toolbar.getByRole('button', { name: 'Acercar', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect.poll(fullscreen).toBe(false);
    await page.locator('input[name="columns"]').focus();
    await page.keyboard.press('f');
    expect(await fullscreen()).toBe(false);
    await page
        .getByRole('button', { name: 'Editar reglas', exact: true })
        .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('f');
    expect(await fullscreen()).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Shift+f');
    await expect.poll(fullscreen).toBe(true);
    await toolbar
        .getByRole('button', { name: 'Salir pantalla completa', exact: true })
        .click();
    await expect.poll(fullscreen).toBe(false);
});

test('all navigation controls float inside the lower right corner on desktop and mobile', async ({
    page,
}) => {
    await page.goto('/');
    for (const size of [
        { width: 1280, height: 1000 },
        { width: 390, height: 844 },
    ]) {
        await page.setViewportSize(size);
        const viewport = page.locator('.board-viewport');
        const toolbar = viewport.getByRole('group', {
            name: 'Navegación del tablero',
        });
        await viewport.scrollIntoViewIfNeeded();
        await expect(toolbar.getByRole('button')).toHaveCount(12);
        await expect
            .poll(async () => {
                const outer = await viewport.boundingBox(),
                    inner = await toolbar.boundingBox();
                if (!outer || !inner) return false;
                const right = outer.x + outer.width - inner.x - inner.width;
                const bottom = outer.y + outer.height - inner.y - inner.height;
                return (
                    inner.x >= outer.x &&
                    inner.y >= outer.y &&
                    right >= 8 &&
                    right <= 16 &&
                    bottom >= 8 &&
                    bottom <= 16
                );
            })
            .toBe(true);
        await toolbar
            .getByRole('button', { name: 'Mover', exact: true })
            .click();
        await expect(
            toolbar.getByRole('button', { name: 'Mover', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        await page.screenshot({
            path: `test-results/cpu-controls-${size.width}.png`,
            fullPage: true,
        });
    }
});

test('GPU canvas survives resize and bitmap transfers that reset its configuration', async ({
    page,
}) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
        if (!navigator.gpu || !(await navigator.gpu.requestAdapter()))
            return { skipped: true, frames: 0, resizes: 0 };
        const { PackedLife } = await import('/src/simulation/packedLife.ts');
        const { GpuLife } = await import('/src/simulation/gpuLife.ts');
        const sim = new PackedLife(64, 64);
        sim.setRun(16, 16, 2);
        sim.setRun(16, 17, 2);
        const prototype = OffscreenCanvas.prototype;
        const width = Object.getOwnPropertyDescriptor(prototype, 'width')!;
        const height = Object.getOwnPropertyDescriptor(prototype, 'height')!;
        const transfer = prototype.transferToImageBitmap;
        let resizes = 0,
            frames = 0;
        // Exercise stricter context lifecycle semantics using a real WebGPU device.
        for (const [property, descriptor] of [
            ['width', width],
            ['height', height],
        ] as const) {
            Object.defineProperty(prototype, property, {
                ...descriptor,
                set(this: OffscreenCanvas, value: number) {
                    descriptor.set!.call(this, value);
                    const context = this.getContext('webgpu');
                    if (context) {
                        resizes++;
                        context.unconfigure();
                    }
                },
            });
        }
        prototype.transferToImageBitmap = function () {
            const bitmap = transfer.call(this);
            this.getContext('webgpu')?.unconfigure();
            return bitmap;
        };
        let gpu: Awaited<ReturnType<typeof GpuLife.create>> = null;
        try {
            gpu = await GpuLife.create(sim);
            if (!gpu)
                throw new Error('GPU unavailable after adapter initialization');
            for (const [w, h] of [
                [64, 64],
                [64, 64],
                [128, 80],
                [128, 80],
                [96, 64],
            ]) {
                const bitmap = await gpu.draw({ x: 17, y: 17, scale: 8 }, w, h);
                try {
                    if (bitmap.width !== w || bitmap.height !== h)
                        throw new Error('Incorrect frame dimensions');
                    const reader = new OffscreenCanvas(w, h).getContext('2d')!;
                    reader.drawImage(bitmap, 0, 0);
                    const pixel = reader.getImageData(
                        w / 2 - 4,
                        h / 2 - 4,
                        1,
                        1,
                    ).data;
                    if (!pixel.every((value) => value === 255))
                        throw new Error(
                            'Live cells disappeared after context reset',
                        );
                    frames++;
                } finally {
                    bitmap.close();
                }
            }
        } finally {
            gpu?.destroy();
            Object.defineProperty(prototype, 'width', width);
            Object.defineProperty(prototype, 'height', height);
            prototype.transferToImageBitmap = transfer;
        }
        return { skipped: false, frames, resizes };
    });
    test.skip(result.skipped, 'No WebGPU adapter in this browser.');
    expect(result.frames).toBe(5);
    expect(result.resizes).toBe(6);
});

test('12000 square: CPU worker, compact save/load and responsive navigation', async ({
    page,
}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('.performance-metrics')).toContainText('CPU');
    await page.locator('input[name="rows"]').fill('12000');
    await page.getByRole('button', { name: 'Aplicar configuración' }).click();
    await expect(page.locator('.file-status')).toContainText('12000 × 12000');
    await page.locator('input[type="file"]').setInputFiles({
        name: 'glider.rle',
        mimeType: 'text/plain',
        buffer: Buffer.from('x=3,y=3\nbo$2bo$3o!'),
    });
    await expect(page.locator('.file-status')).toContainText('glider.rle');
    await page.getByRole('button', { name: 'Ver todo', exact: true }).click();
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Generaciones: 1', exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole('combobox', { name: 'Motor', exact: true }),
    ).toHaveValue('cpu');
    await expect(
        page.getByRole('button', { name: 'Avanzar', exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByText('Generaciones a avanzar', { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.performance-metrics')).toContainText('CPU');
    await expect(page.locator('.performance-metrics')).toContainText(
        '34.3 MiB',
    );
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Guardar estado compacto' }).click();
    const download = await downloadPromise,
        path = (await download.path())!;
    expect((await readFile(path)).byteLength).toBe(18000048);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Generaciones: 0', exact: true }),
    ).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
        name: 'saved.cgl',
        mimeType: 'application/octet-stream',
        buffer: await readFile(path),
    });
    await expect(
        page.getByRole('heading', { name: 'Generaciones: 1', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Acercar', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    expect(errors).toEqual([]);
});

test('actual WebGPU shaders agree with packed CPU, including partial words, narrow tori and rules', async ({
    page,
}) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
        // Vite serves the application modules, exercising the production WGSL unchanged.
        const { PackedLife } = await import('/src/simulation/packedLife.ts');
        const { GpuLife } = await import('/src/simulation/gpuLife.ts');
        const { getPresetRule } = await import('/src/simulation/life.ts');
        if (!navigator.gpu || !(await navigator.gpu.requestAdapter()))
            return { skipped: true, cases: 0 };
        let cases = 0;
        for (const [w, h] of [
            [1, 7],
            [2, 3],
            [31, 33],
            [33, 35],
            [12000, 12000],
        ]) {
            const cpu = new PackedLife(w, h);
            let seed = 42;
            for (let i = 0; i < cpu.words.length; i++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                cpu.words[i] =
                    seed &
                    (i % cpu.stride === cpu.stride - 1
                        ? 0xffffffff >>> (32 - (((w - 1) & 31) + 1))
                        : -1);
            }
            cpu.invalidate();
            const gpu = await GpuLife.create(cpu);
            if (!gpu)
                throw new Error(
                    'Adapter available but engine failed to initialize',
                );
            try {
                for (const rule of [
                    getPresetRule('conway'),
                    getPresetRule('seeds'),
                    Uint8Array.from({ length: 18 }, (_, i) =>
                        Number(i % 3 === 0),
                    ),
                ]) {
                    for (let generation = 0; generation < 3; generation++) {
                        cpu.step(rule);
                        await gpu.step(rule, false);
                    }
                    const actual = await gpu.download();
                    for (let i = 0; i < actual.length; i++)
                        if (actual[i] !== cpu.words[i])
                            throw new Error(
                                `GPU mismatch ${w}x${h}, word ${i}`,
                            );
                    const bitmap = await gpu.draw(
                        { x: w / 2, y: h / 2, scale: Math.min(1, 256 / w) },
                        256,
                        256,
                    );
                    bitmap.close();
                    cases++;
                }
            } finally {
                gpu.destroy();
            }
        }
        return { skipped: false, cases };
    });
    test.skip(
        result.skipped,
        'No WebGPU adapter in this browser. CPU coverage runs separately.',
    );
    expect(result.cases).toBe(15);
});

test('worker import is atomic and RLE export streams with backpressure', async ({
    page,
}) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
        const { createRuntime, transferFileStream } =
            await import('/src/simulation/runtime.ts');
        const { getPresetRule } = await import('/src/simulation/life.ts');
        const { PackedLife } = await import('/src/simulation/packedLife.ts');
        const { readCheckpoint } = await import('/src/simulation/rleStream.ts');
        const errors: string[] = [];
        const runtime = createRuntime(
            document.createElement('canvas'),
            () => {},
            (error) => errors.push(error),
        );
        try {
            await runtime.request({ type: 'init', columns: 65, rows: 37 });
            await runtime.request({
                type: 'load',
                file: new File(['x=3,y=3\nbo$2bo$3o!'], 'glider.rle'),
            });
            await runtime.request({ type: 'step' });
            const before = await runtime.request<Blob>({
                type: 'export',
                format: 'binary',
            });
            let rejected = false;
            try {
                await runtime.request({
                    type: 'load',
                    file: new File(['x=3,y=3\n3o$4o!'], 'bad.rle'),
                });
            } catch {
                rejected = true;
            }
            const after = await runtime.request<Blob>({
                type: 'export',
                format: 'binary',
            });
            const chunks: Uint8Array[] = [];
            const stream = new WritableStream<Uint8Array>({
                write(chunk) {
                    chunks.push(chunk);
                },
            });
            await runtime.request({ type: 'export-stream', stream }, [stream]);
            const text = await new Blob(chunks as BlobPart[]).text();
            const directory = await navigator.storage.getDirectory();
            const handle = await directory.getFileHandle('streamed-test.rle', {
                create: true,
            });
            const diskStream = transferFileStream(
                await handle.createWritable(),
            );
            await runtime.request(
                { type: 'export-stream', stream: diskStream.stream },
                [diskStream.stream],
            );
            await diskStream.finished;
            if ((await (await handle.getFile()).text()) !== text)
                throw new Error('File stream differs from memory export');
            await directory.removeEntry('streamed-test.rle');
            const rule = getPresetRule('conway');
            await runtime.request({
                type: 'configure',
                rule,
                mutation: false,
                playing: false,
                interval: 100,
            });
            for (let i = 0; i < 3; i++) await runtime.request({ type: 'step' });
            await runtime.request({
                type: 'configure',
                rule,
                mutation: false,
                playing: false,
                interval: 100,
            });
            await runtime.request({ type: 'step' });
            const saved = await readCheckpoint(
                await runtime.request<Blob>({
                    type: 'export',
                    format: 'binary',
                }),
            );
            const expected = new PackedLife(65, 37);
            for (const [x, y] of [
                [1, 0],
                [2, 1],
                [0, 2],
                [1, 2],
                [2, 2],
            ])
                expected.setCell(31 + x, 17 + y, 1);
            for (let i = 0; i < 5; i++) expected.step(rule);
            if (saved.words.some((word, i) => word !== expected.words[i]))
                throw new Error('CPU configuration changed the state');
            return {
                rejected,
                same:
                    [...new Uint8Array(await before.arrayBuffer())].join(
                        ',',
                    ) ===
                    [...new Uint8Array(await after.arrayBuffer())].join(','),
                text,
                errors,
            };
        } finally {
            runtime.dispose();
        }
    });
    expect(result.rejected).toBeTruthy();
    expect(result.same).toBeTruthy();
    expect(result.text).toContain('x = 65, y = 37');
    expect(result.text.trim().endsWith('!')).toBeTruthy();
    expect(result.errors).toEqual([]);
});
