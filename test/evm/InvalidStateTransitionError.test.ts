import {
    BUDGET_ABOVE_DEFAULT,
    INPUT_ABOVE_DEFAULT_CALL_GAS,
    addOneCalldata,
    createDiamondStateMachine,
    deployMathMachine,
    encodeMathState
} from "../fixtures/LocalEvmCallGas.fixture";
import { ContractExecutor, EvmStateMachine } from "@/evm";
import {
    isInvalidStateTransitionError,
    isLocalEvmExecutionFailure,
    isLocalReductionResourceFailure
} from "@/utils/evmErrorHandler";
import { EVM } from "@ethereumjs/evm";
import {
    corruptNextSdkExecutorRequest,
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures
} from "@test/fixtures/node/SdkExecutorFixture";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import { MathStateMachine__factory } from "@typechain-types";
import { expect } from "chai";
import { ethers } from "ethers";
import { ethers as hardhatEthers } from "hardhat";

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
        expect(isLocalEvmExecutionFailure(error)).to.equal(true);
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
            expect(isLocalEvmExecutionFailure(error)).to.equal(false);
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
            expect(isLocalEvmExecutionFailure(error)).to.equal(false);
        } finally {
            control.dispose();
        }
        expect(await machine.sum()).to.equal(0n);
    });
});

// A reduction that reverts with funded gas is a verdict on its inputs; a
// reduction this node could not fund locally is a resource failure and
// must never become such a verdict.
describe("isLocalReductionResourceFailure", function () {
    const emptySnapshot = {
        snapshotData: {
            originForkId: ethers.ZeroHash,
            stateMachineStateHash: ethers.ZeroHash,
            participants: [],
            latestInboundMessageBlockHash: ethers.ZeroHash,
            latestInboundMessageBlockHeight: 0n,
            latestOutboundMessageBlockHash: ethers.ZeroHash,
            latestOutboundMessageBlockHeight: 0n,
            totalDeposits: { amount: 0n, data: "0x" },
            totalWithdrawals: { amount: 0n, data: "0x" }
        },
        forkId: ethers.ZeroHash,
        blockHeight: 0n,
        timestamp: 0n
    };

    async function reduceCalldata(executor: ContractExecutor) {
        const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
        const stateMachine = await createDiamondStateMachine(
            executor,
            machine.address,
            DEFAULT_BUDGET
        );
        const diamond = stateMachine.localDiamondContract;
        return {
            diamondAddress: await diamond.getAddress(),
            data: diamond.interface.encodeFunctionData("reduceAndFinalize", [
                [],
                emptySnapshot,
                "0x",
                [],
                ethers.ZeroHash
            ])
        };
    }

    it("a reduction that reverts inside the EVM is not a resource failure", async function () {
        const executor = new ContractExecutor(
            // the runtime's EVM option: the local diamond exceeds EIP-170
            await EVM.create({ allowUnlimitedContractSize: true })
        );
        const { diamondAddress, data } = await reduceCalldata(executor);
        const error = await executor.executeCall(data, diamondAddress).then(
            () => undefined,
            (e: unknown) => e
        );
        expect((error as Error).message).to.include("ErrorNoDisputesProvided");
        expect(isLocalEvmExecutionFailure(error)).to.equal(true);
        expect(isLocalReductionResourceFailure(error)).to.equal(false);
    });

    it("a reduction whose call frame runs out of gas is a resource failure", async function () {
        const evm = await EVM.create({
            allowUnlimitedContractSize: true
        });
        const executor = new ContractExecutor(evm);
        const { diamondAddress, data } = await reduceCalldata(executor);
        const starved = new ContractExecutor(evm, undefined, {
            callGasLimit: 1_000n
        });
        const error = await starved.executeCall(data, diamondAddress).then(
            () => undefined,
            (e: unknown) => e
        );
        expect((error as Error).message).to.match(/: out of gas$/);
        expect(isLocalReductionResourceFailure(error)).to.equal(true);
    });

    it("a refusal to run under-funded is a resource failure", async function () {
        const executor = new ContractExecutor(await EVM.create());
        const machine = await deployMathMachine(executor, BUDGET_ABOVE_DEFAULT);
        const error = await machine.addOne().then(
            () => undefined,
            (e: unknown) => e
        );
        expect((error as Error).message).to.include(
            "ErrorInsufficientGasForStateTransition"
        );
        expect(isLocalReductionResourceFailure(error)).to.equal(true);
    });

    it("a dispute computation that exhausts its capped budget is a resource failure", async function () {
        const executor = new ContractExecutor(
            await EVM.create({ allowUnlimitedContractSize: true })
        );
        const machine = await deployMathMachine(executor, DEFAULT_BUDGET);
        const diamondMachine = await deployMathMachine(
            executor,
            DEFAULT_BUDGET
        );
        // a dispute execution gas limit far below the computation's cost:
        // the local diamond's capped delegatecall names the exhaustion
        const { evmDiamondStateMachine } =
            await EvmStateMachine.createStandaloneFromLocalStateMachineWithExecutor(
                executor,
                machine.address,
                diamondMachine.address,
                MathStateMachine__factory.createInterface(),
                hardhatEthers.Wallet.createRandom(hardhatEthers.provider),
                resolveTestTimeConfig(),
                5_000
            );
        const error = await evmDiamondStateMachine.localDiamondContract
            .computeDisputeOutputState(
                {
                    channelId: ethers.ZeroHash,
                    forkId: ethers.ZeroHash,
                    latestStateSnapshotHash: ethers.ZeroHash,
                    latestInboundMessageBlockHash: ethers.ZeroHash,
                    lastInboundMessageBlockHeight: 0n,
                    stateProof: { milestones: [] },
                    onChainSlashes: [],
                    disputeAuditingDataHash: ethers.ZeroHash,
                    disputer: ethers.ZeroAddress,
                    timeout: {
                        participant: ethers.ZeroAddress,
                        blockHeight: 0n,
                        minTimeStamp: 0n,
                        isForced: false,
                        previousBlockProducer: ethers.ZeroAddress,
                        previousBlockProducerPostedCalldata: false,
                        participantSignatureOnPreviousBlock: "0x"
                    },
                    selfRemoval: false,
                    requireExistingDisputeWindow: false
                },
                emptySnapshot,
                encodeMathState({
                    number: 0n,
                    participants: [ethers.Wallet.createRandom().address],
                    balances: [0n],
                    currentTurnIndex: 0n
                }),
                []
            )
            .then(
                () => undefined,
                (e: unknown) => e
            );
        expect((error as Error).message).to.include(
            "ErrorDisputeExecutionOutOfGas"
        );
        expect(isLocalReductionResourceFailure(error)).to.equal(true);
    });
});
