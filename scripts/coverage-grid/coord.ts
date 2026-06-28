export interface Coord {
    struct: string;
    field: string;
    cls: string;
}

const COORD_RE = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+):([A-Za-z0-9-]+)$/;

export const parseCoord = (s: string): Coord | null => {
    const m = s.match(COORD_RE);
    return m ? { struct: m[1], field: m[2], cls: m[3] } : null;
};

export const coordKey = (c: Coord): string => `${c.struct}.${c.field}:${c.cls}`;

export const fieldKey = (struct: string, field: string): string =>
    `${struct}.${field}`;

export type Status = "covered" | "untagged" | "none" | "na";

// "untagged" = a test touches it but declares no scenario
export const statusOf = (mapped: number, loose: number): Status =>
    mapped ? "covered" : loose ? "untagged" : "none";

export class MultiMap<V> {
    private m = new Map<string, V[]>();
    add(k: string, v: V): this {
        const a = this.m.get(k);
        if (a) a.push(v);
        else this.m.set(k, [v]);
        return this;
    }
    get(k: string): V[] {
        return this.m.get(k) ?? [];
    }
    has(k: string): boolean {
        return this.m.has(k);
    }
    entries(): [string, V[]][] {
        return [...this.m.entries()];
    }
}

export class MultiSet {
    private m = new Map<string, Set<string>>();
    add(k: string, v: string): this {
        const s = this.m.get(k);
        if (s) s.add(v);
        else this.m.set(k, new Set([v]));
        return this;
    }
    get(k: string): string[] {
        return [...(this.m.get(k) ?? [])];
    }
}
