import {
    BUDGET_ABOVE_DEFAULT,
    INPUT_ABOVE_DEFAULT_CALL_GAS,
    addOneCalldata,
    createDiamondStateMachine,
    deployMathMachine
} from "../fixtures/LocalEvmCallGas.fixture";
import { ContractExecutor } from "@/evm";
import { isInvalidStateTransitionError } from "@/utils/evmErrorHandler";
import { EVM } from "@ethereumjs/evm";
import {
    corruptNextSdkExecutorRequest,
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures
} from "@test/fixtures/node/SdkExecutorFixture";
import { expect } from "chai";
import { ethers } from "ethers";

// The Math machine's transition budget in the harness.
const DEFAULT_BUDGET = 500_000n;

// Only a failure inside the EVM, within the transition's full budget, is a
// verdict on the transaction and may become a fraud proof.
describe("isInvalidStateTransitionError", function () {
    afterEach(disposeSdkExecutorFixtures);

    it("a transition that reverts inside the EVM is an invalid state transition", async function () {
        const executor = new ContractExecutor(await EVM.create());
        const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
        // `add(1)` by an address that is not the next writer
        const error = await machine
            .stateTransition({
                ...machine.addOneTransaction,
                header: {
                    ...machine.addOneTransaction.header,
                    participant: ethers.Wallet.createRandom().address
                }
            })
            .then(
                () => undefined,
                (e: unknown) => e
            );
        expect(isInvalidStateTransitionError(error)).to.equal(true);
    });

    it("a refusal to run under-funded is not an invalid state transition", async function () {
        const executor = new ContractExecutor(await EVM.create());
        const machine = await deployMathMachine(executor, BUDGET_ABOVE_DEFAULT);
        const error = await machine.addOne().then(
            () => undefined,
            (e: unknown) => e
        );
        expect((error as Error).message).to.include(
            "ErrorInsufficientGasForStateTransition"
        );
        expect(isInvalidStateTransitionError(error)).to.equal(false);
    });

    it("an out-of-gas of the call's own frame is not an invalid state transition", async function () {
        const executor = new ContractExecutor(await EVM.create());
        const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
        const data = addOneCalldata(INPUT_ABOVE_DEFAULT_CALL_GAS);
        // copying the input exhausts the call before the stipend check
        const error = await machine
            .stateTransition({
                ...machine.addOneTransaction,
                body: { encodedData: data, data }
            })
            .then(
                () => undefined,
                (e: unknown) => e
            );
        expect((error as Error).message).to.match(/: out of gas$/);
        expect(isInvalidStateTransitionError(error)).to.equal(false);
    });

    it("a failed executor connection is not an invalid state transition", async function () {
        const executor = await createSdkOwnedExecutor({
            dedicatedThread: false
        });
        const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
        const control = corruptNextSdkExecutorRequest(executor, "executeCall");
        try {
            const error = await machine.addOne().then(
                () => undefined,
                (e: unknown) => e
            );
            expect(error).to.be.instanceOf(Error);
            expect(isInvalidStateTransitionError(error)).to.equal(false);
        } finally {
            control.dispose();
        }
        // the transition never ran
        expect(await machine.sum()).to.equal(0n);
    });

    it("stateTransition returns an invalid transition for a transition that reverts", async function () {
        const executor = new ContractExecutor(
            // the runtime's EVM option: the local diamond exceeds EIP-170
            await EVM.create({ allowUnlimitedContractSize: true })
        );
        const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
        const stateMachine = await createDiamondStateMachine(
            executor,
            machine.address,
            DEFAULT_BUDGET
        );
        const result = await stateMachine.stateTransition({
            ...machine.addOneTransaction,
            header: {
                ...machine.addOneTransaction.header,
                participant: ethers.Wallet.createRandom().address
            }
        });
        expect(result.success).to.equal(false);
        expect(result.outboundMessages).to.deep.equal([]);
    });

    it("stateTransition throws a refusal to run under-funded instead of returning an invalid transition", async function () {
        const executor = new ContractExecutor(
            // the runtime's EVM option: the local diamond exceeds EIP-170
            await EVM.create({ allowUnlimitedContractSize: true })
        );
        const machine = await deployMathMachine(executor, BUDGET_ABOVE_DEFAULT);
        const stateMachine = await createDiamondStateMachine(
            executor,
            machine.address,
            BUDGET_ABOVE_DEFAULT
        );
        const error = await stateMachine
            .stateTransition(machine.addOneTransaction)
            .then(
                () => undefined,
                (e: unknown) => e
            );
        expect((error as Error).message).to.include(
            "ErrorInsufficientGasForStateTransition"
        );
        expect(await machine.sum()).to.equal(0n);
    });

    it("stateTransition throws a failed executor connection instead of returning an invalid transition", async function () {
        const executor = await createSdkOwnedExecutor({
            dedicatedThread: false
        });
        const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
        const stateMachine = await createDiamondStateMachine(
            executor,
            machine.address,
            DEFAULT_BUDGET
        );
        const control = corruptNextSdkExecutorRequest(executor, "executeCall");
        try {
            const error = await stateMachine
                .stateTransition(machine.addOneTransaction)
                .then(
                    () => undefined,
                    (e: unknown) => e
                );
            expect(error).to.be.instanceOf(Error);
        } finally {
            control.dispose();
        }
        expect(await machine.sum()).to.equal(0n);
    });
});
