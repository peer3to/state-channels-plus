import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import {
    postAlternateHeadWithInvalidBalance,
    postDoubleSignEvidence,
    postFullAlternateHistory,
    expectReducedToJoiners,
    readReduction,
    stageAlternateHistoryWithoutCharlie,
    stageAlternateHistoryWithoutCharlieAndDavid,
    waitForAlternateStatesHeld,
    waitForColludersSlashed
} from "@test/fixtures/AlternateHistoryStaging";
import { storedProofBlock } from "@test/fixtures/DisputeAuditStaging";
import { readMathPeer } from "@test/fixtures/OffChainPromotionFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

// Case 10: Alice and Bob double-sign an alternate history that never admits
// Charlie (nor David, when staged). Charlie, admitted at block 5 of the
// honest history, never signs the alternate one and keeps a shorter honest
// history. His audit of the posted alternate blocks replays them on the
// alternate history itself, so he never abstains: it proves each double sign
// through the block fraud pipeline, persists every alternate snapshot and
// state by hash, and his own dispute applies the proofs. With David pending
// too, Charlie's dispute is not final: the reduction takes the longest valid
// chain among the committed disputes. Without David, slashing leaves Charlie
// the only threshold signer and his dispute closes the window.
describe("E2E: dispute validation / stateProof / Case 10 (alternate history)", function () {
    it("posted alternate history shorter than Charlie's head slashes Alice and Bob and reduces to Charlie's longer honest history", async function () {
        const h = TestSession.getHarness();
        const staged = await stageAlternateHistoryWithoutCharlieAndDavid(h);
        const { forkId, alice, bob, charlie, david, doubleSignHeights } =
            staged;

        await postDoubleSignEvidence(h, staged);
        for (const offender of [alice, bob])
            await h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockDoubleSign,
                peerIndices: [charlie],
                maliciousPeerIndex: offender
            });
        // Charlie judged both posted alternate blocks on their own history:
        // the alternate head's snapshot and state are held
        await waitForAlternateStatesHeld(
            h,
            staged,
            Math.max(...doubleSignHeights)
        );
        await waitForColludersSlashed(h, staged);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [charlie, david.index]
        });
        for (const index of [charlie, david.index])
            await expectReducedToJoiners(
                h,
                staged,
                index,
                staged.honestSum,
                "reduced from Charlie's honest head"
            );
    });

    it("posted alternate history with invalid balance invariant is killed and Charlie's shorter history prevails", async function () {
        const h = TestSession.getHarness();
        const staged = await stageAlternateHistoryWithoutCharlieAndDavid(h);
        const { forkId, alice, bob, charlie, david } = staged;

        // Charlie's own dispute waits for the kill
        await h.dispute.suppressDisputeInitiation([charlie]);
        await postDoubleSignEvidence(h, staged);
        for (const offender of [alice, bob])
            await h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockDoubleSign,
                peerIndices: [charlie],
                maliciousPeerIndex: offender
            });
        await postAlternateHeadWithInvalidBalance(h, staged);
        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidBalanceInvariant,
            peerIndices: [charlie]
        });
        await h.event.waitForPeers("onDisputeKilled", [charlie], 1, {
            mode: "atLeast"
        });
        await h.rpcStub.restoreDisputeInitiationAndDispute(charlie, forkId);
        await waitForColludersSlashed(h, staged);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [charlie, david.index]
        });
        for (const index of [charlie, david.index])
            await expectReducedToJoiners(
                h,
                staged,
                index,
                staged.honestSum,
                "reduced from Charlie's honest head"
            );
    });

    it("posted alternate history with valid balance invariant slashes Alice and Bob and reduces to the longest valid chain", async function () {
        const h = TestSession.getHarness();
        const staged = await stageAlternateHistoryWithoutCharlieAndDavid(h);
        const { forkId, alice, bob, charlie, david, alternateHeadHeight } =
            staged;

        await postFullAlternateHistory(h, staged);
        for (const offender of [alice, bob])
            await h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockDoubleSign,
                peerIndices: [charlie],
                maliciousPeerIndex: offender
            });
        await waitForAlternateStatesHeld(h, staged, alternateHeadHeight);
        await waitForColludersSlashed(h, staged);

        // after the kill period the reduction builds on the alternate head
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [charlie, david.index]
        });
        for (const index of [charlie, david.index]) {
            expect(
                h.event.getEventCallCount(index, "onDisputeKilled"),
                "a double sign alone never kills the valid alternate dispute"
            ).to.equal(0);
            await expectReducedToJoiners(
                h,
                staged,
                index,
                staged.alternateSum,
                "reduced from the alternate head"
            );
        }
        // the peers install the reduced fork before the reduce lands
        const reducedResult = () =>
            h.channelManager.getReducedResult(h.channelId, forkId);
        await waitFor(
            async () => (await reducedResult()).reducedForkId !== ZeroHash,
            h.event.protocolEventTimeoutMs()
        );
        const { reducedForkId } = await reducedResult();
        for (const index of [charlie, david.index])
            expect(
                await h.control(h.getPeer(index)).query.getForkId().request(),
                "every honest peer is on the chain's reduced fork"
            ).to.equal(reducedForkId);
    });

    it("slashing leaves Charlie the only threshold signer → his dispute is final and closes the window; reduction from Charlie's honest head", async function () {
        const h = TestSession.getHarness();
        const staged = await stageAlternateHistoryWithoutCharlie(h);
        const { forkId, alice, bob, charlie, alternateHeadHeight } = staged;
        const alternateHead = await storedProofBlock(
            h,
            alice,
            forkId,
            alternateHeadHeight
        );

        // the alternate history is longer than Charlie's head
        const alternateDisputeHash = await postFullAlternateHistory(h, staged);
        for (const offender of [alice, bob])
            await h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockDoubleSign,
                peerIndices: [charlie],
                maliciousPeerIndex: offender
            });
        await waitForAlternateStatesHeld(h, staged, alternateHeadHeight);
        await waitForColludersSlashed(h, staged);

        // Charlie's dispute is threshold-final: it replaces the window's
        // commitments and its output is the reduced fork
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [charlie]
        });
        const { reducedForkId } = await h.channelManager.getReducedResult(
            h.channelId,
            forkId
        );
        expect(
            await h.control(h.getPeer(charlie)).query.getForkId().request(),
            "Charlie's fork is the chain's committed fork"
        ).to.equal(reducedForkId);
        const reduced = await readMathPeer(h, charlie);
        expect(reduced.state.participants).to.deep.equal([
            h.getPeer(charlie).address
        ]);
        expect(reduced.state.balances).to.deep.equal([staged.charlieDeposit]);
        expect(
            reduced.state.number,
            "reduced from Charlie's honest head"
        ).to.equal(staged.honestSum);

        // the alternate dispute alone reduces from the alternate head, which
        // Charlie's storage holds by hash
        const reduction = await readReduction(h, charlie, alternateDisputeHash);
        expect(reduction.headHeight).to.equal(alternateHeadHeight);
        expect(
            reduction.encodedStateMachineState,
            "Charlie's reduce data holds the alternate head's state"
        ).to.equal(alternateHead.state);
    });
});
