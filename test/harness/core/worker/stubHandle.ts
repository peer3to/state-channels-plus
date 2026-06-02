import type { StubInterface, StubMethodFn } from "../interfaces/StubInterface";
import type { RestoreToken } from "../interfaces/common";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import type { StubCallbackRegistry } from "../StubCallbackRegistry";
import { ROUTES } from "../../threaded/worker/routeNames";

export class WorkerStubHandle implements StubInterface {
    // orchestrator-side token -> callback id map. parallel to WorkerRpcStubHandle.
    private readonly liveCallbackIds = new Map<string, string>();

    constructor(
        private readonly rpc: PeerCaller,
        private readonly registry: StubCallbackRegistry
    ) {}

    async stubMethod(path: string, fn: StubMethodFn): Promise<RestoreToken> {
        const callbackId = this.registry.registerStub((args) =>
            (fn as (...a: unknown[]) => unknown)(...args)
        );
        const token = (await this.rpc.call(ROUTES.stub.stubMethod, {
            path,
            callbackId
        })) as RestoreToken;
        this.liveCallbackIds.set(token.id, callbackId);
        return token;
    }

    async restoreStubbedMethod(token: RestoreToken): Promise<void> {
        const callbackId = this.liveCallbackIds.get(token.id);
        if (callbackId) {
            this.registry.unregisterStub(callbackId);
            this.liveCallbackIds.delete(token.id);
        }
        await this.rpc.call(ROUTES.stub.restoreStubbedMethod, {
            tokenId: token.id
        });
    }

    async restoreAllStubbedMethods(): Promise<void> {
        for (const id of this.liveCallbackIds.values()) {
            this.registry.unregisterStub(id);
        }
        this.liveCallbackIds.clear();
        await this.rpc.call(ROUTES.stub.restoreAllStubbedMethods, {});
    }
}
