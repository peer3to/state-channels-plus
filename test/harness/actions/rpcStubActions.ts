// Rpc-method stub actions. Closures run in the test isolate via tamper-bridge callback.

import { Logger } from "@/utils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { RpcStubHandlerFn } from "@test/harness/core/PeerHandle";

export class RpcStubActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

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
            await peer.rpcStub.restoreCreateRpcMethodStub(
                serviceName,
                methodName
            );
        };
    }

    async restoreAllStubs(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeerHandle(peerIndex);
        await peer.rpcStub.restoreAll();
    }
}
