// @spec-test-coverage-ignore: shared real-peer staging for E2E-LocalOnlyGuard
import { RPC_GUARD_REJECTION_ERROR } from "@/rpc/Rpc";
import type { LocalOnlyObservation } from "@test/fixtures/customRpc/localOnlyGuardProbe/LocalOnlyGuardProbeService";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import { PingPongE2EFixture } from "@test/fixtures/PingPongE2EFixture";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";

type Peer = TestPeer<PingPongRpc, MathStateMachine>;

/** How a pending request settles when its transport closes (NetworkRpcRouter). */
export const PEER_DISCONNECTED_ERROR =
    "Peer disconnected before RPC response arrived";

/** The reason LocalOnlyGuard gives the canonical disconnect owner. */
export const LOCAL_ONLY_REASON = "remote call to a local-only RPC";

export class LocalOnlyGuardE2EFixture extends PingPongE2EFixture {
    /** How a caller's rejected request settled: never the guard's error response. */
    public async remoteRequestOutcome(from: Peer, to: Peer, value: string) {
        return this.settle(
            this.control(from)
                .localOnlyGuardTarget.record(value)
                .request(to.address)
        );
    }

    /** How a caller's request to the guard-chain service settled. */
    public async remoteChainOutcome(
        from: Peer,
        to: Peer,
        endpoint: "passEarlierGuard" | "failEarlierGuard",
        value: string
    ) {
        const chain = this.control(from).localOnlyGuardChainTarget;
        return this.settle(
            endpoint === "passEarlierGuard"
                ? chain.passEarlierGuard(value).request(to.address)
                : chain.failEarlierGuard(value).request(to.address)
        );
    }

    public invocations(peer: Peer): Promise<string[]> {
        return this.control(peer)
            .localOnlyGuardTarget.getInvocations()
            .request();
    }

    /**
     * Run `run` under the receiver's record-only dispatch observation and
     * read it back; the observation is restored in the same block.
     */
    public async observe<T>(
        receiver: Peer,
        run: () => Promise<T>
    ): Promise<{ result: T; observation: LocalOnlyObservation }> {
        const probe = this.control(receiver).localOnlyGuardProbe;
        await probe.startObservation().request();
        try {
            const result = await run();
            const observation = await probe.readObservation().request();
            return { result, observation };
        } finally {
            await probe.restoreObservation().request();
        }
    }

    /** The receiver recorded the verdict and the two are no longer connected. */
    public async expectPunished(receiver: Peer, offender: Peer): Promise<void> {
        await waitFor(
            async () =>
                (await this.control(receiver)
                    .query.isBlacklisted(offender.address)
                    .request()) &&
                !(await this.control(receiver)
                    .query.isConnectedTo(offender.address)
                    .request()) &&
                !(await this.control(offender)
                    .query.isConnectedTo(receiver.address)
                    .request()),
            this.harness.event.protocolEventTimeoutMs()
        );
    }

    public expectNoGuardResponse(outcome: string): void {
        expect(outcome).to.not.equal("resolved");
        expect(outcome).to.not.equal(RPC_GUARD_REJECTION_ERROR);
    }

    /**
     * Every observed delivery was rejected by the local-only guard with no
     * response attempt: no dispatcher send, no response frame, no
     * response-send error and no disconnect from the response path. The only
     * direct disconnects are the guard's canonical blacklist calls, exactly
     * one per rejected delivery; the transport's own close bookkeeping is
     * reported separately.
     */
    public expectRejectedWithoutResponse(
        observation: LocalOnlyObservation
    ): void {
        expect(observation.deliveries).to.not.deep.equal([]);
        for (const delivery of observation.deliveries) {
            expect(delivery.responseAttempts).to.equal(0);
            expect(delivery.responseFrames).to.deep.equal([]);
            expect(delivery.transportClosed).to.equal(true);
            expect(delivery.transportOpen).to.equal(false);
        }
        expect(observation.invocations).to.deep.equal([]);
        expect(observation.responseSendErrors).to.equal(0);
        expect(observation.dispatchErrors).to.equal(0);
        expect(
            observation.disconnects.filter(
                (call) => call.origin === "response-failure"
            )
        ).to.deep.equal([]);
        const direct = observation.disconnects.filter(
            (call) => call.origin === "direct"
        );
        // Exactly one canonical decision per rejected delivery.
        expect(direct).to.have.length(observation.deliveries.length);
        for (const call of direct) {
            expect(call).to.deep.equal({
                tier: "BLACKLIST",
                reason: LOCAL_ONLY_REASON,
                origin: "direct"
            });
        }
    }

    /** Wait until `waitFor` reports the captured pre-handshake transport. */
    public async waitForCapturedHandshakeTransport(peer: Peer): Promise<void> {
        await waitFor(
            () =>
                this.harness.execOnHost(
                    peer,
                    (sm) =>
                        !!sm.p2pManager.localRpc.stub
                            .capturedInitHandshakeTransport
                ),
            this.harness.event.protocolEventTimeoutMs()
        );
    }

    private async settle(request: Promise<unknown>): Promise<string> {
        try {
            await request;
            return "resolved";
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }
}
