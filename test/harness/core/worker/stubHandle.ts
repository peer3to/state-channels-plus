import type { StubInterface, StubMethodFn } from "../interfaces/StubInterface";
import type {
    RestoreToken,
    RestoreTokenId,
    StubCallbackId,
    StubMethodPath
} from "../interfaces/common";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import type { StubCallbackRegistry } from "../StubCallbackRegistry";
import { ROUTES } from "../../threaded/worker/routeNames";

export class WorkerStubHandle implements StubInterface {
    // worker restore token -> orchestrator callback id. parallel to WorkerRpcStubHandle.
    private readonly liveCallbackIds = new Map<
        RestoreTokenId,
        StubCallbackId
    >();

    constructor(
        private readonly rpc: PeerCaller,
        private readonly registry: StubCallbackRegistry
    ) {}

    async stubMethod(
        path: StubMethodPath,
        fn: StubMethodFn
    ): Promise<RestoreToken> {
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
}
