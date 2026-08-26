import { expect } from "chai";
import { ZeroHash } from "ethers";

import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / inbound anchor availability", function () {
    it("a posted snapshot with a behind inbound anchor creates the matching fraud proof", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();
        await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(0);
        expect(dispute.postedAuditingData).to.equal(true);
        expect(dispute.input.latestInboundMessageBlockHash).to.not.equal(
            ZeroHash
        );

        dispute.input.latestInboundMessageBlockHash = ZeroHash;
        dispute.input.lastInboundMessageBlockHeight = 0;

        const run = await h.dispute.auditDispute(1, dispute, auditingData);

        expect(run).to.include({ outcome: "returned", isValid: false });
        expect(run.storedProof?.disputeFraudProofType).to.equal(
            DisputeFraudProofType.DisputeInboundAnchorBehindLatestState
        );
        expect(run.disputeFraudProofCount).to.equal(1);
    });

    it("a non-posted dispute with no local pinned snapshot is not given a false inbound-anchor fraud proof", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
        const { dispute } = await h.dispute.fetchConstructedDispute(0);
        expect(dispute.postedAuditingData).to.equal(false);

        const removed = await h.execOnHost(
            h.getPeer(1),
            (sm, args) => {
                const snapshots = sm.storage.stateSnapshots as unknown as {
                    snapshotsByHash: Map<string, unknown>;
                };
                return snapshots.snapshotsByHash.delete(
                    String(args.snapshotHash)
                );
            },
            { snapshotHash: dispute.input.latestStateSnapshotHash }
        );
        expect(removed).to.equal(true);

        const run = await h.dispute.auditDispute(1, dispute);

        expect(run).to.include({ outcome: "returned", isValid: true });
        expect(run.storedProof).to.equal(undefined);
        expect(run.disputeFraudProofCount).to.equal(0);
    });
});
