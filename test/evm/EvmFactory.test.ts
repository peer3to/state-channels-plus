import { CONSOLE_ADDRESS, createEvm, type EvmCustomPrecompile } from "@/evm";
import type { DefaultStateManager } from "@ethereumjs/statemanager";
import { Address, type MapDB } from "@ethereumjs/util";
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
import { expect } from "chai";
import { ethers } from "ethers";
import sinon from "sinon";

function buildBlock() {
    const zeroAddress = Address.zero();

    return {
        header: {
            number: 0n,
            cliqueSigner: () => zeroAddress,
            coinbase: zeroAddress,
            timestamp: 0n,
            difficulty: 0n,
            prevRandao: new Uint8Array(32),
            gasLimit: 30_000_000n,
            baseFeePerGas: 0n,
            getBlobGasPrice: () => undefined
        }
    } as any;
}

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
        const logger = { child: () => ({ debug: () => undefined }) } as any;
        const evm = await createEvm({}, logger);
        const stateManager = evm.stateManager as DefaultStateManager;
        const trieDatabase = stateManager["_trie"].database().db as MapDB<
            string,
            Uint8Array
        >;

        // Runtime code: SSTORE(slot, calldata word `slot`) for each slot, then STOP.
        const slotCount = 8;
        let code = "0x";
        for (let slot = 0; slot < slotCount; slot++) {
            code += `60${(slot * 32).toString(16).padStart(2, "0")}3560${slot.toString(16).padStart(2, "0")}55`;
        }
        code += "00";
        const contract = Address.fromString(
            "0x00000000000000000000000000000000000000bb"
        );
        await stateManager.putContractCode(contract, ethers.getBytes(code));

        const rewriteSlots = async () => {
            const result = await evm.runCall({
                to: contract,
                caller: Address.zero(),
                data: ethers.randomBytes(slotCount * 32),
                block: buildBlock()
            });
            expect(result.execResult.exceptionError).to.equal(undefined);
        };

        await rewriteSlots();
        const sizeAfterFirstCall = trieDatabase._database.size;
        for (let call = 0; call < 50; call++) await rewriteSlots();

        expect(trieDatabase._database.size).to.equal(sizeAfterFirstCall);
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
