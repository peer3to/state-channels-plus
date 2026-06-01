import type { PeerHandler } from "../../rpc/rpc-server";
import type { PeerCaller } from "../../rpc/rpc-client";
import { ROUTES } from "../routeNames";
import type StateManager from "@/stateManager";

export class StubRoutes {
    private stateManager?: StateManager;
    private readonly debugMethodRestores = new Map<string, () => void>();
    private nextDebugTokenId = 1;

    constructor(
        server: PeerHandler,
        private readonly rpcClient: PeerCaller
    ) {
        this.register(server);
    }

    setStateManager(sm: StateManager): void {
        this.stateManager = sm;
    }

    private get sm(): StateManager {
        if (!this.stateManager)
            throw new Error(
                "stateManager not initialized: p2pSetup has not completed"
            );
        return this.stateManager;
    }

    private register(server: PeerHandler): void {
        server.register(ROUTES.stub.stubMethod, async (args) => {
            const { path, callbackId } = (args ?? {}) as {
                path?: string;
                callbackId?: string;
            };
            if (!path) throw new Error("debug.stubMethod: missing 'path'");
            if (!callbackId)
                throw new Error("debug.stubMethod: missing 'callbackId'");
            const { target, leaf } = walkDottedPath(
                this.sm as unknown as Record<string, unknown>,
                path
            );
            const original = target[leaf];
            const rpcClient = this.rpcClient;
            target[leaf] = async (...callArgs: unknown[]) =>
                await rpcClient.call("harness.invokeStubCallback", {
                    id: callbackId,
                    args: callArgs
                });
            const tokenId = `debugStub#${this.nextDebugTokenId++}`;
            this.debugMethodRestores.set(tokenId, () => {
                target[leaf] = original;
                this.debugMethodRestores.delete(tokenId);
            });
            return { id: tokenId };
        });

        server.register(ROUTES.stub.restoreStubbedMethod, async (args) => {
            const { tokenId } = (args ?? {}) as { tokenId?: string };
            if (!tokenId)
                throw new Error(
                    "debug.restoreStubbedMethod: missing 'tokenId'"
                );
            this.debugMethodRestores.get(tokenId)?.();
            return {};
        });

        server.register(ROUTES.stub.restoreAllStubbedMethods, async () => {
            for (const restore of this.debugMethodRestores.values()) restore();
            this.debugMethodRestores.clear();
            return {};
        });
    }
}

function walkDottedPath(
    root: Record<string, unknown>,
    path: string
): { target: Record<string, unknown>; leaf: string } {
    const parts = path.split(".");
    if (parts.length === 0 || parts.some((p) => p.length === 0))
        throw new Error(`debug.stubMethod: invalid path '${path}'`);
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = cur[parts[i]];
        if (next === undefined || next === null)
            throw new Error(
                `debug.stubMethod: path '${path}' segment '${parts[i]}' is ${String(next)}`
            );
        cur = next as Record<string, unknown>;
    }
    return { target: cur, leaf: parts[parts.length - 1] };
}
