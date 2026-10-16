import {
    BUDGET_ABOVE_DEFAULT,
    deployMathMachine,
    startWithTransitionBudget
} from "../fixtures/LocalEvmCallGas.fixture";
import { ContractExecutor } from "@/evm";
import {
    DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT,
    localEvmCallGasLimit
} from "@/evm/contractExecutor/ContractExecutor";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import {
    isLocalReductionResourceFailure,
    tryDecodeCustomError
} from "@/utils/evmErrorHandler";
import { EVM } from "@ethereumjs/evm";
import { assertStartupReplayGasReadFailure } from "@test/fixtures/node/RuntimeChainContextFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { MathStateMachine__factory } from "@typechain-types";
import { expect } from "chai";
import { ethers } from "ethers";

describe("ContractExecutor call gas", function () {
    it("defaults to the EVM's call gas", function () {
        expect(localEvmCallGasLimit(3_000_000n, 3_000_000n)).to.equal(
            DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT
        );
    });

    it("raises the call gas to the dispute-execution budget", function () {
        expect(localEvmCallGasLimit(20_000_000n, 3_500_000n)).to.equal(
            20_000_000n
        );
    });

    it("raises the call gas to twice the replay gas", function () {
        expect(localEvmCallGasLimit(16_000_000n, 17_540_000n)).to.equal(
            35_080_000n
        );
    });

    it("refuses a transition above the default call gas when not raised", async function () {
        const executor = new ContractExecutor(await EVM.create());
        try {
            const machine = await deployMathMachine(
                executor,
                BUDGET_ABOVE_DEFAULT
            );
            expect(await machine.gasRequirement()).to.be.greaterThan(
                DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT
            );
            const error = await machine.addOne().then(
                () => undefined,
                (e: unknown) => e
            );
            expect(tryDecodeCustomError(error)?.errorDescription.name).to.equal(
                "ErrorInsufficientGasForStateTransition"
            );
            expect(await machine.sum()).to.equal(0n);
        } finally {
            await executor.dispose();
        }
    });

    it("runs a transition above the default call gas when raised to its requirement", async function () {
        const probe = new ContractExecutor(await EVM.create());
        const requirement = await deployMathMachine(
            probe,
            BUDGET_ABOVE_DEFAULT
        ).then((machine) => machine.gasRequirement());
        await probe.dispose();

        const executor = new ContractExecutor(await EVM.create(), undefined, {
            callGasLimit: localEvmCallGasLimit(
                BUDGET_ABOVE_DEFAULT,
                requirement
            )
        });
        try {
            const machine = await deployMathMachine(
                executor,
                BUDGET_ABOVE_DEFAULT
            );
            await machine.addOne();
            expect(await machine.sum()).to.equal(1n);
        } finally {
            await executor.dispose();
        }
    });

    it("a per-call gas limit override runs a call above the executor's own grant", async function () {
        const executor = new ContractExecutor(await EVM.create());
        try {
            const machine = await deployMathMachine(
                executor,
                BUDGET_ABOVE_DEFAULT
            );
            const requirement = await machine.gasRequirement();
            expect(requirement).to.be.greaterThan(
                DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT
            );
            const data =
                MathStateMachine__factory.createInterface().encodeFunctionData(
                    "stateTransition",
                    [machine.addOneTransaction]
                );
            await executor.executeCall(data, machine.address, requirement);
            expect(await machine.sum()).to.equal(1n);
        } finally {
            await executor.dispose();
        }
    });

    it("LocalContractExecutorSigner forwards a call's gasLimit to the executor", async function () {
        const executor = new ContractExecutor(await EVM.create());
        try {
            // the harness Math machine's transition budget
            const machine = await deployMathMachine(executor, 500_000n);
            const signer = new LocalContractExecutorSigner(
                ethers.Wallet.createRandom(),
                executor
            );
            const data =
                MathStateMachine__factory.createInterface().encodeFunctionData(
                    "stateTransition",
                    [machine.addOneTransaction]
                );
            const error = await signer
                .call({ to: machine.address, data, gasLimit: 1_000n })
                .then(
                    () => undefined,
                    (e: unknown) => e
                );
            expect(error).to.be.instanceOf(Error);
            const result = await signer.call({
                to: machine.address,
                data
            });
            expect(result).to.be.a("string");
        } finally {
            await executor.dispose();
        }
    });

    // The runtime host reads the manager's replay requirement at start and
    // hands the raised limit to its executor across the root boundary
    // (createContractExecutor -> ContractExecutorRoot -> ContractExecutorService).
    // Without it every local transition above the default is refused (see
    // "refuses a transition above the default call gas when not raised").
    it("an inline executor runs a transition whose replay requirement exceeds the default call gas", async function () {
        const h = TestSession.getHarness();
        const replayGas = await startWithTransitionBudget(
            h,
            Number(BUDGET_ABOVE_DEFAULT),
            false
        );
        expect(replayGas > DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT).to.equal(true);

        const before = await h.getPeer(0).contractInstance.getSum();
        await h.transition.advanceState({ count: 2 });
        for (const peer of h.peers)
            expect(await peer.contractInstance.getSum()).to.equal(before + 2n);
    });

    it("a dedicated executor thread runs a transition whose replay requirement exceeds the default call gas", async function () {
        const h = TestSession.getHarness();
        const replayGas = await startWithTransitionBudget(
            h,
            Number(BUDGET_ABOVE_DEFAULT),
            true
        );
        expect(replayGas > DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT).to.equal(true);

        const before = await h.getPeer(0).contractInstance.getSum();
        await h.transition.advanceState({ count: 2 });
        for (const peer of h.peers)
            expect(await peer.contractInstance.getSum()).to.equal(before + 2n);
    });

    // The runtime host also reads the chain's block gas bound at start and
    // hands it to the diamond state machine as the reduction-path grant;
    // a per-call override with that grant is what funds a reduction call.
    async function assertRuntimeReductionGrant(vmDedicatedThread: boolean) {
        const h = TestSession.getHarness();
        await startWithTransitionBudget(h, 500_000, vmDedicatedThread);
        const result = await h.execOnHost(h.getPeer(0), async (sm) => {
            const machine = sm.diamondStateMachine;
            const chainBlock = await sm.signer.provider!.getBlock("latest");
            const diamondAddress =
                await machine.localDiamondContract.getAddress();
            const zeroHash =
                "0x0000000000000000000000000000000000000000000000000000000000000000";
            const snapshot = {
                snapshotData: {
                    originForkId: zeroHash,
                    stateMachineStateHash: zeroHash,
                    participants: [],
                    latestInboundMessageBlockHash: zeroHash,
                    latestInboundMessageBlockHeight: 0,
                    latestOutboundMessageBlockHash: zeroHash,
                    latestOutboundMessageBlockHeight: 0,
                    totalDeposits: { amount: 0, data: "0x" },
                    totalWithdrawals: { amount: 0, data: "0x" }
                },
                forkId: zeroHash,
                blockHeight: 0,
                timestamp: 0
            };
            // a small reduction call: at a 1,000-gas override it dies in
            // dispatch (proving the override, not the executor's own
            // grant, funded it), at the machine's reduction grant it runs
            // to the facet's empty-disputes revert
            const data =
                machine.localDiamondContract.interface.encodeFunctionData(
                    "reduceAndFinalize",
                    [[], snapshot, "0x", [], zeroHash]
                );
            const call = async (gasLimit?: bigint) => {
                try {
                    await machine.contractExecutor.executeCall(
                        data,
                        diamondAddress,
                        gasLimit
                    );
                    return "ok";
                } catch (e) {
                    return e instanceof Error ? e.message : String(e);
                }
            };
            return {
                chainBlockGasLimit: chainBlock!.gasLimit.toString(),
                granted: machine.reductionCallGasLimit?.toString(),
                withTinyOverride: await call(1_000n),
                withGrant: await call(machine.reductionCallGasLimit)
            };
        });
        expect(result.granted).to.equal(result.chainBlockGasLimit);
        expect(
            isLocalReductionResourceFailure(new Error(result.withTinyOverride))
        ).to.equal(true);
        expect(result.withGrant).to.include("ErrorNoDisputesProvided");
    }

    it("the runtime grants reduction calls the chain block gas limit on an inline executor", async function () {
        await assertRuntimeReductionGrant(false);
    });

    it("the runtime grants reduction calls the chain block gas limit on a dedicated executor thread", async function () {
        await assertRuntimeReductionGrant(true);
    });

    it("a rejected startup replay requirement read rejects readiness with no inline executor and closes the runtime", async function () {
        await assertStartupReplayGasReadFailure(false);
    });

    it("a rejected startup replay requirement read rejects readiness with no dedicated executor thread and closes the runtime", async function () {
        await assertStartupReplayGasReadFailure(true);
    });
});
