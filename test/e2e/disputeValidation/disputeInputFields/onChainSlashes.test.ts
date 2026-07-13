import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { randomAddress } from "@test/factory";

describe("E2E: dispute validation / disputeInputFields / onChainSlashes", function () {
    it("dispute.input.onChainSlashes includes address not slashed on-chain → DisputeOnChainSlashesNotSubset", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();

        const fakeSlashedAddress = h.getPeer(0).address;
        await h.tamper.stubConstructDispute(
            1,
            async (dispute, _sm, args) => {
                dispute.input.onChainSlashes = [
                    ...dispute.input.onChainSlashes,
                    args.fakeSlashedAddress as string
                ];
            },
            { args: { fakeSlashedAddress } }
        );

        await h.byzantine.submitForgedInboundMessageBlock(2);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [1],
            initiatedWithAuditingData: false
        });

        await h.event.waitForPeers("onDisputeKilled", [0], 1, {
            mode: "atLeast"
        });

        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeOnChainSlashesNotSubset,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait();
    });

    it("dispute.input.onChainSlashes contains address not in latestStateSnapshot participants → InvalidDisputeReason", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(4, 2, {
            timeConfig: { evidenceTime: 8 }
        });

        // peer 1 misbehaves and gets slashed. After fork resolution, peer 1's
        // address is in the on-chain onChainSlashes registry, but NOT in
        // the new snapshot's participants.
        const slashedAddress = h.getPeer(1).address;
        await h.scenario.disputeAndResolve({
            maliciousPeerIndex: 1,
            forkSettleTimeoutMs: 15000,
            disputesCommittedTimeoutMs: 10000
        });
        await h.assert.snapshot.onChainSnapshotChangedWait({
            previousForkId: h.activeForkId!,
            timeoutMs: 15000
        });

        await h.transition.advanceState({
            waitForPeers: [0, 2, 3]
        });
        h.event.resetEventSpies();
        h.contextApi.captureOriginalFork();

        await h.tamper.stubConstructDispute(
            3,
            async (dispute, sm, args) => {
                dispute.input.timeout.participant =
                    sm.p2pManager.localRpc.dispute.zeroAddress;
                dispute.input.selfRemoval = false;
                dispute.input.onChainSlashes = [args.slashedAddress as string];
            },
            { args: { slashedAddress } }
        );

        await h.byzantine.submitInvalidStateTransitionBlock(2);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [3],
            initiatedWithAuditingData: false
        });

        await h.event.waitForPeers("onDisputeKilled", [0], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType: DisputeFraudProofType.InvalidDisputeReason,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait({
            forkSettleTimeoutMs: 15000
        });
    });

    it("dispute.input.onChainSlashes has > maxSlashCount distinct addresses → reduce must not OOB-panic, both offenders slashed", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({ peerCount: 4 });

        const junkSlashes = Array.from({ length: 8 }, randomAddress);
        await h.tamper.stubConstructDispute(
            1,
            (dispute, _sm, args) => {
                dispute.input.onChainSlashes = args.junkSlashes as string[];
            },
            { args: { junkSlashes } }
        );

        await h.byzantine.submitForgedInboundMessageBlock(2);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [1],
            initiatedWithAuditingData: false
        });

        await h.dispute.resolveDisputeWait();

        await h.assert.dispute.slashedOnChainExactly([
            h.getPeer(1).address,
            h.getPeer(2).address
        ]);
    });
});
