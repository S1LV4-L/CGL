import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';

const server = await createServer({
    server: { host: '127.0.0.1', port: 5176, strictPort: true },
});
let browser;
try {
    await server.listen();
    browser = await chromium.launch({
        channel: process.platform === 'win32' ? 'msedge' : undefined,
    });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5176');
    const result = await page.evaluate(async () => {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) return { available: false };
        const { PackedLife } = await import('/src/simulation/packedLife.ts');
        const { GpuLife } = await import('/src/simulation/gpuLife.ts');
        const { getPresetRule } = await import('/src/simulation/life.ts');
        const size = 12000,
            initial = new PackedLife(size, size),
            rule = getPresetRule('conway');
        let seed = 42;
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                if (seed / 2 ** 32 < 0.35)
                    initial.words[y * initial.stride + (x >>> 5)] |=
                        1 << (x & 31);
            }
        const first = [],
            warmed = [],
            draws = [];
        for (let sample = 0; sample < 3; sample++) {
            const gpu = await GpuLife.create(initial);
            if (!gpu) throw new Error('GPU initialization failed');
            try {
                let start = performance.now();
                await gpu.step(rule, false);
                first.push(performance.now() - start);
                for (let i = 0; i < 3; i++) await gpu.step(rule, false);
                start = performance.now();
                for (let i = 0; i < 5; i++) await gpu.step(rule, false);
                warmed.push((performance.now() - start) / 5);
                start = performance.now();
                const bitmap = await gpu.draw(
                    { x: 6000, y: 6000, scale: 768 / 12000 },
                    1024,
                    768,
                );
                bitmap.close();
                draws.push(performance.now() - start);
            } finally {
                gpu.destroy();
            }
        }
        const median = (a) => [...a].sort((a, b) => a - b)[1];
        return {
            available: true,
            userAgent: navigator.userAgent,
            adapter: {
                vendor: adapter.info.vendor,
                architecture: adapter.info.architecture,
                description: adapter.info.description,
            },
            size,
            samples: 3,
            pattern: 'random-35-percent',
            mutation: false,
            measuredGenerations: '5-9',
            firstMedianMs: median(first),
            generationMedianMs: median(warmed),
            overviewMedianMs: median(draws),
            first,
            warmed,
            draws,
            note: 'Browser GPU plus queue synchronization; no per-generation readback; default browser GPU configuration',
        };
    });
    await writeFile(
        'benchmarks/gpu-results.json',
        JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify(result, null, 2));
} finally {
    await browser?.close();
    await server.close();
}
