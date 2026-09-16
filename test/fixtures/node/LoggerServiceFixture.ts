// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { RootWorkerControl } from "./RootWorkerControl";
import type { ReadyLifecycleRpc } from "../customRpc/ReadyLifecycleRpcManifest";
import { crashLogUploadOverrides } from "../logging/crashLogConfig";
import {
    createUploaderFixture,
    type LogReceiver
} from "../logging/LogUploader.fixture";
import {
    installLoggerProbe,
    type LoggerProbeRoot
} from "../runtimeRpc/probe/logger/LoggerProbeService";
import {
    installRuntimeProbe,
    type RuntimeProbeRoot
} from "../runtimeRpc/probe/runtime/RuntimeProbeService";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import type P2pInstance from "@/evm/P2pInstance";

import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type InternalTransport from "@/transport/InternalTransport";
import type { Logger } from "@/utils/logging/Logger";
import type { LogUploadOutcome } from "@/utils/logging/LogUploader";
import { setupObservedP2pRuntime as setupP2pRuntime } from "@test/fixtures/node/ObservedP2pSetup";
import { PeerIdentityExecutionContext } from "@test/harness/core/peerErrorAttribution";
import type { MathStateMachine } from "@typechain-types";
import { Wallet } from "ethers";
import path from "node:path";

export interface LoggerSdkFixture {
    instance: P2pInstance<MathStateMachine, ReadyLifecycleRpc>;
    logger: Logger;
    roots: Set<AInternalRpcRoot>;
    clientRoot: P2pRuntimeClientRoot;
    parentTransport: InternalTransport;
    remote: RuntimeConnection<
        P2pRuntimeHostRoot & LoggerProbeRoot & RuntimeProbeRoot
    >;
    frames: RuntimeRpcControl["sent"];
    control: RuntimeRpcControl;
    uploadState: LoggerProbeRoot["loggerProbe"]["uploadState"];
    cancelPendingUpload(): void;
    own(): Promise<LogUploadOutcome>;
    flush(reason: string): Promise<LogUploadOutcome>;
    dispose(): Promise<void>;
}

export function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

export async function createLoggerSdkFixture(
    receiver: LogReceiver,
    options: {
        inlineSdk?: boolean;
        vmWorker?: boolean;
        disabled?: boolean;
        peerLogger?: Logger;
        identityContext?: boolean;
        signerSecret?: string;
        rejectDomainDisposal?: boolean;
    } = {}
): Promise<LoggerSdkFixture> {
    await startRuntimeTransportModesFixture();
    const setup = await prepareRuntimeSetup({
        runSdkInThread: !options.inlineSdk,
        vmDedicatedThread: Boolean(options.vmWorker),
        readyOptions: {}
    });
    const ownLogger = options.peerLogger
        ? undefined
        : createUploaderFixture({
              uploadEndpoint: options.disabled ? "" : receiver.url,
              sharedContext: { threadName: "main" },
              jitterMaxMs: 0
          });
    const logger = options.peerLogger ?? ownLogger!.logger;
    const roots = new Set<AInternalRpcRoot>();
    let clientRoot!: P2pRuntimeClientRoot;
    let parentTransport!: InternalTransport;
    let remote!: RuntimeConnection<
        P2pRuntimeHostRoot & LoggerProbeRoot & RuntimeProbeRoot
    >;
    let control!: RuntimeRpcControl;
    const instance = await setupP2pRuntime<MathStateMachine, ReadyLifecycleRpc>(
        setup.scm,
        setup.deployedStateMachine,
        setup.deployStateMachine,
        {
            ...setup.setupOptions,
            ...(options.rejectDomainDisposal
                ? {
                      customRpcManifest: {
                          module: path.join(
                              __dirname,
                              "../customRpc/RejectingDisposeRpcManifest.ts"
                          ),
                          exportName: "RejectingDisposeRpc"
                      }
                  }
                : {}),
            signerSecret:
                options.signerSecret ?? setup.setupOptions.signerSecret,
            handlerExecutionContext: options.identityContext
                ? new PeerIdentityExecutionContext(
                      new Wallet(
                          options.signerSecret ??
                              setup.setupOptions.signerSecret!
                      ).address
                  )
                : undefined,
            peerLogger: logger,
            config: {
                ...setup.setupOptions.config,
                ...crashLogUploadOverrides(options.disabled ? "" : receiver.url)
            }
        },
        {
            workerData: {},
            workerUrl: path.join(__dirname, "../node/RuntimeRpcSdkEntry.ts"),
            hostContext: {
                createContractExecutor: (factoryOptions, owner) =>
                    RootWorkerControl.run(
                        "vm",
                        {
                            workerData: {},
                            workerUrl: path.join(
                                __dirname,
                                "../node/RuntimeRpcExecutorEntry.ts"
                            )
                        },
                        () => createContractExecutor(factoryOptions, owner)
                    )
            },
            onRuntimeRoot: (root) => {
                roots.add(root);
                installLoggerProbe(root);
                installRuntimeProbe(root);
                if (!(root instanceof P2pRuntimeClientRoot)) return;
                clientRoot = root;
                const remoteRoot = [...root.connections.values()][0];
                parentTransport = remoteRoot["transport"];
                remote = remoteRoot.rpc as RuntimeConnection<
                    P2pRuntimeHostRoot & LoggerProbeRoot & RuntimeProbeRoot
                >;
                control = RuntimeRpcControl.attach(parentTransport);
            }
        }
    );
    await remote.loggerProbe.clearRealm().request();
    if (options.vmWorker) await remote.loggerProbe.clearChildRealm().request();
    logger.clearLogs();
    control.sent.length = 0;
    receiver.requests.length = 0;
    return {
        instance,
        logger,
        roots,
        clientRoot,
        parentTransport,
        remote,
        frames: control.sent,
        control,
        uploadState: () =>
            (
                clientRoot as P2pRuntimeClientRoot & LoggerProbeRoot
            ).loggerProbe.uploadState(),
        cancelPendingUpload() {
            // Pin the timer branch synchronously; farm latency is not the oracle.
            clientRoot.logger["windowEndsAt"] = Date.now() + 100;
            clientRoot.logger.upload(10, "pending");
            if (clientRoot.logger["pendingUpload"] === undefined)
                throw new Error("Expected a pending service upload");
            clientRoot.logger.dispose();
            if (clientRoot.logger["pendingUpload"] !== undefined)
                throw new Error("Disposed service retained its upload timer");
        },
        own: () => logger.uploadOwnLogs(),
        flush: (reason: string) => logger.upload(reason),
        async dispose() {
            await instance.dispose();
            ownLogger?.logger.dispose();
            stopRuntimeTransportModesFixture();
        }
    };
}
