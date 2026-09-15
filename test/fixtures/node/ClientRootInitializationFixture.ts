import { withRuntimeRpc } from "../RpcRouterFixture";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
// @spec-test-coverage-ignore: real SDK setup and creation staging; declarations live in RootCreation.test.ts.
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import type P2pInstance from "@/evm/P2pInstance";

import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { WebRTCMainThreadBridgeRoot } from "@/rpc/internal/roots/WebRTCMainThreadBridge";
import { WebRTCWorkerBridgeRoot } from "@/rpc/internal/roots/WebRTCWorkerBridgeRoot";
import { createLogger } from "@/utils";
import { config } from "@/utils/config";
import type { LogStore } from "@/utils/logging/logStore";
import { setupObservedP2pRuntime as setupP2pRuntime } from "@test/fixtures/node/ObservedP2pSetup";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";
import { Wallet } from "ethers";
import path from "node:path";
import { performance } from "node:perf_hooks";

class ObservedStandaloneExecutorRoot extends ContractExecutorRoot {
    // Overrides ContractExecutorRoot.start: assert automatic logging before domain startup.
    public override async start(): Promise<void> {
        expect(this.rootLogger.loggerService === this.logger).to.equal(true);
        this.rootLogger.info("automatic logger before start");
        const store = Reflect.get(this.rootLogger, "logStore") as LogStore;
        expect(store.getAllLogs().at(-1)?.context.component).to.equal(
            this.constructor.name
        );
        await super.start();
    }
}

export async function assertStandaloneRoot(fail: boolean): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const before = new Set(RootCreationControl.roots);
        const started = performance.now();
        const creation = RootCreationControl.observe(() =>
            createRoot(ObservedStandaloneExecutorRoot, {
                mode: "inline",
                args: {
                    config,
                    customPrecompiles: [
                        {
                            address:
                                "0x00000000000000000000000000000000000000ff",
                            module: path.join(
                                __dirname,
                                "../workerAnswerPrecompile.ts"
                            ),
                            exportName: fail ? "missingExport" : "default",
                            options: {
                                delayMs: 80,
                                expectedData: "0x",
                                value: "1"
                            }
                        }
                    ]
                }
            })
        );
        if (fail) {
            let failure: unknown;
            try {
                await creation;
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(Error);
            expect(
                [...RootCreationControl.roots].every((root) => before.has(root))
            ).to.equal(true);
        } else {
            const root = await creation;
            try {
                expect(performance.now() - started).to.be.at.least(80);
                expect(root.executor.getExecutor()).not.to.equal(undefined);
                expect(root.connections.size).to.equal(0);
                expect(
                    [...RootCreationControl.roots].filter(
                        (item) => !before.has(item)
                    ).length
                ).to.equal(1);
                await root.lifecycle.signalReady();
                expect(root.connections.size).to.equal(0);
            } finally {
                await root.dispose();
                root.closeConnections();
            }
        }
        expect(await sdk.remote.runtimeProbe.sum(4, 5).request()).to.equal(9);
    });
}

export async function assertWorkerNeedsParent(): Promise<void> {
    const before = new Set(RootCreationControl.roots);
    let failure: unknown;
    try {
        await Reflect.apply(createRoot, undefined, [
            ContractExecutorRoot,
            {
                mode: "worker",
                args: { config, customPrecompiles: [] }
            }
        ]);
    } catch (error) {
        failure = error;
    }
    expect((failure as Error).message).to.equal(
        "Worker roots require a parent"
    );
    expect([...RootCreationControl.roots]).to.deep.equal([...before]);
}

export async function assertClientInitialization(
    failDeployment?: 1 | 2 | "observer" | "host-observer",
    runSdkInThread = false
): Promise<void> {
    await startRuntimeTransportModesFixture();
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread,
            vmDedicatedThread: false,
            readyOptions: {}
        });
        const before = new Set(RootCreationControl.roots);
        let client: P2pRuntimeClientRoot | undefined;
        let deployments = 0;
        const addresses: string[] = [];
        const failure = new Error(`deployment ${failDeployment} failed`);
        let finished = false;
        let release!: () => void;
        let entered!: () => void;
        const enteredDeployment = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const creation = setupP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            async (signer) => {
                deployments++;
                if (deployments === 1) {
                    entered();
                    await held;
                }
                if (deployments === failDeployment) throw failure;
                const address = await setup.deployStateMachine(signer);
                const encodedReturnData = await signer.call({
                    to: address,
                    data: setup.deployedStateMachine.interface.encodeFunctionData(
                        "getSum"
                    )
                });
                expect(encodedReturnData).to.equal(
                    setup.deployedStateMachine.interface.encodeFunctionResult(
                        "getSum",
                        [0n]
                    )
                );
                addresses.push(address.toString());
                return address;
            },
            setup.setupOptions,
            {
                onRuntimeRoot: (root) => {
                    if (
                        root instanceof P2pRuntimeHostRoot &&
                        failDeployment === "host-observer"
                    )
                        throw failure;
                    if (root instanceof P2pRuntimeClientRoot) {
                        client = root;
                        if (failDeployment === "observer") throw failure;
                        const added = [...RootCreationControl.roots].filter(
                            (item) => !before.has(item)
                        );
                        expect(added[0] === root).to.equal(true);
                    }
                }
            }
        );
        void creation.then(
            () => {
                finished = true;
            },
            () => {
                finished = true;
            }
        );
        if (
            failDeployment === "observer" ||
            failDeployment === "host-observer"
        ) {
            const caught = await creation.catch((error) => error);
            expect(caught === failure).to.equal(true);
            expect(deployments).to.equal(0);
            expect(
                [...RootCreationControl.roots].every((root) => before.has(root))
            ).to.equal(true);
            return;
        }
        await enteredDeployment;
        expect(finished).to.equal(false);
        expect(client?.p2pRuntimeHostRemoteRoot).not.to.equal(undefined);
        expect(
            client!.children.has(client!.p2pRuntimeHostRemoteRoot!)
        ).to.equal(true);
        release();
        if (failDeployment) {
            let caught: unknown;
            try {
                await creation;
            } catch (error) {
                caught = error;
            }
            expect(caught === failure).to.equal(true);
            expect(deployments).to.equal(failDeployment);
            expect(
                [...RootCreationControl.roots].every((root) => before.has(root))
            ).to.equal(true);
            expect(client!.connections.size).to.equal(0);
        } else {
            const instance = await creation;
            try {
                expect(deployments).to.equal(2);
                expect(addresses[0]).not.to.equal(addresses[1]);
                expect("signer" in client!).to.equal(false);
                expect("contract" in client!).to.equal(false);
                expect("hostRpc" in client!).to.equal(false);
                expect(await instance.p2pSigner.getAddress()).to.equal(
                    await client!
                        .p2pRuntimeHostRemoteRoot!.rpc.deploySigner.getAddress()
                        .request()
                );
                expect("ready" in client!).to.equal(false);
            } finally {
                await instance.dispose();
            }
        }
    } finally {
        await stopRuntimeTransportModesFixture();
    }
}

export async function assertDelayedHostInitialization(
    worker: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    let control: RuntimeRpcControl | undefined;
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: worker,
            vmDedicatedThread: false,
            readyOptions: {}
        });
        let held!: Promise<void>;
        let observed!: () => void;
        const observing = new Promise<void>((resolve) => {
            observed = resolve;
        });
        let completed = false;
        const creation = setupP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            setup.deployStateMachine,
            setup.setupOptions,
            {
                onRuntimeRoot: (root) => {
                    if (!(root instanceof P2pRuntimeClientRoot)) return;
                    const connection = [...root.connections.values()][0];
                    control = RuntimeRpcControl.attachTo(connection);
                    held = control.holdNextMessage("ready");
                    observed();
                }
            }
        );
        void creation.then(
            () => {
                completed = true;
            },
            () => {
                completed = true;
            }
        );
        try {
            await observing;
            await held;
            expect(completed).to.equal(false);
        } finally {
            control?.release();
        }
        const instance = await creation;
        await instance.dispose();
    } finally {
        control?.release();
        control?.dispose();
        await stopRuntimeTransportModesFixture();
    }
}

export async function assertStandaloneBridge(broker: boolean): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        if (broker) {
            const root = await createRoot(WebRTCMainThreadBridgeRoot, {
                args: {}
            });
            try {
                expect(root.connections.size).to.equal(0);
                const failure = await root
                    .createOffer(Wallet.createRandom().address)
                    .catch((error) => error);
                expect(failure.message).to.equal(
                    "WebRTC bridge requires a configured recipient"
                );
            } finally {
                await root.dispose();
                root.closeConnections();
            }
        } else {
            const failure = await createRoot(WebRTCWorkerBridgeRoot, {
                args: undefined
            }).catch((error: Error) => error);
            expect(failure).to.be.instanceOf(Error);
            expect((failure as Error).message).to.equal(
                "Worker bridge requires its local connection factory and broker port"
            );
        }
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
    });
}

export async function assertParentedClientRoot(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: false,
            vmDedicatedThread: false,
            readyOptions: {}
        });
        const signer = new Wallet(setup.setupOptions.signerSecret!);
        const connected = await createRoot(P2pRuntimeClientRoot, {
            parent: sdk.clientRoot,
            mode: "inline",
            args: {
                signerAddress: signer.address,
                payload: {
                    config: { ...config, ...setup.setupOptions.config },
                    signerSecret: signer.privateKey,
                    scm: {
                        address: await setup.scm.getAddress(),
                        abiJson: setup.scm.interface.formatJson()
                    },
                    stateMachine: {
                        address: await setup.deployedStateMachine.getAddress(),
                        abiJson:
                            setup.deployedStateMachine.interface.formatJson()
                    }
                }
            }
        });
        const root = RootCreationControl.connection(sdk.clientRoot, connected)[
            "localPeerRemoteRoot"
        ]?.["owner"];
        try {
            expect(root instanceof P2pRuntimeClientRoot).to.equal(true);
            if (!(root instanceof P2pRuntimeClientRoot))
                throw new Error("Expected local client root");
            expect("contract" in root).to.equal(false);
            expect(
                await root
                    .p2pRuntimeHostRemoteRoot!.rpc.deploySigner.getAddress()
                    .request()
            ).to.equal(signer.address);
            expect(
                [...root.connections.values()].filter(
                    (connection) => connection.remoteRelation === "parent"
                ).length
            ).to.equal(1);
            await connected.dispose();
            expect(root.connections.size).to.equal(0);
            expect(RootCreationControl.roots.has(root)).to.equal(false);
            expect(await sdk.remote.runtimeProbe.sum(3, 4).request()).to.equal(
                7
            );
        } finally {
            await connected.dispose();
            root?.closeConnections();
        }
    });
}

export async function assertMissingClientDependencies(): Promise<void> {
    const before = new Set(RootCreationControl.roots);
    let failure: unknown;
    try {
        await createRoot(P2pRuntimeClientRoot, { args: undefined });
    } catch (error) {
        failure = error;
    }
    expect((failure as Error).message).to.equal(
        "Client root requires host connection options"
    );
    expect(
        [...RootCreationControl.roots].every((root) => before.has(root))
    ).to.equal(true);
}

export async function assertApplicationCleanupOnHostClose(
    borrowed: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    const suppliedLogger = borrowed
        ? createLogger({}, { component: "ClientCleanupTest" })
        : undefined;
    let instance: P2pInstance<MathStateMachine> | undefined;
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: false,
            vmDedicatedThread: false
        });
        let client: P2pRuntimeClientRoot | undefined;
        instance = await setupP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            setup.deployStateMachine,
            { ...setup.setupOptions, peerLogger: suppliedLogger },
            {
                onRuntimeRoot: (root) => {
                    if (root instanceof P2pRuntimeClientRoot) client = root;
                }
            }
        );
        const logger = instance.logger;
        expect(logger).not.to.equal(suppliedLogger);
        logger.info("application logger before cleanup");
        const disposeLogger = logger.dispose.bind(logger);
        let loggerDisposals = 0;
        logger.dispose = (options) => {
            loggerDisposals++;
            disposeLogger(options);
        };
        try {
            await instance.p2pContractInstance.on(
                instance.p2pContractInstance.filters.Addition(),
                () => {}
            );
            expect(
                await instance.p2pContractInstance.listenerCount()
            ).to.be.greaterThan(0);
            RootCreationControl.connection(
                client!,
                client!.p2pRuntimeHostRemoteRoot!
            )["transport"].close(true);
            await waitFor(
                async () =>
                    (await instance!.p2pContractInstance.listenerCount()) ===
                        0 && client!.connections.size === 0
            );
            // The close notification initiates cleanup without an application dispose call.
            await waitFor(() => loggerDisposals === 1);
            expect(loggerDisposals).to.equal(1);
            await instance.dispose();
            expect(loggerDisposals).to.equal(1);
            expect(() => logger.info("disposed application logger")).to.throw(
                "has been disposed"
            );
            if (suppliedLogger)
                expect(() =>
                    suppliedLogger.info("caller remains active")
                ).not.to.throw();
        } finally {
            logger.dispose = disposeLogger;
        }
    } finally {
        await instance?.dispose();
        suppliedLogger?.dispose();
        await stopRuntimeTransportModesFixture();
    }
}

export async function assertCallerLoggerAfterSetupFailure(): Promise<void> {
    await startRuntimeTransportModesFixture();
    const logger = createLogger({}, { component: "CallerAfterSetupFailure" });
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: false,
            vmDedicatedThread: false,
            readyOptions: { reject: true }
        });
        const failure = await setupP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            setup.deployStateMachine,
            { ...setup.setupOptions, peerLogger: logger }
        ).catch((error: Error) => error);
        expect(failure).to.be.instanceOf(Error);
        expect((failure as Error).message).to.equal("root ready boom");
        expect(logger.loggerService).to.equal(undefined);
        expect(() => logger.info("caller after failed setup")).not.to.throw();
        const child = logger.child({ component: "NextApplication" });
        child.info("caller can create another application logger");
        child.dispose();
    } finally {
        logger.dispose();
        await stopRuntimeTransportModesFixture();
    }
}
