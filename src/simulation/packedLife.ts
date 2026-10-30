import { getPresetRule } from './life.ts';

export const TILE = 32;
const LOG_FAILURE = Math.log1p(-0.0001);

/** Independent Bernoulli mutations, sampled by geometric gaps in O(mutations). */
export function forEachMutation(
    length: number,
    random: () => number,
    flip: (index: number) => void,
) {
    for (let index = -1; ;) {
        const u = Math.max(0, Math.min(1, random()));
        const gap = Math.floor(Math.log1p(-u) / LOG_FAILURE);
        index += gap + 1;
        if (index >= length || !Number.isFinite(index)) break;
        flip(index);
    }
}

/** Adds eight bit planes: each bit position represents an independent cell. */
export function evolveWord(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number,
    alive: number,
    rule: Uint8Array,
    preset: number,
) {
    const s0 = a ^ b,
        s1 = c ^ d,
        s2 = e ^ f,
        s3 = g ^ h;
    const c0 = a & b,
        c1 = c & d,
        c2 = e & f,
        c3 = g & h;
    const l0 = s0 ^ s1,
        l1 = s2 ^ s3;
    const t0 = s0 & s1,
        t1 = s2 & s3;
    const m0 = c0 ^ c1 ^ t0,
        m1 = c2 ^ c3 ^ t1;
    const h0 = (c0 & c1) | ((c0 ^ c1) & t0),
        h1 = (c2 & c3) | ((c2 ^ c3) & t1);
    const carry = l0 & l1;
    const lo = l0 ^ l1,
        mid = m0 ^ m1 ^ carry;
    const carry2 = (m0 & m1) | ((m0 ^ m1) & carry);
    const hi = h0 ^ h1 ^ carry2,
        top = (h0 & h1) | ((h0 ^ h1) & carry2);
    if (preset === 1) return ~(hi | top) & mid & (lo | alive);
    if (preset === 2) return ~(hi | top | lo | alive) & mid;
    let born = 0,
        survive = 0;
    for (let n = 0; n <= 8; n++) {
        if (!rule[n] && !rule[n + 9]) continue;
        const equal =
            (n & 1 ? lo : ~lo) &
            (n & 2 ? mid : ~mid) &
            (n & 4 ? hi : ~hi) &
            (n & 8 ? top : ~top);
        if (rule[n]) born |= equal;
        if (rule[n + 9]) survive |= equal;
    }
    return (born & ~alive) | (survive & alive);
}

export class PackedLife {
    readonly stride: number;
    readonly tileRows: number;
    readonly tileCount: number;
    private current: Uint32Array<ArrayBuffer>;
    private next: Uint32Array<ArrayBuffer>;
    private active: Uint32Array;
    private queued: Uint8Array;
    private following: Uint32Array;
    private followingMask: Uint8Array;
    private activeLength = 0;
    private followingLength = 0;
    private summaryMask: Uint8Array;
    private summaryList: Uint32Array;
    private summaryLength = 0;
    private denseFlags: Uint8Array;
    private key = -1;
    lastActive = 0;
    lastPath: 'disperso' | 'denso' = 'disperso';
    readonly columns: number;
    readonly rows: number;

    constructor(columns: number, rows: number) {
        this.columns = columns;
        this.rows = rows;
        this.stride = Math.ceil(columns / 32);
        this.tileRows = Math.ceil(rows / 32);
        this.tileCount = this.stride * this.tileRows;
        this.current = new Uint32Array(this.stride * rows);
        this.next = new Uint32Array(this.current.length);
        this.active = new Uint32Array(this.tileCount);
        this.following = new Uint32Array(this.tileCount);
        this.queued = new Uint8Array(this.tileCount);
        this.followingMask = new Uint8Array(this.tileCount);
        this.summaryMask = new Uint8Array(this.tileCount);
        this.summaryList = new Uint32Array(this.tileCount);
        this.denseFlags = new Uint8Array(this.tileCount);
    }
    get words() {
        return this.current;
    }
    get stateBytes() {
        return this.current.byteLength * 2;
    }
    get activeCount() {
        return this.activeLength;
    }
    getCell(x: number, y: number) {
        return (this.current[y * this.stride + (x >>> 5)] >>> (x & 31)) & 1;
    }

    private enqueue(tile: number, following = false) {
        if (following) {
            if (!this.followingMask[tile]) {
                this.followingMask[tile] = 1;
                this.following[this.followingLength++] = tile;
            }
        } else if (!this.queued[tile]) {
            this.queued[tile] = 1;
            this.active[this.activeLength++] = tile;
        }
    }
    private wake(
        tx: number,
        ty: number,
        following = false,
        horizontal = 3,
        vertical = 3,
    ) {
        for (let dy = -1; dy <= 1; dy++) {
            if ((dy === -1 && !(vertical & 1)) || (dy === 1 && !(vertical & 2)))
                continue;
            for (let dx = -1; dx <= 1; dx++) {
                if (
                    (dx === -1 && !(horizontal & 1)) ||
                    (dx === 1 && !(horizontal & 2))
                )
                    continue;
                this.enqueue(
                    ((ty + dy + this.tileRows) % this.tileRows) * this.stride +
                        ((tx + dx + this.stride) % this.stride),
                    following,
                );
            }
        }
    }
    private markSummary(tile: number) {
        if (!this.summaryMask[tile]) {
            this.summaryMask[tile] = 1;
            this.summaryList[this.summaryLength++] = tile;
        }
    }
    drainChanges(visit: (tile: number) => void) {
        for (let i = 0; i < this.summaryLength; i++) {
            const tile = this.summaryList[i];
            visit(tile);
            this.summaryMask[tile] = 0;
        }
        this.summaryLength = 0;
    }
    setCell(x: number, y: number, value: number) {
        if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return;
        const index = y * this.stride + (x >>> 5),
            mask = 1 << (x & 31);
        if (this.getCell(x, y) === value) return;
        this.current[index] = value
            ? this.current[index] | mask
            : this.current[index] & ~mask;
        const tx = x >>> 5,
            ty = y >>> 5;
        this.wake(
            tx,
            ty,
            false,
            Number((x & 31) === 0) |
                (Number((x & 31) === 31 || x === this.columns - 1) << 1),
            Number((y & 31) === 0) |
                (Number((y & 31) === 31 || y === this.rows - 1) << 1),
        );
        this.markSummary(ty * this.stride + tx);
    }
    setRun(x: number, y: number, length: number) {
        if (y < 0 || y >= this.rows) return;
        const end = Math.min(this.columns, x + length);
        x = Math.max(0, x);
        while (x < end) {
            const tx = x >>> 5,
                count = Math.min(end - x, 32 - (x & 31));
            const mask = (0xffffffff >>> (32 - count)) << (x & 31),
                index = y * this.stride + tx;
            if ((this.current[index] | mask) !== (this.current[index] | 0)) {
                this.current[index] |= mask;
                this.wake(tx, y >>> 5);
                this.markSummary((y >>> 5) * this.stride + tx);
            }
            x += count;
        }
    }
    /** External word uploads must be followed by this method. */
    invalidate() {
        for (let tile = 0; tile < this.tileCount; tile++) {
            this.enqueue(tile);
            this.markSummary(tile);
        }
    }
    replace(words: Uint32Array) {
        this.reset();
        this.current.set(words);
        this.activateOccupied();
    }
    activateOccupied() {
        for (let y = 0; y < this.rows; y++)
            for (let tx = 0; tx < this.stride; tx++) {
                if (this.current[y * this.stride + tx]) {
                    this.wake(tx, y >>> 5);
                    this.markSummary((y >>> 5) * this.stride + tx);
                }
            }
    }
    reset() {
        this.current.fill(0);
        this.next.fill(0);
        this.queued.fill(0);
        this.followingMask.fill(0);
        this.activeLength = this.followingLength = 0;
        this.key = -1;
        this.lastActive = 0;
        this.lastPath = 'disperso';
        for (let i = 0; i < this.tileCount; i++) this.markSummary(i);
    }
    step(
        rule = getPresetRule('conway'),
        mutation = false,
        random = Math.random,
    ) {
        let key = 0;
        for (let n = 0; n < 18; n++) key |= Number(!!rule[n]) << n;
        if (key !== this.key) {
            // Non-B0 rules cannot activate a completely empty neighbourhood.
            if (rule[0])
                for (let t = 0; t < this.tileCount; t++) this.enqueue(t);
            else if (this.key !== -1) {
                for (let y = 0; y < this.rows; y++)
                    for (let x = 0; x < this.stride; x++)
                        if (this.current[y * this.stride + x])
                            this.wake(x, y >>> 5);
            }
            this.key = key;
        }
        const preset =
            key === ((1 << 3) | (1 << 11) | (1 << 12)) ? 1 : key === 4 ? 2 : 0;
        this.lastActive = this.activeLength;
        this.lastPath =
            this.activeLength > this.tileCount / 2 ? 'denso' : 'disperso';
        const cur = this.current,
            next = this.next,
            stride = this.stride,
            rows = this.rows;
        const tailBits = ((this.columns - 1) & 31) + 1;
        const tailMask = 0xffffffff >>> (32 - tailBits);
        const calculate = (tx: number, y: number) => {
            const up = (y === 0 ? rows - 1 : y - 1) * stride;
            const row = y * stride,
                down = (y === rows - 1 ? 0 : y + 1) * stride;
            const l = tx === 0 ? stride - 1 : tx - 1,
                r = tx === stride - 1 ? 0 : tx + 1;
            const leftBit = tx === 0 ? tailBits - 1 : 31;
            const rightBit = tx === stride - 1 ? tailBits - 1 : 31;
            const a = cur[up + tx],
                b = cur[row + tx],
                c = cur[down + tx];
            const value =
                evolveWord(
                    (a << 1) | (cur[up + l] >>> leftBit),
                    a,
                    (a >>> 1) | ((cur[up + r] & 1) << rightBit),
                    (b << 1) | (cur[row + l] >>> leftBit),
                    (b >>> 1) | ((cur[row + r] & 1) << rightBit),
                    (c << 1) | (cur[down + l] >>> leftBit),
                    c,
                    (c >>> 1) | ((cur[down + r] & 1) << rightBit),
                    b,
                    rule,
                    preset,
                ) & (tx === stride - 1 ? tailMask : -1);
            next[row + tx] = value;
            return value ^ b;
        };
        const record = (tile: number, flags: number) => {
            if (!flags) return;
            this.wake(
                tile % stride,
                Math.floor(tile / stride),
                true,
                flags & 3,
                (flags >>> 2) & 3,
            );
            this.markSummary(tile);
        };
        if (this.lastPath === 'denso') {
            this.denseFlags.fill(0);
            // Contiguous rows for dense states, while still tracking each tile for the next sparse step.
            for (let y = 0; y < rows; y++)
                for (let tx = 0; tx < stride; tx++) {
                    const diff = calculate(tx, y);
                    if (!diff) continue;
                    this.denseFlags[(y >>> 5) * stride + tx] |=
                        16 |
                        Number(!!(diff & 1)) |
                        (Number(
                            !!(
                                diff &
                                (1 << (tx === stride - 1 ? tailBits - 1 : 31))
                            ),
                        ) <<
                            1) |
                        (Number((y & 31) === 0) << 2) |
                        (Number((y & 31) === 31 || y === rows - 1) << 3);
                }
            for (let tile = 0; tile < this.tileCount; tile++)
                record(tile, this.denseFlags[tile]);
        } else
            for (let i = 0; i < this.activeLength; i++) {
                const tile = this.active[i],
                    tx = tile % stride,
                    ty = Math.floor(tile / stride);
                const first = ty * 32,
                    end = Math.min(rows, first + 32);
                let flags = 0;
                for (let y = first; y < end; y++) {
                    const diff = calculate(tx, y);
                    if (!diff) continue;
                    flags |=
                        16 |
                        Number(!!(diff & 1)) |
                        (Number(
                            !!(
                                diff &
                                (1 << (tx === stride - 1 ? tailBits - 1 : 31))
                            ),
                        ) <<
                            1) |
                        (Number(y === first) << 2) |
                        (Number(y === end - 1) << 3);
                }
                record(tile, flags);
            }
        if (mutation)
            forEachMutation(this.columns * rows, random, (index) => {
                const y = Math.floor(index / this.columns),
                    x = index - y * this.columns;
                next[y * stride + (x >>> 5)] ^= 1 << (x & 31);
                this.wake(x >>> 5, y >>> 5, true);
                this.markSummary((y >>> 5) * stride + (x >>> 5));
            });
        this.current = next;
        this.next = cur;
        for (let i = 0; i < this.activeLength; i++)
            this.queued[this.active[i]] = 0;
        [this.active, this.following] = [this.following, this.active];
        [this.queued, this.followingMask] = [this.followingMask, this.queued];
        this.activeLength = this.followingLength;
        this.followingLength = 0;
    }
}

/** Copy the centred intersection in word-sized spans, without expanding to bytes. */
export function resizePacked(sim: PackedLife, columns: number, rows: number) {
    const next = new PackedLife(columns, rows),
        w = Math.min(sim.columns, columns),
        h = Math.min(sim.rows, rows);
    const sx = Math.floor((sim.columns - w) / 2),
        sy = Math.floor((sim.rows - h) / 2);
    const dx = Math.floor((columns - w) / 2),
        dy = Math.floor((rows - h) / 2);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x += 32) {
            const source = sx + x,
                shift = source & 31,
                index = (sy + y) * sim.stride + (source >>> 5);
            let bits = sim.words[index] >>> shift;
            if (shift && (source >>> 5) + 1 < sim.stride)
                bits |= sim.words[index + 1] << (32 - shift);
            bits &= 0xffffffff >>> (32 - Math.min(32, w - x));
            const dest = dx + x,
                offset = dest & 31,
                target = (dy + y) * next.stride + (dest >>> 5);
            next.words[target] |= bits << offset;
            if (offset && (dest >>> 5) + 1 < next.stride)
                next.words[target + 1] |= bits >>> (32 - offset);
        }
    next.activateOccupied();
    return next;
}
