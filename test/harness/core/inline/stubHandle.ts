import type { StubHandle, StubMethodFn } from "../handles/StubHandle";
import type { RestoreToken } from "../handles/common";
import type { TestPeer } from "../types";

function walkDottedPath(
    root: Record<string, unknown>,
    path: string
): { target: Record<string, unknown>; leaf: string } {
    const parts = path.split(".");
    if (parts.length === 0 || parts.some((p) => p.length === 0))
        throw new Error(`stubMethod: invalid path '${path}'`);
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = cur[parts[i]];
        if (next === undefined || next === null)
            throw new Error(
                `stubMethod: path '${path}' segment '${parts[i]}' is ${String(next)}`
            );
        cur = next as Record<string, unknown>;
    }
    return { target: cur, leaf: parts[parts.length - 1] };
}

export class InlineStubHandle implements StubHandle {
    private nextTokenId = 1;
    private readonly restoresByToken = new Map<string, () => void>();

    constructor(private readonly peer: TestPeer) {}

    async stubMethod(path: string, fn: StubMethodFn): Promise<RestoreToken> {
        const { target, leaf } = walkDottedPath(
            this.peer.stateManager as unknown as Record<string, unknown>,
            path
        );
        const original = target[leaf];
        target[leaf] = fn;
        const id = `stubMethod#${this.nextTokenId++}`;
        this.restoresByToken.set(id, () => {
            target[leaf] = original;
            this.restoresByToken.delete(id);
        });
        return { id };
    }

    async restoreStubbedMethod(token: RestoreToken): Promise<void> {
        this.restoresByToken.get(token.id)?.();
    }

    async restoreAllStubbedMethods(): Promise<void> {
        for (const restore of this.restoresByToken.values()) restore();
        this.restoresByToken.clear();
    }
}
