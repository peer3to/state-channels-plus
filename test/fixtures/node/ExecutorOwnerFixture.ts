// @spec-test-coverage-ignore: real SDK executor staging; executable evidence is mapped from test/evm/EvmFactory.test.ts
import {
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures,
    takeSdkExecutorErrors
} from "./SdkExecutorFixture";
import { getSimpleNumberStorageFactory } from "../SimpleNumberStorage.fixture";
import type AContractExecutor from "@/evm/contractExecutor/AContractExecutor";
import type ContractExecutor from "@/evm/contractExecutor/ContractExecutor";
import { IN_FLIGHT_REPLY_DRAIN_MS } from "@/rpc/internal/AInternalRpcRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { ContractExecutorService } from "@/rpc/internal/services/contractExecutor/ContractExecutorService";
import {
    runtimeValueChildren,
    type RuntimeValueChild
} from "@test/fixtures/node/RuntimeValuePrecompile";
import { RuntimeRpcControl } from "@test/fixtures/runtimeRpc/RuntimeRpcControl";
import { workerAnswerPrecompileOwners } from "@test/fixtures/workerAnswerPrecompile";
import { expect } from "chai";
import { ethers } from "hardhat";
import path from "node:path";

const PRECOMPILE_ADDRESS = "0x00000000000000000000000000000000000000cf";
const PRECOMPILE_BYTES = new Uint8Array([7, 8, 9]);

async function createExecutorWithChild(dedicatedThread: boolean) {
    const before = runtimeValueChildren.length;
    const executor = await createSdkOwnedExecutor({
        dedicatedThread,
        customPrecompiles: [
            {
                address: PRECOMPILE_ADDRESS,
                module: path.resolve(__dirname, "./RuntimeValuePrecompile.ts"),
                options: { value: 42n, bytes: PRECOMPILE_BYTES }
            }
        ]
    });
    // A worker executor keeps its precompile child in the worker realm.
    const record: RuntimeValueChild | undefined = dedicatedThread
        ? undefined
        : runtimeValueChildren[before];
    return { executor, record };
}

function decodeResult(returnValue: string) {
    const [value, flag, bytes] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "bool", "bytes"],
        returnValue
    );
    return { value, flag, bytes };
}

async function expectPrecompileResult(
    executor: AContractExecutor,
    call: "executeCall" | "simulateCall" = "executeCall"
) {
    const result = await executor[call]("0x", PRECOMPILE_ADDRESS);
    // The bytes came back through the child's real echo endpoint.
    expect(decodeResult(result.returnValue)).to.deep.equal({
        value: 42n,
        flag: false,
        bytes: ethers.hexlify(PRECOMPILE_BYTES)
    });
}

/** Holds the child's next real echo reply until released. */
function holdChildEcho(record: RuntimeValueChild) {
    const control = RuntimeRpcControl.attachTo(record.child);
    const held = control.holdNextResponse("echo");
    return { control, held };
}

async function settled<T>(promise: Promise<T>) {
    return promise.then(
        (value) => ({ ok: true as const, value }),
        (error: Error) => ({ ok: false as const, error: error.message })
    );
}

export async function assertInlineExecutorOwnerContext(): Promise<void> {
    const { executor, record } = await createExecutorWithChild(false);
    try {
        expect(record!.owner).to.be.instanceOf(ContractExecutorRoot);
        expect(record!.owner.children.has(record!.child)).to.equal(true);
        expect(record!.child.sameRealm).to.equal(false);
        await expectPrecompileResult(executor);
        expect(record!.calls).to.equal(1);
        await executor.dispose();
        expect(record!.child.isClosed).to.equal(true);
        expect(record!.owner.isDisposing).to.equal(true);
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

export async function assertWorkerExecutorOwnerContext(): Promise<void> {
    // The factory throws unless it receives the executor root and its child
    // attaches there, so a real result proves both inside the worker.
    const { executor } = await createExecutorWithChild(true);
    try {
        await expectPrecompileResult(executor);
        await expectPrecompileResult(executor, "simulateCall");
        await executor.dispose();
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

/**
 * An admitted call is waiting on the child's held reply while the executor
 * disposes; a deploy and a simulation are queued behind it on the executor
 * mutex. All three finish with their real results before the child closes.
 */
export async function assertDisposalWaitsForAdmittedWork(): Promise<void> {
    const { executor, record } = await createExecutorWithChild(false);
    try {
        const storage = await getSimpleNumberStorageFactory(ethers);
        const { control, held } = holdChildEcho(record!);
        const order: string[] = [];
        const call = settled(executor.executeCall("0x", PRECOMPILE_ADDRESS));
        await held;
        const deploy = settled(
            executor.deploy((await storage.getDeployTransaction()).data!)
        ).then((outcome) => {
            order.push("deploy");
            return outcome;
        });
        const simulation = settled(
            executor.simulateCall("0x", PRECOMPILE_ADDRESS)
        ).then((outcome) => {
            order.push("simulation");
            return outcome;
        });
        const disposal = Promise.resolve(executor.dispose()).then(() =>
            order.push("disposed")
        );
        // Absence window: disposal must stay parked on the admitted call, so
        // neither the child closes nor any queued work finishes meanwhile.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(record!.child.isClosed).to.equal(false);
        expect(order).to.deep.equal([]);

        control.release();
        const called = await call;
        order.push("call");
        await disposal;

        expect(called.ok).to.equal(true);
        if (called.ok)
            expect(decodeResult(called.value.returnValue).bytes).to.equal(
                ethers.hexlify(PRECOMPILE_BYTES)
            );
        const deployed = await deploy;
        expect(deployed.ok).to.equal(true);
        const simulated = await simulation;
        expect(simulated.ok).to.equal(true);
        expect(order.at(-1)).to.equal("disposed");
        expect(record!.child.isClosed).to.equal(true);
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

/**
 * A call, a deploy and a simulation that arrive after disposal began settle
 * without entering the EVM.
 */
export async function assertDisposalRejectsLaterAdmission(): Promise<void> {
    const { executor, record } = await createExecutorWithChild(false);
    try {
        const { control, held } = holdChildEcho(record!);
        const call = settled(executor.executeCall("0x", PRECOMPILE_ADDRESS));
        await held;
        const disposal = Promise.resolve(executor.dispose());
        // Scheduling delay: the disposal request reaches the executor and
        // closes admission before the late calls are sent.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const storage = await getSimpleNumberStorageFactory(ethers);
        const late = await Promise.all([
            settled(executor.executeCall("0x", PRECOMPILE_ADDRESS)),
            settled(
                executor.deploy((await storage.getDeployTransaction()).data!)
            ),
            settled(executor.simulateCall("0x", PRECOMPILE_ADDRESS))
        ]);
        for (const outcome of late)
            expect(outcome).to.deep.equal({
                ok: false,
                error: "Contract executor is shutting down"
            });
        expect(record!.calls).to.equal(1);
        control.release();
        expect((await call).ok).to.equal(true);
        await disposal;
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

/** A failing admitted operation keeps its own error; disposal still waits for it. */
export async function assertDisposalKeepsAdmittedFailure(): Promise<void> {
    const { executor, record } = await createExecutorWithChild(false);
    try {
        const { control, held } = holdChildEcho(record!);
        const call = settled(executor.executeCall("0x", PRECOMPILE_ADDRESS));
        await held;
        // Init code that hits INVALID: the deploy fails inside the EVM.
        const failing = settled(executor.deploy("0xfe"));
        const disposal = Promise.resolve(executor.dispose());
        control.release();
        expect((await call).ok).to.equal(true);
        const failed = await failing;
        await disposal;
        expect(failed.ok).to.equal(false);
        expect(record!.child.isClosed).to.equal(true);
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

export async function assertRepeatedExecutorDisposalSharesCompletion(): Promise<void> {
    const { executor, record } = await createExecutorWithChild(false);
    try {
        const { control, held } = holdChildEcho(record!);
        const call = settled(executor.executeCall("0x", PRECOMPILE_ADDRESS));
        await held;
        const first = Promise.resolve(executor.dispose());
        const second = Promise.resolve(executor.dispose());
        expect(first === second).to.equal(true);
        control.release();
        await Promise.all([first, second]);
        expect((await call).ok).to.equal(true);
        expect(record!.child.isClosed).to.equal(true);
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

/**
 * An admitted call stuck on a reply that never arrives holds disposal open
 * only for the drain limit. The executor then abandons it internally: the
 * child closes, the caller's request settles, and no error reaches the host.
 */
export async function assertDisposalAbandonsStuckAdmittedWork(): Promise<void> {
    const { executor, record } = await createExecutorWithChild(false);
    const { control, held } = holdChildEcho(record!);
    try {
        const call = settled(executor.executeCall("0x", PRECOMPILE_ADDRESS));
        await held;
        const started = Date.now();
        await executor.dispose();
        const elapsed = Date.now() - started;

        expect(elapsed).to.be.at.least(IN_FLIGHT_REPLY_DRAIN_MS - 100);
        expect(elapsed).to.be.below(IN_FLIGHT_REPLY_DRAIN_MS * 3);
        expect(record!.child.isClosed).to.equal(true);
        expect((await call).ok).to.equal(false);
        expect(record!.calls).to.equal(1);
        expect(takeSdkExecutorErrors(executor)).to.deep.equal([]);
    } finally {
        control.release();
        await disposeSdkExecutorFixtures();
    }
}

const DELAYED_ADDRESS = "0x00000000000000000000000000000000000000ce";
// Finishes after the admission drain limit, before the later reply drain ends.
const LATE_COMPLETION_MS = IN_FLIGHT_REPLY_DRAIN_MS + 1_200;
const ABANDONED_MESSAGE =
    "Contract executor shut down before the operation finished";

async function createLateCompletingExecutor(failAfterDelay: boolean) {
    const before = workerAnswerPrecompileOwners.length;
    const executor = await createSdkOwnedExecutor({
        dedicatedThread: false,
        customPrecompiles: [
            {
                address: DELAYED_ADDRESS,
                module: path.resolve(__dirname, "../workerAnswerPrecompile.ts"),
                options: {
                    expectedData: "0x1234",
                    value: "7",
                    callDelayMs: LATE_COMPLETION_MS,
                    failAfterDelay
                }
            }
        ]
    });
    // The inline executor handed the precompile factory its exact root.
    const owner = workerAnswerPrecompileOwners[before];
    if (!(owner instanceof ContractExecutorRoot))
        throw new Error("Expected the executor root as the precompile owner");
    return { executor, service: owner.executor };
}

/**
 * Disposes right after sending `calls`: the connection keeps message order,
 * so every call is admitted before disposal begins. A record-only wrapper on
 * the real service notes each admitted operation's own settlement; the
 * helper returns how each caller settled once every admitted operation has
 * itself finished, so any late outcome has already happened.
 */
async function disposeDuringLateWork(
    executor: AContractExecutor,
    service: ContractExecutorService,
    calls: () => Promise<unknown>[]
) {
    const admitted: Promise<unknown>[] = [];
    const original = service.admit;
    const admit = original.bind(service);
    service.admit = <T>(
        operation: (engine: ContractExecutor) => Promise<T>
    ): Promise<T> =>
        admit<T>((engine) => {
            const running = operation(engine);
            admitted.push(
                running.then(
                    () => undefined,
                    () => undefined
                )
            );
            return running;
        });
    try {
        const outcomes = calls().map((call) => settled(call));
        await executor.dispose();
        const settledOutcomes = await Promise.all(outcomes);
        await Promise.all(admitted);
        return { settledOutcomes, admittedCount: admitted.length };
    } finally {
        service.admit = original;
    }
}

/**
 * An admitted call that succeeds after the drain limit: its caller already
 * got the disposal rejection, and the late success reaches nobody.
 */
export async function assertLateSuccessAfterDrainLimitStaysRejected(): Promise<void> {
    const { executor, service } = await createLateCompletingExecutor(false);
    try {
        const { settledOutcomes, admittedCount } = await disposeDuringLateWork(
            executor,
            service,
            () => [executor.executeCall("0x1234", DELAYED_ADDRESS)]
        );
        expect(admittedCount).to.equal(1);
        expect(settledOutcomes).to.deep.equal([
            { ok: false, error: ABANDONED_MESSAGE }
        ]);
        expect(takeSdkExecutorErrors(executor)).to.deep.equal([]);
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

/**
 * An admitted call that fails after the drain limit: its caller keeps the
 * disposal rejection, and the late failure is not reported to the host.
 */
export async function assertLateFailureAfterDrainLimitStaysRejected(): Promise<void> {
    const { executor, service } = await createLateCompletingExecutor(true);
    try {
        const { settledOutcomes, admittedCount } = await disposeDuringLateWork(
            executor,
            service,
            () => [executor.executeCall("0x1234", DELAYED_ADDRESS)]
        );
        expect(admittedCount).to.equal(1);
        expect(settledOutcomes).to.deep.equal([
            { ok: false, error: ABANDONED_MESSAGE }
        ]);
        expect(takeSdkExecutorErrors(executor)).to.deep.equal([]);
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

/**
 * A deploy and a simulation queued on the executor mutex behind a call that
 * finishes after the drain limit: every caller gets the disposal rejection,
 * and the queued work, observed until it has finished, reaches nobody.
 */
export async function assertQueuedWorkAfterDrainLimitStaysRejected(): Promise<void> {
    const { executor, service } = await createLateCompletingExecutor(false);
    try {
        const storage = await getSimpleNumberStorageFactory(ethers);
        const deployData = (await storage.getDeployTransaction()).data!;
        const { settledOutcomes, admittedCount } = await disposeDuringLateWork(
            executor,
            service,
            () => [
                executor.executeCall("0x1234", DELAYED_ADDRESS),
                executor.deploy(deployData),
                executor.simulateCall("0x1234", DELAYED_ADDRESS)
            ]
        );
        // All three were admitted and each has finished before this point.
        expect(admittedCount).to.equal(3);
        for (const outcome of settledOutcomes)
            expect(outcome).to.deep.equal({
                ok: false,
                error: ABANDONED_MESSAGE
            });
        expect(takeSdkExecutorErrors(executor)).to.deep.equal([]);
    } finally {
        await disposeSdkExecutorFixtures();
    }
}
