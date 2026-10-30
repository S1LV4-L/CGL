import { PackedLife } from '../simulation/packedLife.ts';
import type { Camera } from './camera.ts';

/** Occupancy summaries, 4x4 and successive powers of two; updated only for changed tiles. */
export class OccupancyPyramid {
    readonly levels: {
        width: number;
        height: number;
        data: Uint8Array;
        size: number;
    }[] = [];
    constructor(columns: number, rows: number) {
        for (let size = 4; ; size *= 2) {
            const width = Math.ceil(columns / size),
                height = Math.ceil(rows / size);
            this.levels.push({
                width,
                height,
                data: new Uint8Array(width * height),
                size,
            });
            if (width === 1 && height === 1) break;
        }
    }
    update(sim: PackedLife) {
        sim.drainChanges((tile) => {
            const tx = tile % sim.stride,
                ty = Math.floor(tile / sim.stride);
            const base = this.levels[0];
            for (
                let by = ty * 8;
                by < Math.min(base.height, ty * 8 + 8);
                by++
            ) {
                const row = by * 4;
                let word = 0;
                for (let y = row; y < Math.min(sim.rows, row + 4); y++)
                    word |= sim.words[y * sim.stride + tx];
                for (let dx = 0; dx < 8 && tx * 8 + dx < base.width; dx++)
                    base.data[by * base.width + tx * 8 + dx] = Number(
                        !!(word & (15 << (dx * 4))),
                    );
            }
            let x0 = tx * 8,
                y0 = ty * 8,
                x1 = Math.min(base.width, x0 + 8),
                y1 = Math.min(base.height, y0 + 8);
            for (let l = 1; l < this.levels.length; l++) {
                const prev = this.levels[l - 1],
                    curr = this.levels[l];
                x0 >>>= 1;
                y0 >>>= 1;
                x1 = Math.ceil(x1 / 2);
                y1 = Math.ceil(y1 / 2);
                for (let y = y0; y < y1; y++)
                    for (let x = x0; x < x1; x++) {
                        let value = 0;
                        for (let dy = 0; dy < 2; dy++)
                            for (let dx = 0; dx < 2; dx++)
                                if (
                                    2 * x + dx < prev.width &&
                                    2 * y + dy < prev.height
                                )
                                    value |=
                                        prev.data[
                                            (2 * y + dy) * prev.width +
                                                2 * x +
                                                dx
                                        ];
                        curr.data[y * curr.width + x] = value;
                    }
            }
        });
    }
}

export function rasterize(
    sim: PackedLife,
    pyramid: OccupancyPyramid,
    camera: Camera,
    width: number,
    height: number,
    pixels: Uint32Array,
) {
    pyramid.update(sim);
    pixels.fill(0xff2a2017);
    const { scale } = camera,
        left = width / 2 - camera.x * scale,
        top = height / 2 - camera.y * scale;
    const rect = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        color: number,
    ) => {
        x0 = Math.max(0, Math.min(width, Math.floor(x0)));
        y0 = Math.max(0, Math.min(height, Math.floor(y0)));
        x1 = Math.max(0, Math.min(width, Math.ceil(x1)));
        y1 = Math.max(0, Math.min(height, Math.ceil(y1)));
        if (x1 <= x0 || y1 <= y0) return;
        for (let y = y0; y < y1; y++)
            pixels.fill(color, y * width + x0, y * width + x1);
    };
    rect(
        left,
        top,
        left + sim.columns * scale,
        top + sim.rows * scale,
        0xff000000,
    );
    const level =
        scale < 0.25
            ? pyramid.levels[
                  Math.min(
                      pyramid.levels.length - 1,
                      Math.max(0, Math.floor(Math.log2(1 / scale)) - 2),
                  )
              ]
            : null;
    const block = level?.size ?? 1;
    const minX = Math.max(0, Math.floor(-left / scale / block)),
        minY = Math.max(0, Math.floor(-top / scale / block));
    const maxX = Math.min(
        Math.ceil(sim.columns / block),
        Math.ceil((width - left) / scale / block),
    );
    const maxY = Math.min(
        Math.ceil(sim.rows / block),
        Math.ceil((height - top) / scale / block),
    );
    for (let y = minY; y < maxY; y++)
        for (let x = minX; x < maxX; x++) {
            if (!(level ? level.data[y * level.width + x] : sim.getCell(x, y)))
                continue;
            const px = Math.floor(left + x * block * scale),
                py = Math.floor(top + y * block * scale);
            rect(
                px,
                py,
                Math.min(
                    left + sim.columns * scale,
                    Math.max(px + 1, left + (x + 1) * block * scale),
                ),
                Math.min(
                    top + sim.rows * scale,
                    Math.max(py + 1, top + (y + 1) * block * scale),
                ),
                0xffffffff,
            );
        }
    if (scale >= 6) {
        for (let x = minX; x <= maxX; x++)
            rect(
                left + x * scale,
                Math.max(0, top),
                left + x * scale + 1,
                Math.min(height, top + sim.rows * scale),
                0xff444444,
            );
        for (let y = minY; y <= maxY; y++)
            rect(
                Math.max(0, left),
                top + y * scale,
                Math.min(width, left + sim.columns * scale),
                top + y * scale + 1,
                0xff444444,
            );
    }
}
