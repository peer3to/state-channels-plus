import StateSnapshot from "@/models/StateSnapshot";
import { Codec, hash, Type } from "@/utils";
import {
    expectInvalidOutboundRun,
    stageOutboundDispute
} from "@test/fixtures/DisputeAuditStaging";
import { chainSnapshot } from "@test/fixtures/MilestoneSyncStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// the chain anchor holds outbound block 1 (the first leave), the latest
// state outbound block 2 (the second leave, its snapshot post held)
describe("Unit: DisputeValidationService outbound run", function () {
    it("auditingData.outboundMessageBlocks = [] while the latest outbound head is above the chain anchor, committed by the dispute -> false + DisputeInvalidOutboundRun, which the chain accepts", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOutboundDispute(h);
        staged.auditingData.outboundMessageBlocks = [];
        staged.commit();

        await expectInvalidOutboundRun(h, staged);
    });

    it("auditingData.outboundMessageBlocks[0].messages[0].balance.amount += 1, committed by the dispute -> false + DisputeInvalidOutboundRun, which the chain accepts", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOutboundDispute(h);
        const [block] = staged.auditingData.outboundMessageBlocks;
        staged.auditingData.outboundMessageBlocks = [
            {
                ...block,
                messages: block.messages.map((message, index) =>
                    index === 0
                        ? {
                              ...message,
                              balance: {
                                  ...message.balance,
                                  amount: BigInt(message.balance.amount) + 1n
                              }
                          }
                        : message
                )
            }
        ];
        staged.commit();

        await expectInvalidOutboundRun(h, staged);
    });

    it("the posted run also carries the chain anchor's own outbound block (built while the anchor was lower) and the auditor holds neither block -> true; only the block above the anchor is stored, and the stored anchor-to-latest range is the run the chain's snapshot update accepts", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOutboundDispute(h);
        const anchorHead = String(staged.anchor.latestOutboundMessageBlockHash);
        const latest = StateSnapshot.from(
            staged.auditingData.latestStateSnapshot
        );
        const latestHead = String(latest.latestOutboundMessageBlockHash);
        // the anchor's own block, as the chain applied it
        const applied = await h.channelManager.queryFilter(
            h.channelManager.filters.OutboundMessagesProcessed(h.channelId)
        );
        const anchorBlock = applied
            .map((log) =>
                Codec.decode(
                    Codec.encode(log.args.messageBlock, Type.MessageBlock),
                    Type.MessageBlock
                )
            )
            .find(
                (block) =>
                    hash(Codec.encode(block, Type.MessageBlock)) === anchorHead
            );
        expect(anchorBlock, "the anchor's outbound block").to.not.equal(
            undefined
        );
        staged.auditingData.outboundMessageBlocks = [
            anchorBlock!,
            ...staged.auditingData.outboundMessageBlocks
        ];
        staged.commit();
        const auditor = h.getPeer(staged.auditorIndex);
        await h.execOnHost(
            auditor,
            (sm, a) => {
                const blocks = (
                    sm.storage.outboundMessages as unknown as {
                        blockMap: Map<string, unknown>;
                    }
                ).blockMap;
                for (const blockHash of a.hashes) blocks.delete(blockHash);
            },
            { hashes: [anchorHead, latestHead] }
        );

        const run = await h.dispute.auditDispute(
            staged.auditorIndex,
            staged.dispute,
            staged.auditingData
        );
        expect(run).to.include({ outcome: "returned", isValid: true });
        expect(run.disputeFraudProofCount).to.equal(0);
        const auditorQuery = h.control(auditor).query;
        expect(
            await auditorQuery.getOutboundMessageBlock(anchorHead).request()
        ).to.equal(null);
        // a snapshot post from the anchor reads this range
        const range = (
            await auditorQuery
                .getOutboundMessageBlocksInRange({
                    upperBlockHash: latestHead,
                    lowerBlockHash: anchorHead
                })
                .request()
        ).encodedMessageBlocks.map((encoded) =>
            Codec.decode(encoded, Type.MessageBlock)
        );
        expect(range).to.have.length(1);
        expect(range[0].previousBlockHash).to.equal(anchorHead);
        expect(
            await h.channelManager.verifyOutboundMessageBlocks(
                range,
                staged.anchor.snapshotData,
                latest.snapshotData
            )
        ).to.equal(true);
    });

    it("the chain anchor advances to the second exit between the audit's anchor read and its counter check, and the posted run is the empty run built from that exit -> the chain refuses the counter, the audit judges again from the new anchor and returns true with no counter and nothing to store above it", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOutboundDispute(h);
        const latest = StateSnapshot.from(
            staged.auditingData.latestStateSnapshot
        );
        staged.auditingData.outboundMessageBlocks = [];
        staged.commit();
        await staged.heldPost.waitUntilHeld();
        const verdicts = await h.rpcStub.probeOutboundRunVerification(
            staged.auditorIndex,
            { holdFirst: true }
        );

        const audit = h.dispute.auditDispute(
            staged.auditorIndex,
            staged.dispute,
            staged.auditingData
        );
        // the audit read the first exit as its anchor
        await verdicts.waitUntilHeld();
        expect(await staged.heldPost.release()).to.equal(null);
        expect(
            (await chainSnapshot(h)).latestOutboundMessageBlockHash,
            "the second exit is the chain anchor"
        ).to.equal(latest.latestOutboundMessageBlockHash);
        await verdicts.release();

        const run = await audit;
        expect(run).to.include({ outcome: "returned", isValid: true });
        expect(run.storedProof).to.equal(undefined);
        expect(run.disputeFraudProofCount).to.equal(0);
        // judged from the read anchor, then once from the advanced one
        expect(await verdicts.calls()).to.equal(2);
        await verdicts.restore();
    });

    it("the local verdict calls the honest posted run invalid while the chain anchor stays put -> the chain refuses the counter from the anchor it was judged on: the audit throws, stores no counter, and does not judge again", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOutboundDispute(h);
        const verdicts = await h.rpcStub.probeOutboundRunVerification(
            staged.auditorIndex,
            { answerInvalid: true }
        );

        const run = await h.dispute.auditDispute(
            staged.auditorIndex,
            staged.dispute,
            staged.auditingData
        );
        expect(run).to.deep.include({
            outcome: "threw",
            threwMessage:
                "Dispute audit: the chain rejects the invalid-outbound-run counter from the anchor it was judged on"
        });
        expect(run.storedProof).to.equal(undefined);
        expect(run.disputeFraudProofCount).to.equal(0);
        expect(await verdicts.calls()).to.equal(1);
        await verdicts.restore();
    });
});
