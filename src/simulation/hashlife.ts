import { PackedLife } from './packedLife.ts';

type Node = {
    id: number;
    level: number;
    population: number;
    nw?: Node;
    ne?: Node;
    sw?: Node;
    se?: Node;
};
export class HashLifeLimit extends Error {}

/** Canonical quadtrees and memoized central successors, including power-of-two jumps.
 * The padded input is tiled periodically, preserving the rectangular torus exactly.
 * Bounded interning prevents chaotic patterns exhausting the browser heap.
 */
export class HashLife {
    private dead: Node = { id: 0, level: 0, population: 0 };
    private alive: Node = { id: 1, level: 0, population: 1 };
    private nodes = new Map<string, Node>();
    private results = new Map<string, Node>();
    private zeros: Node[] = [this.dead];
    private rule: Uint8Array;
    private limit: number;
    constructor(rule: Uint8Array, limit = 200000) {
        this.rule = rule.slice();
        this.limit = limit;
    }
    private join(nw: Node, ne: Node, sw: Node, se: Node): Node {
        const key = `${nw.id},${ne.id},${sw.id},${se.id}`;
        let node = this.nodes.get(key);
        if (!node) {
            if (this.nodes.size + this.results.size >= this.limit)
                throw new HashLifeLimit(
                    'Patrón poco repetitivo: se usa el motor por regiones.',
                );
            node = {
                id: this.nodes.size + 2,
                level: nw.level + 1,
                population:
                    nw.population +
                    ne.population +
                    sw.population +
                    se.population,
                nw,
                ne,
                sw,
                se,
            };
            this.nodes.set(key, node);
        }
        return node;
    }
    private empty(level: number): Node {
        while (this.zeros.length <= level) {
            const z = this.zeros.at(-1)!;
            this.zeros.push(this.join(z, z, z, z));
        }
        return this.zeros[level];
    }
    private cell(node: Node, x: number, y: number): number {
        if (!node.level) return node.population;
        const half = 2 ** (node.level - 1);
        return this.cell(
            y < half
                ? x < half
                    ? node.nw!
                    : node.ne!
                : x < half
                  ? node.sw!
                  : node.se!,
            x % half,
            y % half,
        );
    }
    private successor(node: Node, exponent: number): Node {
        const key = `${node.id}:${exponent}`;
        const cached = this.results.get(key);
        if (cached) return cached;
        let result: Node;
        if (node.level === 2) {
            const out: Node[] = [];
            for (let y = 1; y <= 2; y++)
                for (let x = 1; x <= 2; x++) {
                    let count = 0;
                    for (let dy = -1; dy <= 1; dy++)
                        for (let dx = -1; dx <= 1; dx++)
                            if (dx || dy)
                                count += this.cell(node, x + dx, y + dy);
                    out.push(
                        this.rule[this.cell(node, x, y) * 9 + count]
                            ? this.alive
                            : this.dead,
                    );
                }
            result = this.join(out[0], out[1], out[2], out[3]);
        } else {
            const a = node.nw!,
                b = node.ne!,
                c = node.sw!,
                d = node.se!;
            const nine = [
                a,
                this.join(a.ne!, b.nw!, a.se!, b.sw!),
                b,
                this.join(a.sw!, a.se!, c.nw!, c.ne!),
                this.join(a.se!, b.sw!, c.ne!, d.nw!),
                this.join(b.sw!, b.se!, d.nw!, d.ne!),
                c,
                this.join(c.ne!, d.nw!, c.se!, d.sw!),
                d,
            ];
            const s = nine.map((n) =>
                this.successor(n, Math.min(exponent, node.level - 3)),
            );
            const quadrants: Node[] = [];
            for (const i of [0, 1, 3, 4]) {
                quadrants.push(
                    exponent === node.level - 2
                        ? this.successor(
                              this.join(s[i], s[i + 1], s[i + 3], s[i + 4]),
                              exponent - 1,
                          )
                        : this.join(
                              s[i].se!,
                              s[i + 1].sw!,
                              s[i + 3].ne!,
                              s[i + 4].nw!,
                          ),
                );
            }
            result = this.join(
                quadrants[0],
                quadrants[1],
                quadrants[2],
                quadrants[3],
            );
        }
        if (this.nodes.size + this.results.size >= this.limit)
            throw new HashLifeLimit('Se alcanzó el límite de caché HashLife.');
        this.results.set(key, result);
        return result;
    }
    advance(sim: PackedLife, remaining: number) {
        const level = Math.max(
            2,
            Math.ceil(Math.log2(2 * Math.max(sim.columns, sim.rows))),
        );
        const size = 2 ** level,
            offset = size / 4;
        const exponent = Math.min(level - 2, Math.floor(Math.log2(remaining)));
        let population = 0;
        const points: number[] = [];
        for (let i = 0; i < sim.words.length; i++) {
            let word = sim.words[i];
            while (word) {
                const bit = 31 - Math.clz32(word & -word),
                    x = (i % sim.stride) * 32 + bit,
                    y = Math.floor(i / sim.stride);
                word &= word - 1;
                if (++population > 100000)
                    throw new HashLifeLimit(
                        'Se usa el motor denso para este patrón.',
                    );
                const firstX = (x + offset) % sim.columns,
                    firstY = (y + offset) % sim.rows;
                for (let py = firstY; py < size; py += sim.rows)
                    for (let px = firstX; px < size; px += sim.columns) {
                        if (points.length >= 500000)
                            throw new HashLifeLimit(
                                'Se alcanzó el límite de preparación HashLife.',
                            );
                        points.push(py * size + px);
                    }
            }
        }
        const build = (
            cells: number[],
            x: number,
            y: number,
            depth: number,
        ): Node => {
            if (!cells.length) return this.empty(depth);
            if (!depth) return this.alive;
            const half = 2 ** (depth - 1),
                quadrants: number[][] = [[], [], [], []];
            for (const cell of cells)
                quadrants[
                    Number(Math.floor(cell / size) >= y + half) * 2 +
                        Number(cell % size >= x + half)
                ].push(cell);
            return this.join(
                build(quadrants[0], x, y, depth - 1),
                build(quadrants[1], x + half, y, depth - 1),
                build(quadrants[2], x, y + half, depth - 1),
                build(quadrants[3], x + half, y + half, depth - 1),
            );
        };
        const root = build(points, 0, 0, level);
        const result = this.successor(root, exponent);
        // Commit only after a successful calculation; limit failures leave the input intact.
        sim.reset();
        const visit = (node: Node, x: number, y: number) => {
            if (!node.population || x >= sim.columns || y >= sim.rows) return;
            if (node.population === 4 ** node.level) {
                const size = 2 ** node.level;
                for (let row = y; row < Math.min(sim.rows, y + size); row++)
                    sim.setRun(x, row, size);
                return;
            }
            if (!node.level) {
                sim.setCell(x, y, 1);
                return;
            }
            const half = 2 ** (node.level - 1);
            visit(node.nw!, x, y);
            visit(node.ne!, x + half, y);
            visit(node.sw!, x, y + half);
            visit(node.se!, x + half, y + half);
        };
        visit(result, 0, 0);
        return 2 ** exponent;
    }
}
