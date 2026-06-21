import { Logger } from "@/utils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

/**
 * RPC-method stubs that wrap a service's `createRPCMethods` host-side.
 *
 * The original generic `stubServiceCreateRpcMethod(fn)` shipped an arbitrary
 * main-thread function into the RPC layer; that can't cross the runtime port
 * (the stub needs the host's `this.senderTransport`/`this.service`/`this.remoteRpc`
 * and SDK imports). Each distinct stub is therefore a concrete, named host-side
 * behavior selected here.
 */
export class RpcStubActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {}

    /**
     * Make the given peers answer every spectate request with a proof at
     * `staleBlockHeight` (stale-proof guard test). Returns a teardown.
     */
    async stubSpectateStaleProof(
        peerIndices: number[],
        staleBlockHeight: number
    ): Promise<() => Promise<void>> {
        await Promise.all(
            peerIndices.map((i) =>
                this.harness
                    .control(this.harness.getPeer(i))
                    .stub.stubSpectateStaleProof(staleBlockHeight)
                    .request()
            )
        );
        this.logger.debug(
            `Stubbed spectate stale proof (height ${staleBlockHeight}) on peers [${peerIndices.join(", ")}]`
        );
        return async () => {
            await Promise.all(
                peerIndices.map((i) =>
                    this.harness
                        .control(this.harness.getPeer(i))
                        .stub.restoreSpectateStaleProof()
                        .request()
                )
            );
        };
    }

    /**
     * Replace a peer's `onDisputeAcknowledgmentRequest` with a no-op that records
     * the call. Returns a teardown.
     */
    async stubRecordDisputeAckRequest(
        peerIndex: number
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubRecordDisputeAckRequest()
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreRecordDisputeAckRequest()
                .request();
        };
    }

    async wasDisputeAckRequestCalled(peerIndex: number): Promise<boolean> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.wasDisputeAckRequestCalled()
            .request();
    }
}
