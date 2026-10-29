import {
    probeMathInsertion,
    assertInsertionWrongAuthor
} from "@test/fixtures/MathInsertionFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("Unit: MathStateMachine off-chain insertion", () => {
    it("the SDK rejects an insertion by the wrong author without changing roster state or eligibility", async () => {
        const result = await assertInsertionWrongAuthor(
            TestSession.getHarness()
        );
        expect(result.error).to.include("NOT MY TURN");
        expect(result.after).to.deep.equal(result.before);
    });

    it("transfers part of the author's balance without changing total value or message anchors", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 5n
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after.participants).to.deep.equal([
            ...result.before.participants,
            result.target
        ]);
        expect(result.after.balances).to.deep.equal(
            result.before.balances
                .map((balance, index) =>
                    index === result.authorIndex ? balance - 5n : balance
                )
                .concat(5n)
        );
        expect(result.after.number).to.equal(result.before.number);
        expect(result.after.currentTurnIndex).to.equal(
            result.before.currentTurnIndex + 1n
        );
        expect(result.afterBalance).to.equal(result.beforeBalance);
        expect(result.inboundAfter).to.equal(result.inboundBefore);
        expect(result.outboundCounts).to.deep.equal([0]);
    });

    it("accepts zero transfer from a funded author", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after.balances).to.deep.equal([
            ...result.before.balances,
            0n
        ]);
        expect(result.after.participants.at(-1)).to.equal(result.target);
        expect(result.afterBalance).to.equal(result.beforeBalance);
    });

    it("accepts zero transfer from a zero-balance author", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            zeroAuthorBalance: true
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after.balances[result.authorIndex]).to.equal(0n);
        expect(result.after.balances.at(-1)).to.equal(0n);
        expect(result.afterBalance).to.equal(result.beforeBalance);
    });

    it("rejects insufficient balance without changing the state", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 1n,
            zeroAuthorBalance: true
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
        expect(result.outboundCounts).to.deep.equal([0]);
    });

    it("rejects an existing target without changing the state", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            target: "existing"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
    });

    it("rejects self insertion without changing the state", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            target: "self"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
    });

    it("rejects the zero address without changing the state", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            target: "zero"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
    });

    it("rejects a participant acting out of turn", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            author: "wrong-turn"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
    });

    it("rejects a nonparticipant author", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            author: "outsider"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
    });

    it("selects the next author using the new roster after a wrapped turn index", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            turnIndex: 5
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after.currentTurnIndex).to.equal(6n);
        expect(result.nextToWrite).to.equal(result.after.participants[0]);
    });

    it("fills the configured N minus one roster to exactly N", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            maximum: 3
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.queueMaximum).to.equal(3);
        expect(result.before.participants.length).to.equal(2);
        expect(result.after.participants.length).to.equal(3);
    });

    it("at capacity advances only the turn counter for a valid positive transfer", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 5n,
            maximum: 2
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after).to.deep.equal({
            ...result.before,
            currentTurnIndex: result.before.currentTurnIndex + 1n
        });
        expect(result.afterBalance).to.equal(result.beforeBalance);
        expect(result.outboundCounts).to.deep.equal([0]);
        expect(result.inboundAfter).to.equal(result.inboundBefore);
    });

    it("repeated full-capacity requests each advance exactly one turn", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            maximum: 2,
            repeat: 3
        });
        expect(result.successes).to.deep.equal([true, true, true]);
        expect(result.after).to.deep.equal({
            ...result.before,
            currentTurnIndex: result.before.currentTurnIndex + 3n
        });
        expect(result.outboundCounts).to.deep.equal([0, 0, 0]);
    });

    it("a zero-amount request at capacity cannot append a participant", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            maximum: 2
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after).to.deep.equal({
            ...result.before,
            currentTurnIndex: result.before.currentTurnIndex + 1n
        });
    });

    it("an already oversized adopted roster remains unchanged", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            maximum: 2,
            oversized: true
        });
        expect(result.before.participants.length).to.equal(3);
        expect(result.successes).to.deep.equal([true]);
        expect(result.after).to.deep.equal({
            ...result.before,
            currentTurnIndex: result.before.currentTurnIndex + 1n
        });
    });

    it("maximum one accepts a valid no-op and keeps its only author", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            maximum: 1
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after.participants).to.deep.equal(
            result.before.participants
        );
        expect(result.nextToWrite).to.equal(result.before.participants[0]);
        expect(result.after.currentTurnIndex).to.equal(
            result.before.currentTurnIndex + 1n
        );
    });

    it("capacity does not waive invalid-target checks", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            maximum: 2,
            target: "self"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
    });
    it("can transfer the author's exact remaining balance", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            amount: 0n,
            fullBalance: true
        });
        expect(result.successes).to.deep.equal([true]);
        expect(result.after.balances[result.authorIndex]).to.equal(0n);
        expect(result.after.balances.at(-1)).to.equal(
            result.before.balances[result.authorIndex]
        );
        expect(result.afterBalance).to.equal(result.beforeBalance);
    });
    it("capacity does not waive zero-address rejection", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            maximum: 2,
            amount: 0n,
            target: "zero"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
        expect(result.afterBalance).to.equal(result.beforeBalance);
        expect(result.outboundCounts).to.deep.equal([0]);
    });
    it("capacity does not waive duplicate-participant rejection", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            maximum: 2,
            amount: 0n,
            target: "existing"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
        expect(result.afterBalance).to.equal(result.beforeBalance);
        expect(result.outboundCounts).to.deep.equal([0]);
    });
    it("capacity does not waive insufficient balance", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            maximum: 2,
            zeroAuthorBalance: true,
            amount: 1n
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
        expect(result.afterBalance).to.equal(result.beforeBalance);
        expect(result.outboundCounts).to.deep.equal([0]);
    });
    it("capacity does not waive turn authorization", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            maximum: 2,
            amount: 0n,
            author: "wrong-turn"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
        expect(result.afterBalance).to.equal(result.beforeBalance);
        expect(result.outboundCounts).to.deep.equal([0]);
    });
    it("capacity does not admit a nonparticipant author", async () => {
        const result = await probeMathInsertion(TestSession.getHarness(), {
            maximum: 2,
            amount: 0n,
            author: "outsider"
        });
        expect(result.successes).to.deep.equal([false]);
        expect(result.after).to.deep.equal(result.before);
        expect(result.afterBalance).to.equal(result.beforeBalance);
        expect(result.outboundCounts).to.deep.equal([0]);
    });
});
