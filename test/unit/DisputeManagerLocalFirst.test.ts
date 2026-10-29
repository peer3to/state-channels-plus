import { Codec, hash, Type } from "@/utils";
import { stageMirrorMissingJoin } from "@test/fixtures/MirrorDivergenceStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Own-dispute construction asks the local diamond whether the auditing data
// may be omitted (the last milestone holds the anchor or is final by
// everyone). Posting the auditing data is never wrong, so a local "must post"
// is kept; leaving it out is slashable, so a local "may omit" is confirmed
// on-chain. A thrown read is fatal: no tier answers instead. Reads are
// observed record-only on the constructing peer.
describe("Unit: DisputeManager.constructDispute local-first finality", function () {
    it("local not final -> kept without a chain read, the auditing data is posted", async function () {
        const h = TestSession.getHarness();
        // peer 3 joins late: the head milestone waits for its signature
        await h.scenario.preDisputeSetupCalldataPath();
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );

        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(0);

        expect(dispute.postedAuditingData).to.equal(true);
        expect(dispute.input.disputeAuditingDataHash).to.equal(
            hash(Codec.encode(auditingData, Type.DisputeAuditingData))
        );
        const { local, chain } = await reads.observation();
        expect(local.answers).to.deep.equal([false]);
        expect(chain.reads).to.equal(0);
    });

    it("local final, chain final -> one chain read, the auditing data is left out", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );

        const { dispute } = await h.dispute.fetchConstructedDispute(0);

        expect(dispute.postedAuditingData).to.equal(false);
        const { local, chain } = await reads.observation();
        expect(local.answers).to.deep.equal([true]);
        expect(chain.answers).to.deep.equal([true]);
    });

    it("mirror missing the join: local final, chain not final -> one chain read, the auditing data is posted", async function () {
        const h = TestSession.getHarness();
        await stageMirrorMissingJoin(h, 0);
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );

        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(0);

        const { local, chain } = await reads.observation();
        expect(local.answers).to.deep.equal([true]);
        expect(chain.answers).to.deep.equal([false]);
        expect(dispute.postedAuditingData).to.equal(true);
        expect(dispute.input.disputeAuditingDataHash).to.equal(
            hash(Codec.encode(auditingData, Type.DisputeAuditingData))
        );
    });

    it("local revert -> construction throws it, no chain read", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );
        await h.mirror.failNextLocalRead(
            0,
            "isAuditingDataOmissionAllowed",
            "revert"
        );

        const failure = await h.dispute.fetchConstructedDispute(0).then(
            () => null,
            (error: unknown) =>
                error instanceof Error ? error.message : String(error)
        );

        const { local, chain } = await reads.observation();
        expect(local.failures).to.have.length(1);
        expect(local.failures[0]).to.contain("Local EVM execution failed");
        expect(failure).to.contain("Local EVM execution failed");
        expect(chain.reads).to.equal(0);
    });

    it("local executor failure (not a revert) -> construction throws it, no chain read", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );
        await h.mirror.failNextLocalRead(
            0,
            "isAuditingDataOmissionAllowed",
            "transport"
        );

        const failure = await h.dispute.fetchConstructedDispute(0).then(
            () => null,
            (error: unknown) =>
                error instanceof Error ? error.message : String(error)
        );

        expect(failure).to.contain("Malformed RPC request");
        const { chain } = await reads.observation();
        expect(chain.reads).to.equal(0);
    });

    it("local final, chain RPC refuses the connection -> construction throws it", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );
        await h.mirror.failNextChainRead(
            0,
            "isAuditingDataOmissionAllowed",
            "transport"
        );

        const failure = await h.dispute.fetchConstructedDispute(0).then(
            () => null,
            (error: unknown) =>
                error instanceof Error ? error.message : String(error)
        );

        expect(failure).to.not.equal(null);
        const { local, chain } = await reads.observation();
        expect(local.answers).to.deep.equal([true]);
        expect(chain.failures).to.have.length(1);
        expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
    });
});
