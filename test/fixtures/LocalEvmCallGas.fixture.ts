// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { AContractExecutor } from "@/evm";
import { MathStateMachine__factory } from "@typechain-types";
import { ethers } from "hardhat";

const machineInterface = MathStateMachine__factory.createInterface();

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
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["tuple(uint256,address[],uint256[],uint256)"],
                [[0n, [participant], [0n], 0n]]
            )
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
    return {
        address,
        addOneTransaction,
        gasRequirement: () =>
            read(
                machineInterface.encodeFunctionData(
                    "getStateTransitionGasRequirement"
                )
            ),
        sum: () => read(machineInterface.encodeFunctionData("getSum")),
        addOne: () =>
            executor.executeCall(
                machineInterface.encodeFunctionData("stateTransition", [
                    addOneTransaction
                ]),
                address
            )
    };
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
