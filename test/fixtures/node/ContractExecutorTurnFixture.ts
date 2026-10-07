// @spec-test-coverage-ignore: real executor staging and an event-loop turn counter shared by mapped tests
import { ContractExecutor } from "@/evm";
import type { Address } from "@/types/types";
import { EVM } from "@ethereumjs/evm";
import { getSimpleNumberStorageFactory } from "@test/fixtures/SimpleNumberStorage.fixture";
import { ethers } from "hardhat";
import { setImmediate } from "node:timers";

/** A real executor with SimpleNumberStorage deployed through it. */
export async function deployedNumberStorage() {
    const executor = new ContractExecutor(await EVM.create());
    const factory = await getSimpleNumberStorageFactory(ethers);
    const deployTx = await factory.getDeployTransaction();
    const deployed = await executor.deploy(deployTx.data);
    if (!deployed.createdAddress)
        throw new Error("SimpleNumberStorage deploy created no contract");
    return {
        executor,
        address: deployed.createdAddress as Address,
        storage: factory.interface
    };
}

/**
 * Counts event-loop iterations: a setImmediate chain increments the counter
 * once per check phase. Two marks with the same value were taken in the same
 * loop iteration; a larger value means at least one iteration passed.
 */
export function startTurnCounter() {
    let turn = 0;
    let stopped = false;
    const tick = () => {
        if (stopped) return;
        turn += 1;
        setImmediate(tick);
    };
    setImmediate(tick);
    return {
        current: () => turn,
        stop: () => {
            stopped = true;
        }
    };
}

/**
 * Resolves after the timers already scheduled have run, so an executor
 * release scheduled before this call has freed the mutex.
 */
export function afterPendingTimers(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
