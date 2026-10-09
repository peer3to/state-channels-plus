// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { EvmStateMachine, type AContractExecutor } from "@/evm";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import { MathStateMachine__factory } from "@typechain-types";
import type { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "hardhat";

const machineInterface = MathStateMachine__factory.createInterface();

// A transition budget whose full stipend needs more call gas than the EVM
// default, so the local call gas is raised to twice the replay requirement.
export const BUDGET_ABOVE_DEFAULT = 17_000_000n;

// For the default 500k budget and the default call gas: copying the input
// runs the call's own frame out of gas before the stipend check.
export const INPUT_ABOVE_DEFAULT_CALL_GAS = 4_096 * 1024;

/**
 * Calldata of `add(1)` followed by `inputBytes` nonzero bytes. The ABI decoder
 * ignores the trailing bytes, so the transition is `add(1)`; only the cost of
 * copying the input grows.
 */
export function addOneCalldata(inputBytes = 0): string {
    return (
        machineInterface.encodeFunctionData("add", [1n]) +
        "01".repeat(inputBytes)
    );
}

/** The Math machine's ABI-encoded state. */
export function encodeMathState(state: {
    number: bigint;
    participants: string[];
    balances: bigint[];
    currentTurnIndex: bigint;
}): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(uint256,address[],uint256[],uint256)"],
        [
            [
                state.number,
                state.participants,
                state.balances,
                state.currentTurnIndex
            ]
        ]
    );
}

/**
 * A Math machine deployed into `executor` with a transition budget of
 * `gasLimit`, holding one participant whose `add(1)` turn is next. The
 * machine refuses a transition it cannot grant the full budget, so the
 * executor's call gas decides whether `addOne` runs.
 */
export async function deployMathMachine(
    executor: AContractExecutor,
    gasLimit: bigint
) {
    const participant = ethers.Wallet.createRandom().address;
    const deployment = await executor.deploy(
        (
            await new MathStateMachine__factory().getDeployTransaction(
                gasLimit,
                8
            )
        ).data
    );
    const address = deployment.createdAddress!.toString();
    await executor.executeCall(
        machineInterface.encodeFunctionData("setState", [
            encodeMathState({
                number: 0n,
                participants: [participant],
                balances: [0n],
                currentTurnIndex: 0n
            })
        ]),
        address
    );
    const read = (data: string) =>
        executor
            .simulateCall(data, address)
            .then(({ returnValue }) => BigInt(returnValue));
    // `add(1)` by the machine's only participant, its next writer
    const addOneTransaction = {
        header: {
            channelId: ethers.ZeroHash,
            participant,
            forkId: ethers.ZeroHash,
            transactionCnt: 0n,
            timestamp: 0n
        },
        body: {
            encodedData: "0x",
            data: machineInterface.encodeFunctionData("add", [1n])
        }
    };
    const stateTransition = (transaction: TransactionStruct) =>
        executor.executeCall(
            machineInterface.encodeFunctionData("stateTransition", [
                transaction
            ]),
            address
        );
    return {
        address,
        addOneTransaction,
        stateTransition,
        gasRequirement: () =>
            read(
                machineInterface.encodeFunctionData(
                    "getStateTransitionGasRequirement"
                )
            ),
        sum: () => read(machineInterface.encodeFunctionData("getSum")),
        addOne: () => stateTransition(addOneTransaction)
    };
}

/**
 * The runtime's state machine over `executor` for the machine at
 * `machineAddress`, built by the production factory: a second Math machine
 * serves the local diamond.
 */
export async function createDiamondStateMachine(
    executor: AContractExecutor,
    machineAddress: string,
    gasLimit: bigint
): Promise<EvmStateMachine> {
    const diamondMachine = await deployMathMachine(executor, gasLimit);
    const { evmDiamondStateMachine } =
        await EvmStateMachine.createStandaloneFromLocalStateMachineWithExecutor(
            executor,
            machineAddress,
            diamondMachine.address,
            machineInterface,
            ethers.Wallet.createRandom(ethers.provider),
            resolveTestTimeConfig(),
            3_000_000
        );
    return evmDiamondStateMachine;
}

/**
 * A full harness session (3 peers, open channel) whose Math machine has a
 * transition budget of `gasLimit`, with the local EVM inline in each runtime
 * host or on its own dedicated thread. Returns the manager's replay
 * requirement, which the runtime host reads at start to size every local EVM
 * call.
 */
export async function startWithTransitionBudget(
    h: MathPeerTestHarness,
    gasLimit: number,
    vmDedicatedThread: boolean
): Promise<bigint> {
    await h.lifecycle.start(3, 0, {
        stateMachineGasLimit: gasLimit,
        configOverrides: { VM_DEDICATED_THREAD: vmDedicatedThread }
    });
    return h.channelManager.getStateTransitionReplayGas();
}
