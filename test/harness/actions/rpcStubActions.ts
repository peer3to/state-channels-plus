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
     * Make the given peers answer every spectate request with undecodable junk
     * bytes (a peer returning data that isn't a valid encoded SyncPayload).
     * Returns a teardown.
     */
    async stubSpectateJunkPayload(
        peerIndices: number[]
    ): Promise<() => Promise<void>> {
        await Promise.all(
            peerIndices.map((i) =>
                this.harness
                    .control(this.harness.getPeer(i))
                    .stub.stubSpectateJunkPayload()
                    .request()
            )
        );
        this.logger.debug(
            `Stubbed spectate junk payload on peers [${peerIndices.join(", ")}]`
        );
        return async () => {
            await Promise.all(
                peerIndices.map((i) =>
                    this.harness
                        .control(this.harness.getPeer(i))
                        .stub.restoreSpectateJunkPayload()
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

    /**
     * Make a peer reply to handshake challenges with a faulty response so the
     * initiator rejects it. `delayMs` forces a request timeout; `responseTime
     * OffsetSeconds` skews the response timestamp. Returns a teardown.
     */
    async stubHandshakeResponse(
        peerIndex: number,
        options: {
            delayMs?: number;
            responseTimeOffsetSeconds?: number;
            corruptSignature?: boolean;
        } = {}
    ): Promise<() => Promise<void>> {
        const {
            delayMs = 0,
            responseTimeOffsetSeconds = 0,
            corruptSignature = false
        } = options;
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubHandshakeResponse(
                delayMs,
                responseTimeOffsetSeconds,
                corruptSignature
            )
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreHandshakeResponse()
                .request();
        };
    }
}
