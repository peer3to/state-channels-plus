// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import { RootWorkerControl } from "./RootWorkerControl";
import { RootCreationControl } from "../runtimeRpc/RootCreationControl";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
import type AContractExecutor from "@/evm/contractExecutor/AContractExecutor";
import {
    createContractExecutor,
    type ContractExecutorFactoryOptions
} from "@/evm/contractExecutor/createContractExecutor";

import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { config } from "@/utils/config";
import { setupObservedP2pRuntime as setupP2pRuntime } from "@test/fixtures/node/ObservedP2pSetup";

export interface ScriptedExecutorOptions {
    workerUrl?: string | URL;
    workerData?: unknown;
    name?: string;
    onDetachedError?: (error: Error) => void;
}

// Each SDK-owned executor maps to its owning SDK signer address.
const peerAddresses = new Map<AContractExecutor, string>();

export function sdkExecutorPeerAddress(executor: AContractExecutor): string {
    const address = peerAddresses.get(executor);
    if (!address) throw new Error("Executor SDK identity is not available");
    return address;
}

const owners = new Map<AContractExecutor, P2pRuntimeHostRoot>();

export function sdkExecutorOwner(
    executor: AContractExecutor
): P2pRuntimeHostRoot {
    const owner = owners.get(executor);
    if (!owner) throw new Error("Executor is not owned by this fixture");
    return owner;
}

/**
 * Corrupt the params of the next `method` request this SDK-owned executor
 * posts on its actual runtime connection, so the runtime refuses it as
 * malformed. The caller disposes the returned control.
 */
export function corruptNextSdkExecutorRequest(
    executor: AContractExecutor,
    method: string
): RuntimeRpcControl {
    const connection = [
        ...sdkExecutorOwner(executor).connections.values()
    ].find((entry) => entry.remoteRelation === "child")!;
    const control = RuntimeRpcControl.attachTo(connection);
    control.corruptNextParams(method);
    return control;
}

const errors = new Map<AContractExecutor, Error[]>();
export function takeSdkExecutorErrors(executor: AContractExecutor): Error[] {
    return errors.get(executor)?.splice(0) ?? [];
}

const cleanups = new Set<() => Promise<void>>();

/**
 * A real runtime's executor. `beforeConfigure` runs once the host's Clock
 * runs and its chain reads are done, before the executor gets its
 * configuration (the executor itself starts with the host).
 */
export async function createSdkOwnedExecutor(
    options: Omit<ContractExecutorFactoryOptions, "configuration">,
    dependencies: ScriptedExecutorOptions = {},
    beforeConfigure?: () => Promise<void>,
    silenceScriptedReports = false,
    onRuntimeRoot?: (root: AInternalRpcRoot) => void
): Promise<AContractExecutor> {
    const uploadEndpoint = config.CRASH_LOG_UPLOAD_ENDPOINT;
    await startRuntimeTransportModesFixture();
    const setup = await prepareRuntimeSetup({
        runSdkInThread: false,
        vmDedicatedThread: options.dedicatedThread,
        crashLogUploadEndpoint: uploadEndpoint
    });
    if (silenceScriptedReports)
        setup.setupOptions.config = {
            ...setup.setupOptions.config,
            LOG_SKIP_WRITING: true,
            EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 0
        };
    let executor: AContractExecutor | undefined;
    const instance = await setupP2pRuntime(
        setup.scm,
        setup.deployedStateMachine,
        setup.deployStateMachine,
        { ...setup.setupOptions, customPrecompiles: options.customPrecompiles },
        {
            onRuntimeRoot,
            hostContext: {
                createContractExecutor: async (factoryOptions, owner) => {
                    options.logger?.attachLoggerService(owner.logger);
                    // The executor is the host's first child; its handler is in place
                    // before it starts, so its earliest detached error is a report too.
                    if (dependencies.onDetachedError)
                        RootCreationControl.reportNextChildErrors(
                            owner,
                            dependencies.onDetachedError
                        );
                    executor = await RootWorkerControl.run(
                        "vm",
                        dependencies,
                        () =>
                            createContractExecutor(
                                {
                                    ...factoryOptions,
                                    configuration:
                                        factoryOptions.configuration.then(
                                            async (configuration) => {
                                                await beforeConfigure?.();
                                                return configuration;
                                            }
                                        ),
                                    logger:
                                        options.logger ?? factoryOptions.logger
                                },
                                owner
                            )
                    );
                    owners.set(executor, owner);
                    return executor;
                }
            }
        }
    );
    const reported: Error[] = [];
    instance.onHostError((error) => reported.push(error));
    cleanups.add(async () => {
        await instance.dispose();
        if (reported.length) throw reported[0];
    });
    if (!executor) throw new Error("SDK did not construct its executor");
    errors.set(executor, reported);
    peerAddresses.set(executor, await instance.p2pSigner.getAddress());
    return executor;
}

export async function disposeSdkExecutorFixtures(): Promise<void> {
    try {
        await Promise.all([...cleanups].map((cleanup) => cleanup()));
    } finally {
        cleanups.clear();
        owners.clear();
        peerAddresses.clear();
        errors.clear();
        stopRuntimeTransportModesFixture();
    }
}

/** Keep synthetic watchdog output out of the runner's real starvation classifier. */
export function createSdkOwnedScriptedExecutor(
    options: Omit<ContractExecutorFactoryOptions, "configuration">,
    dependencies: ScriptedExecutorOptions
) {
    return createSdkOwnedExecutor(options, dependencies, undefined, true);
}
