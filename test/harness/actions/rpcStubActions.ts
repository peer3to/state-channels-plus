// step 1 - W1 §6 bucket (iii) / D-22 - named-handler surface. test sources ship
// a stable handlerId (+ optional handlerArgs) instead of a lambda; the handler
// body lives once in test/harness/worker-handlers/rpc-stub-handlers.ts (or is
// registered ephemerally via registerTemporaryRpcStubHandler for genuinely
// test-local cases). action class delegates to peer.rpcStub.* on the handle;
// inline backend runs the body in-process, worker backend forwards via rpc.

import { Logger } from "@/utils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class RpcStubActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    // step 1 - install a named rpc-method stub on one peer's localRpc service.
    // returns an async restore that reverts the wrapper. handlerId resolves
    // against the shared registry (worker-handlers/rpc-stub-handlers.ts).
    async installNamedStub(options: {
        peerIndex: number;
        serviceName: string;
        methodName: string;
        handlerId: string;
        handlerArgs?: unknown;
    }): Promise<() => Promise<void>> {
        const { peerIndex, serviceName, methodName, handlerId, handlerArgs } =
            options;
        const peer = this.harness.getPeerHandle(peerIndex);
        await peer.rpcStub.installCreateRpcMethodStub({
            serviceName,
            methodName,
            handlerId,
            handlerArgs
        });
        this.logger.debug(
            `Stubbed RPC method '${methodName}' on service '${serviceName}' for peer ${peerIndex} via handler '${handlerId}'`
        );
        return async () => {
            await peer.rpcStub.restoreCreateRpcMethodStub({
                serviceName,
                methodName
            });
        };
    }

    async restoreAllStubs(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeerHandle(peerIndex);
        await peer.rpcStub.restoreAll();
    }
}
