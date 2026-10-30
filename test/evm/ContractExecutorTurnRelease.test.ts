import { LOCAL_EVM_EXECUTION_FAILED } from "@/utils/evmErrorHandler";
import {
    afterPendingTimers,
    deployedNumberStorage,
    startTurnCounter
} from "@test/fixtures/node/ContractExecutorTurnFixture";
import { expect } from "chai";
import { ethers } from "ethers";

// ContractExecutor frees its mutex on the next timer turn after each call.
// The case this protects: the queue is empty when a call ends and the next
// request arrives in the same synchronous turn right after it settles (here:
// issued from the previous call's resolution). An immediate release would
// leave the mutex free, so that next call would run in the same loop
// iteration; the deferred release makes it wait for a timer turn.
//
// Each test first checks that a call on a free executor finishes in the loop
// iteration it was issued in (the in-memory EVM does not yield to the loop).
// Without that premise a later iteration would prove nothing.

describe("ContractExecutor release on the next timer turn", function () {
    it("a call issued from the previous call's resolution, with nothing queued, finishes in a later loop iteration; results are correct and in order", async function () {
        const { executor, address, storage } = await deployedNumberStorage();
        await executor.executeCall(
            storage.encodeFunctionData("setValue", [5]),
            address
        );
        await afterPendingTimers();
        const turns = startTurnCounter();
        try {
            const getValue = storage.encodeFunctionData("getValue");
            const read = () =>
                executor
                    .simulateCall(getValue, address)
                    .then(
                        (result) =>
                            storage.decodeFunctionResult(
                                "getValue",
                                result.returnValue
                            )[0] as bigint
                    );
            const issuedTurn = turns.current();
            const ends: { turn: number; value: bigint }[] = [];
            // each read is issued from the previous read's resolution, when
            // the executor queue is empty
            const chain = read().then(async (first) => {
                ends.push({ turn: turns.current(), value: first });
                const second = await read();
                ends.push({ turn: turns.current(), value: second });
                const third = await read();
                ends.push({ turn: turns.current(), value: third });
            });
            await chain;

            expect(
                ends[0].turn,
                "premise: a call on a free executor finishes in the iteration it was issued in"
            ).to.equal(issuedTurn);
            expect(ends.map((end) => end.value)).to.deep.equal([5n, 5n, 5n]);
            expect(ends[1].turn).to.be.greaterThan(ends[0].turn);
            expect(ends[2].turn).to.be.greaterThan(ends[1].turn);
        } finally {
            turns.stop();
            await executor.dispose();
        }
    });

    it("a reverting call still releases the lock: the call issued from its rejection finishes in a later loop iteration with its correct result", async function () {
        const { executor, address, storage } = await deployedNumberStorage();
        await executor.executeCall(
            storage.encodeFunctionData("setValue", [7]),
            address
        );
        await afterPendingTimers();
        const turns = startTurnCounter();
        try {
            const issuedTurn = turns.current();
            let failedTurn = -1;
            let error: unknown = null;
            const next = await executor
                .simulateCall(
                    storage.encodeFunctionData("revertWithMessage", ["boom"]),
                    address
                )
                .then(
                    () => {
                        throw new Error("the reverting simulation resolved");
                    },
                    async (rejection: unknown) => {
                        failedTurn = turns.current();
                        error = rejection;
                        // issued from the rejection, with nothing queued
                        const result = await executor.simulateCall(
                            storage.encodeFunctionData("getValue"),
                            address
                        );
                        return {
                            turn: turns.current(),
                            value: storage.decodeFunctionResult(
                                "getValue",
                                result.returnValue
                            )[0] as bigint
                        };
                    }
                );

            expect(
                failedTurn,
                "premise: a call on a free executor finishes in the iteration it was issued in"
            ).to.equal(issuedTurn);
            if (!(error instanceof Error))
                throw new Error("the reverting simulation must reject");
            expect(error.message).to.include(LOCAL_EVM_EXECUTION_FAILED);
            // the revert data is the contract's own Error("boom")
            const revertData = (error as Error & { data: string }).data;
            expect(
                ethers.AbiCoder.defaultAbiCoder().decode(
                    ["string"],
                    ethers.dataSlice(revertData, 4)
                )[0]
            ).to.equal("boom");
            expect(next.value).to.equal(7n);
            expect(next.turn).to.be.greaterThan(failedTurn);
        } finally {
            turns.stop();
            await executor.dispose();
        }
    });
});
