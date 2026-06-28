/**
 * Small seeded PRNG for reproducible fuzz tests.
 *
 * Math.random() can't be seeded, so a failing fuzz run couldn't be replayed.
 * mulberry32 is a ~6-line zero-dependency seedable generator
 */
/** the contract weightedPick chooses among: each candidate carries a relative weight */
export interface Weighted {
    weight: number;
}

export class SeededRng {
    private state: number;

    constructor(readonly seed: number) {
        this.state = SeededRng.toUint32(seed);
    }

    static toUint32(n: number): number {
        return n >>> 0;
    }

    /** seed from `SEED=<n>` env if set, else a fresh random seed (logged for replay) */
    static fromEnv(): SeededRng {
        const seed = process.env.SEED
            ? Number(process.env.SEED)
            : Math.floor(Math.random() * 0x7fffffff);
        return new SeededRng(seed);
    }

    /** next float in [0, 1) - mulberry32 */
    next(): number {
        const a = (this.state = (this.state + 0x6d2b79f5) | 0);
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return SeededRng.toUint32(t ^ (t >>> 14)) / 4294967296;
    }

    /** integer in [min, max] inclusive */
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** uniform pick from a non-empty array */
    pick<T>(items: readonly T[]): T {
        return items[Math.floor(this.next() * items.length)]!;
    }

    /** pick proportional to each item's `weight` */
    weightedPick<T extends Weighted>(items: readonly T[]): T {
        const total = items.reduce((s, it) => s + it.weight, 0);
        let r = this.next() * total;
        for (const it of items) if ((r -= it.weight) < 0) return it;
        return items[items.length - 1]!;
    }
}
