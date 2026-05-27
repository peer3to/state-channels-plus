// step 1 - action namespace for rpc-method stubs. test source passes an inline
// closure; orchestrator runs it either in-process (inline backend) or via the
// W3 bidirectional rpc callback (worker backend) -> closures stay in the test
// isolate, never serialised, free to capture test-local state.

import { Logger } from "@/utils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { RpcStubHandlerFn } from "@test/harness/core/PeerHandle";

export class RpcStubActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    // step 1 - install a stub closure on one peer's localRpc service. returns
    // an async restore that reverts the wrapper.
    async stubServiceCreateRpcMethod(options: {
        peerIndex: number;
        serviceName: string;
        methodName: string;
        stubbedMethod: RpcStubHandlerFn;
    }): Promise<() => Promise<void>> {
        const { peerIndex, serviceName, methodName, stubbedMethod } = options;
        const peer = this.harness.getPeerHandle(peerIndex);
        await peer.rpcStub.installCreateRpcMethodStub(
            serviceName,
            methodName,
            stubbedMethod
        );
        this.logger.debug(
            `Stubbed RPC method '${methodName}' on service '${serviceName}' for peer ${peerIndex}`
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
