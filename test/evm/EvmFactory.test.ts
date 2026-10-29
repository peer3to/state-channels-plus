import { CONSOLE_ADDRESS, createEvm, type EvmCustomPrecompile } from "@/evm";
import { Address } from "@ethereumjs/util";
import {
    assertDisposalAbandonsStuckAdmittedWork,
    assertDisposalKeepsAdmittedFailure,
    assertLateFailureAfterDrainLimitStaysRejected,
    assertLateSuccessAfterDrainLimitStaysRejected,
    assertQueuedWorkAfterDrainLimitStaysRejected,
    assertDisposalRejectsLaterAdmission,
    assertDisposalWaitsForAdmittedWork,
    assertInlineExecutorOwnerContext,
    assertRepeatedExecutorDisposalSharesCompletion,
    assertWorkerExecutorOwnerContext
} from "@test/fixtures/node/ExecutorOwnerFixture";
import {
    SlotWriterEvm,
    buildBlock,
    randomSlotValues,
    slotWords
} from "@test/fixtures/SlotWriterEvmFixture";
import { expect } from "chai";
import { ethers } from "ethers";
import sinon from "sinon";

describe("EvmFactory", function () {
    it("should execute custom precompiles without disabling the built-in console precompile", async function () {
        const consoleDebug = sinon.spy();
        const logger = {
            child: () => ({
                debug: consoleDebug
            })
        } as any;

        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000aa"
        );
        const expectedReturnValue = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [42n]
        );
        let customCallCount = 0;

        const customPrecompile: EvmCustomPrecompile = {
            address: customAddress,
            function: async () => {
                customCallCount++;
                return {
                    executionGasUsed: 0n,
                    returnValue: ethers.getBytes(expectedReturnValue)
                };
            }
        };

        const evm = await createEvm(
            {
                customPrecompiles: [customPrecompile]
            },
            logger
        );

        const customResult = await evm.runCall({
            to: customAddress,
            caller: Address.zero(),
            data: ethers.getBytes("0x1234"),
            block: buildBlock()
        });

        expect(customResult.execResult.exceptionError).to.equal(undefined);
        expect(ethers.hexlify(customResult.execResult.returnValue)).to.equal(
            expectedReturnValue
        );
        expect(customCallCount).to.equal(1);

        const consoleCallData = ethers.getBytes(
            `${ethers.id("log(string)").slice(0, 10)}${ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["hello from console precompile"]).slice(2)}`
        );

        const consoleResult = await evm.runCall({
            to: Address.fromString(CONSOLE_ADDRESS),
            caller: Address.zero(),
            data: consoleCallData,
            block: buildBlock()
        });

        expect(consoleResult.execResult.exceptionError).to.equal(undefined);
        expect(
            consoleDebug.calledWith("hello from console precompile")
        ).to.equal(true);
    });

    it("keeps the trie database the same size while calls rewrite the same storage slots", async function () {
        const slotWriter = await SlotWriterEvm.create();
        const contract = Address.fromString(
            "0x00000000000000000000000000000000000000bb"
        );
        await slotWriter.deploy(contract);

        await slotWriter.write(contract, randomSlotValues());
        const sizeAfterFirstCall = slotWriter.trieDatabaseSize();
        for (let call = 0; call < 50; call++)
            await slotWriter.write(contract, randomSlotValues());

        expect(slotWriter.trieDatabaseSize()).to.equal(sizeAfterFirstCall);
    });

    it("keeps a contract's storage intact while another contract with identical storage rewrites its slots", async function () {
        const slotWriter = await SlotWriterEvm.create();
        const rewritten = Address.fromString(
            "0x00000000000000000000000000000000000000bb"
        );
        const untouched = Address.fromString(
            "0x00000000000000000000000000000000000000cc"
        );
        await slotWriter.deploy(rewritten);
        await slotWriter.deploy(untouched);
        const sharedValues = randomSlotValues();
        await slotWriter.write(rewritten, sharedValues);
        await slotWriter.write(untouched, sharedValues);

        for (let call = 0; call < 5; call++)
            await slotWriter.write(rewritten, randomSlotValues());

        expect(await slotWriter.readSlotsFromTrie(untouched)).to.deep.equal(
            slotWords(sharedValues)
        );
        const nextValues = randomSlotValues();
        await slotWriter.write(untouched, nextValues);
        expect(await slotWriter.readSlotsFromTrie(untouched)).to.deep.equal(
            slotWords(nextValues)
        );
    });

    it("keeps the state root and every slot when a checkpointed call that rewrites the slots is reverted", async function () {
        const slotWriter = await SlotWriterEvm.create();
        const contract = Address.fromString(
            "0x00000000000000000000000000000000000000bb"
        );
        await slotWriter.deploy(contract);
        const committedValues = randomSlotValues();
        await slotWriter.write(contract, committedValues);
        const committedRoot = await slotWriter.stateRoot();

        await slotWriter.evm.journal.checkpoint();
        await slotWriter.write(contract, randomSlotValues());
        await slotWriter.evm.journal.revert();

        expect(await slotWriter.stateRoot()).to.deep.equal(committedRoot);
        expect(await slotWriter.readSlotsFromTrie(contract)).to.deep.equal(
            slotWords(committedValues)
        );
    });

    it("gives a manifest precompile its inline executor root during startup and releases its child with that executor", async function () {
        await assertInlineExecutorOwnerContext();
    });

    it("gives a manifest precompile its worker executor root during startup", async function () {
        await assertWorkerExecutorOwnerContext();
    });

    it("finishes an admitted precompile call and queued deploy and simulation before disposing the precompile child", async function () {
        await assertDisposalWaitsForAdmittedWork();
    });

    it("rejects executor calls, deploys and simulations that arrive after disposal began without entering the EVM", async function () {
        await assertDisposalRejectsLaterAdmission();
    });

    it("keeps an admitted operation's failure while disposal waits for it", async function () {
        await assertDisposalKeepsAdmittedFailure();
    });

    it("shares one completion across repeated executor disposal during admitted work", async function () {
        await assertRepeatedExecutorDisposalSharesCompletion();
    });

    it("abandons an admitted call stuck past the drain limit, closes the child, and reports no error", async function () {
        await assertDisposalAbandonsStuckAdmittedWork();
    });

    it("keeps the disposal rejection for an admitted call that succeeds after the drain limit", async function () {
        await assertLateSuccessAfterDrainLimitStaysRejected();
    });

    it("keeps the disposal rejection for an admitted call that fails after the drain limit", async function () {
        await assertLateFailureAfterDrainLimitStaysRejected();
    });

    it("rejects queued deploy and simulation callers released after the drain limit", async function () {
        await assertQueuedWorkAfterDrainLimitStaysRejected();
    });
});
