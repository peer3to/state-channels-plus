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
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import { EVM } from "@ethereumjs/evm";
import { assertStartupReplayGasReadFailure } from "@test/fixtures/node/RuntimeChainContextFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

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

    it("a rejected startup replay requirement read rejects readiness with no inline executor and closes the runtime", async function () {
        await assertStartupReplayGasReadFailure(false);
    });

    it("a rejected startup replay requirement read rejects readiness with no dedicated executor thread and closes the runtime", async function () {
        await assertStartupReplayGasReadFailure(true);
    });
});
