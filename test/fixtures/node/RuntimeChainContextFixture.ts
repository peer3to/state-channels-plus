// @spec-test-coverage-ignore: real SDK startup and held-response staging; declarations live in RuntimeChainContext.test.ts and ContractExecutorCallGas.test.ts.
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import { createLoggerSdkFixture } from "./LoggerServiceFixture";
import { setupObservedP2pRuntime } from "./ObservedP2pSetup";
import SimpleNumberStorageArtifact from "../../../artifacts/contracts/test/SimpleNumberStorage.sol/SimpleNumberStorage.json";
import { startLogReceiver } from "../logging/LogUploader.fixture";
import {
    createContractExecutor,
    type ContractExecutorFactoryOptions
} from "@/evm/contractExecutor/createContractExecutor";
import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import { setupP2pRuntime } from "@/evm/p2pRuntime/setupP2pRuntime";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { createLogger } from "@/utils/logging";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { WebSocketProvider } from "ethers";
import { ethers } from "ethers";
import sinon from "sinon";

export async function assertHostOwnedRuntimeWait(
    method: "quiesce" | "leaveLobby"
): Promise<void> {
    const receiver = await startLogReceiver();
    const sdk = await createLoggerSdkFixture(receiver);
    try {
        expect(
            sdk.instance.stateChannelManagerContract.interface.getFunction(
                "open"
            )
        ).not.to.equal(null);
        expect(
            sdk.instance.stateChannelManagerContract.interface.getError(
                "ECDSAInvalidSignature"
            )
        ).not.to.equal(null);
        const received = sdk.control.holdNextResponse(method);
        const request =
            method === "quiesce"
                ? sdk.remote.lifecycle.quiesce().request({ timeoutMs: null })
                : sdk.instance.p2pSigner.leaveLobby(
                      ethers.id("absent-runtime-lobby")
                  );
        await received;
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(1);
        expect(sdk.control.pendingTimers()).to.equal(0);
        sdk.control.release();
        const result = await request;
        if (method === "quiesce") expect(result).to.deep.equal([]);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
    } finally {
        sdk.control.release();
        await sdk.dispose();
        await receiver.close();
    }
}

export async function assertRuntimeStartupFailure(): Promise<void> {
    await startRuntimeTransportModesFixture();
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: false,
            vmDedicatedThread: false,
            readyOptions: {}
        });
        const before = new Set(RootCreationControl.roots);
        const destroySpy = sinon.spy(WebSocketProvider.prototype, "destroy");
        try {
            let failure: unknown;
            try {
                await setupP2pRuntime(
                    setup.scm,
                    setup.deployedStateMachine,
                    setup.deployStateMachine,
                    {
                        ...setup.setupOptions,
                        config: {
                            ...setup.setupOptions.config,
                            // Deliberately unreachable: this case asserts that
                            // a failed chain connection is reported and the
                            // host provider destroyed. It must NOT pick up an
                            // ambient PROVIDER_URL — the runner offers every
                            // task a live node, which would make startup
                            // succeed and the assertions below meaningless.
                            PROVIDER_URL: "http://127.0.0.1:1"
                        }
                    }
                );
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(Error);
            expect((failure as Error).message).not.to.include("timed out");
            expect((failure as Error).message).to.include("ECONNREFUSED");
            expect(destroySpy.calledOnce).to.equal(true);
            expect(
                [...RootCreationControl.roots].every((root) => before.has(root))
            ).to.equal(true);
        } finally {
            destroySpy.restore();
        }
    } finally {
        await stopRuntimeTransportModesFixture();
    }
}

/**
 * Real runtime startup against a manager deployed over a contract that
 * answers no transition gas requirement, so the manager's
 * `getStateTransitionReplayGas` read reverts while the reads before it
 * succeed. Readiness must reject with that read's failure, no contract
 * executor may be created and every runtime root must close. The host's
 * provider is not destroyed here: startup already handed it to the
 * process-wide Clock, which keeps it (as after an ordinary disposal).
 */
export async function assertStartupReplayGasReadFailure(
    vmDedicatedThread: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: false,
            vmDedicatedThread,
            managerStateMachine: {
                artifact: SimpleNumberStorageArtifact,
                args: []
            }
        });
        // the reads before the gas reads still answer
        expect((await setup.scm.getAllTimes()).length).to.equal(4);
        expect(await setup.scm.getGasLimit()).to.be.greaterThan(0n);
        const replaySelector = setup.scm.interface.getFunction(
            "getStateTransitionReplayGas"
        ).selector;
        const before = new Set(RootCreationControl.roots);
        const startedRoots: AInternalRpcRoot[] = [];
        // record-only: each executor request is recorded and forwarded
        const executorRequests: ContractExecutorFactoryOptions[] = [];
        let failure: unknown;
        try {
            const instance = await setupObservedP2pRuntime(
                setup.scm,
                setup.deployedStateMachine,
                setup.deployStateMachine,
                setup.setupOptions,
                {
                    hostContext: {
                        createContractExecutor: (options, owner) => {
                            executorRequests.push(options);
                            return createContractExecutor(options, owner);
                        }
                    },
                    onRuntimeRoot: (root) => startedRoots.push(root)
                }
            );
            await instance.dispose();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        const message = (failure as Error).message;
        expect(message).to.include("CALL_EXCEPTION");
        expect(message).to.include(replaySelector);
        expect(executorRequests).to.deep.equal([]);
        expect(startedRoots.length).to.be.greaterThan(0);
        expect(
            startedRoots.filter((root) => RootCreationControl.roots.has(root))
        ).to.deep.equal([]);
        expect(
            [...RootCreationControl.roots].every((root) => before.has(root))
        ).to.equal(true);
    } finally {
        await stopRuntimeTransportModesFixture();
    }
}

export async function assertSubscriptionCleanup(
    subscribed: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    const setup = await prepareRuntimeSetup({
        runSdkInThread: false,
        vmDedicatedThread: false,
        readyOptions: {}
    });
    const { createRuntimeChainContext } = await import(
        "@/evm/p2pRuntime/RuntimeChainContext"
    );
    const { createConfig } = await import("@/utils/config");
    const context = await createRuntimeChainContext(
        createConfig(setup.setupOptions.config),
        setup.setupOptions.signerSecret!,
        createLogger({}, {}, { level: "error", attachErrorListener: false })
    );
    const provider = context.provider;
    if (!(provider instanceof MultiRpcProvider))
        throw new Error("Expected the runtime RPC node provider");
    const [node] = provider.nodes;
    let socket: WebSocketProvider | undefined;
    node.watchSockets((open) => {
        socket = open;
    })();
    if (!socket) throw new Error("Expected the node's open socket");
    const nodeSocket = socket;
    try {
        if (subscribed) {
            // block events reach this provider through the node's socket
            const send = nodeSocket.send.bind(nodeSocket);
            let subscriptionReady: Promise<unknown> | undefined;
            nodeSocket.send = (...args) => {
                const pending = send(...args);
                if (args[0] === "eth_subscribe") subscriptionReady = pending;
                return pending;
            };
            await provider.on("block", () => {});
            // the relay subscribes on the socket after on() resolves
            await waitFor(() => subscriptionReady !== undefined);
            await subscriptionReady;
            nodeSocket.send = send;
        }
        await provider.destroy();
        expect(provider.destroyed).to.equal(true);
        expect(await provider.listenerCount()).to.equal(0);
        expect(node.destroyed).to.equal(true);
        expect(nodeSocket.destroyed).to.equal(true);
        await provider.destroy();
        expect(provider.destroyed).to.equal(true);
    } finally {
        await provider.destroy();
        await stopRuntimeTransportModesFixture();
    }
}
