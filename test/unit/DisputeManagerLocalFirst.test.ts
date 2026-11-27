import { Codec, hash, Type } from "@/utils";
import { stageMirrorMissingJoin } from "@test/fixtures/MirrorDivergenceStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Own-dispute construction asks the chain whether the auditing data may be
// omitted (the last milestone holds the anchor or is final by everyone) and
// which participants the chain slashed. The mirror is not read. A thrown read
// is fatal: no other source answers instead. Reads are observed record-only on
// the constructing peer.
describe("Unit: DisputeManager.constructDispute chain reads", function () {
    it("chain not final (a late joiner's signature is missing) -> one chain read, no mirror read, the auditing data is posted", async function () {
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
        expect(local.reads).to.equal(0);
        expect(chain.answers).to.deep.equal([false]);
    });

    it("chain final -> one chain read, no mirror read, the auditing data is left out", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );

        const { dispute } = await h.dispute.fetchConstructedDispute(0);

        expect(dispute.postedAuditingData).to.equal(false);
        const { local, chain } = await reads.observation();
        expect(local.reads).to.equal(0);
        expect(chain.answers).to.deep.equal([true]);
    });

    it("mirror missing the join, chain not final -> the chain answers: one chain read, no mirror read, the auditing data is posted", async function () {
        const h = TestSession.getHarness();
        await stageMirrorMissingJoin(h, 0);
        const reads = await h.mirror.observe(
            0,
            "isAuditingDataOmissionAllowed"
        );

        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(0);

        const { local, chain } = await reads.observation();
        expect(local.reads).to.equal(0);
        expect(chain.answers).to.deep.equal([false]);
        expect(dispute.postedAuditingData).to.equal(true);
        expect(dispute.input.disputeAuditingDataHash).to.equal(
            hash(Codec.encode(auditingData, Type.DisputeAuditingData))
        );
    });

    it("chain reads proven, mirror missing the join -> the chain answers: one chain read, no mirror read, the auditing data is posted", async function () {
        const h = TestSession.getHarness();
        await stageMirrorMissingJoin(h, 0);
        const proven = h.control(h.getPeer(0));
        await proven.stub.stubProvenChainReads().request();
        try {
            const reads = await h.mirror.observe(
                0,
                "isAuditingDataOmissionAllowed"
            );

            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);

            const { local, chain } = await reads.observation();
            await reads.restore();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
            expect(dispute.postedAuditingData).to.equal(true);
            expect(dispute.input.disputeAuditingDataHash).to.equal(
                hash(Codec.encode(auditingData, Type.DisputeAuditingData))
            );
        } finally {
            await proven.stub.restoreProvenChainReads().request();
        }
    });

    it("the on-chain slashed participants are read from the chain, not the mirror", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const reads = await h.mirror.observe(
            0,
            "getOnChainSlashedParticipants"
        );

        const { dispute } = await h.dispute.fetchConstructedDispute(0);

        const { local, chain } = await reads.observation();
        await reads.restore();
        expect(dispute.input.onChainSlashes).to.deep.equal([]);
        expect(local.reads).to.equal(0);
        expect(chain.reads).to.be.greaterThan(0);
    });

    it("chain reads proven -> the on-chain slashed participants are read from the chain, not the mirror", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const proven = h.control(h.getPeer(0));
        await proven.stub.stubProvenChainReads().request();
        try {
            const reads = await h.mirror.observe(
                0,
                "getOnChainSlashedParticipants"
            );

            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            const { local, chain } = await reads.observation();
            await reads.restore();
            expect(dispute.input.onChainSlashes).to.deep.equal([]);
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.be.greaterThan(0);
        } finally {
            await proven.stub.restoreProvenChainReads().request();
        }
    });

    it("chain RPC refuses the connection -> construction throws it, no mirror read", async function () {
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
        expect(local.reads).to.equal(0);
        expect(chain.failures).to.have.length(1);
        expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
    });
});
