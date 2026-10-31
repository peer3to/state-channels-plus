// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import { EvmStateMachine } from "@/evm";
import type P2pInstance from "@/evm/P2pInstance";
import DeploymentBridgeSigner from "@/evm/signer/DeploymentBridgeSigner";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import {
    childDisposedError,
    isRootDisposedError
} from "@/rpc/internal/RemoteRoot";
import type { HostRootManifest } from "@/rpc/internal/roots/resolveHostRootManifest";
import { config } from "@/utils/config";
import { bundleProbeHostRoot } from "@test/fixtures/hostRoot/BundledProbeHostRoot";
import { FAILING_READY_MESSAGE } from "@test/fixtures/hostRoot/FailingReadyRpc";
import type { ProbeHostRoot } from "@test/fixtures/hostRoot/ProbeHostRoot";
import {
    PROBE_HOST_ROOT_MODULE,
    failingReadyRpcManifest,
    nonClassHostRootManifest,
    probeHostRootManifest,
    probeRpcManifest
} from "@test/fixtures/hostRoot/ProbeHostRootManifest";
import { CUT_GRACE_MS } from "@test/harness/core/peerErrorAttribution";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";
import type { Signer } from "ethers";

type ProbeInstance = P2pInstance<MathStateMachine, ProbeHostRoot>;

/** The rejection a call gets when it names a service no root serves. */
function unknownEndpointError(service: string, method: string): string {
    return `Unknown RPC endpoint '${service}.${method}'`;
}

/** Message of a promise's rejection; fails when it resolves. */
async function rejectionOf(pending: Promise<unknown>): Promise<Error> {
    try {
        await pending;
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
        return error as Error;
    }
    throw new Error("Expected the request to reject");
}

/**
 * A real runtime, worker or inline, started through the public setup with
 * the given host root manifest; disposed after `run`.
 */
async function withRuntime(
    runSdkInThread: boolean,
    hostRootManifest: HostRootManifest<ProbeHostRoot> | undefined,
    run: (
        instance: ProbeInstance,
        deployStateMachine: (signer: Signer) => Promise<string>
    ) => Promise<void>
): Promise<void> {
    await startRuntimeTransportModesFixture();
    let instance: ProbeInstance | undefined;
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread,
            vmDedicatedThread: false
        });
        instance = await EvmStateMachine.p2pSetup(
            setup.scm,
            setup.deployedStateMachine,
            setup.deployStateMachine,
            {
                ...setup.setupOptions,
                // The probe application gives both of its manifests.
                customRpcManifest: hostRootManifest
                    ? probeRpcManifest()
                    : undefined,
                hostRootManifest
            }
        );
        await run(instance, setup.deployStateMachine);
    } finally {
        await instance?.dispose();
        stopRuntimeTransportModesFixture();
    }
}

/** The subclass's internal service answers, next to the SDK's own services. */
export async function assertManifestHostRootServesProbe(
    runSdkInThread: boolean
): Promise<void> {
    await withRuntime(
        runSdkInThread,
        probeHostRootManifest(),
        async (instance) => {
            const signerAddress = await instance.p2pSigner.getAddress();
            expect(
                await instance.host.probe.echo("hello").request()
            ).to.deep.equal({ value: "hello", signerAddress });
            expect(
                await instance.host.probe.getEchoes().request()
            ).to.deep.equal(["hello"]);
            expect(
                await instance.host.deploySigner.getAddress().request()
            ).to.equal(signerAddress);
        }
    );
}

/**
 * A second `deployComplete` over a live runtime rejects before any build or
 * cleanup, and the original runtime keeps serving.
 */
export async function assertSecondDeployCompleteRejects(
    runSdkInThread: boolean
): Promise<void> {
    await withRuntime(
        runSdkInThread,
        probeHostRootManifest(),
        async (instance, deployStateMachine) => {
            const signerAddress = await instance.p2pSigner.getAddress();
            // Two fresh local state machines, deployed like the setup's own.
            const deployer = new DeploymentBridgeSigner(
                instance.host,
                signerAddress
            );
            const localAddress = await deployStateMachine(deployer);
            const diamondAddress = await deployStateMachine(deployer);
            const failure = await rejectionOf(
                instance.host.sdkSetup
                    .deployComplete(localAddress, diamondAddress)
                    .request()
            );
            expect(failure.message).to.equal("Runtime already built");
            expect(
                await instance.host.probe.echo("still served").request()
            ).to.deep.equal({ value: "still served", signerAddress });
        }
    );
}

/**
 * A worker host root compiled apart from the SDK worker entry reads its own
 * config module copy, which holds its peer's configuration.
 */
export async function assertBundledHostRootAppliesPeerConfig(): Promise<void> {
    const bundle = await bundleProbeHostRoot();
    try {
        await withRuntime(true, bundle.manifest, async (instance) => {
            // The setup sent the config it applied here as payload.config;
            // the module default is false.
            expect(config.RUN_SDK_IN_THREAD).to.equal(true);
            expect(
                await instance.host.probe
                    .readConfig("RUN_SDK_IN_THREAD")
                    .request()
            ).to.equal(config.RUN_SDK_IN_THREAD);
        });
    } finally {
        await bundle.dispose();
    }
}

/** No manifest: the SDK's own root serves its services and no probe. */
export async function assertDefaultHostRootStarts(
    runSdkInThread: boolean
): Promise<void> {
    await withRuntime(runSdkInThread, undefined, async (instance) => {
        const signerAddress = await instance.p2pSigner.getAddress();
        expect(
            await instance.host.deploySigner.getAddress().request()
        ).to.equal(signerAddress);
        // The client typed a probe root; the host it got has none.
        const failure = await rejectionOf(
            instance.host.probe.echo("absent").request()
        );
        expect(failure.message).to.equal(unknownEndpointError("probe", "echo"));
    });
}

/** Setup rejects with the loader's error. */
export async function assertNonClassManifestRejects(
    runSdkInThread: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    let instance: P2pInstance<MathStateMachine> | undefined;
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread,
            vmDedicatedThread: false
        });
        const failure = await rejectionOf(
            EvmStateMachine.p2pSetup(
                setup.scm,
                setup.deployedStateMachine,
                setup.deployStateMachine,
                {
                    ...setup.setupOptions,
                    hostRootManifest: nonClassHostRootManifest()
                }
            ).then((resolved) => {
                // Kept so an unexpected setup is still disposed.
                instance = resolved;
            })
        );
        expect(failure.message).to.equal(
            `Host root module "${PROBE_HOST_ROOT_MODULE}" must export a host root class`
        );
    } finally {
        await instance?.dispose();
        stopRuntimeTransportModesFixture();
    }
}

/**
 * A runtime whose build fails (its application's readiness rejects) answers
 * the setup as soon as its disposal is done.
 */
export async function assertFailedBuildRepliesPromptly(
    runSdkInThread: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    let instance: P2pInstance<MathStateMachine> | undefined;
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread,
            vmDedicatedThread: false
        });
        const failure = await rejectionOf(
            EvmStateMachine.p2pSetup(
                setup.scm,
                setup.deployedStateMachine,
                setup.deployStateMachine,
                {
                    ...setup.setupOptions,
                    customRpcManifest: failingReadyRpcManifest(),
                    hostRootManifest: probeHostRootManifest()
                }
            ).then((resolved) => {
                // Kept so an unexpected setup is still disposed.
                instance = resolved;
            })
        );
        const answeredAtMs = Date.now();
        expect(failure.message).to.include(FAILING_READY_MESSAGE);
        const failedAtMs = Number(
            failure.message
                .split(FAILING_READY_MESSAGE)[1]
                .trim()
                .split(/\s/)[0]
        );
        expect(answeredAtMs - failedAtMs).to.be.below(CUT_GRACE_MS / 2);
    } finally {
        await instance?.dispose();
        stopRuntimeTransportModesFixture();
    }
}

/** A service error crosses the port with its name, message and code. */
export async function assertServiceErrorKeepsIdentity(
    runSdkInThread: boolean
): Promise<void> {
    await withRuntime(
        runSdkInThread,
        probeHostRootManifest(),
        async (instance) => {
            const failure = await rejectionOf(
                instance.host.probe
                    .fail(
                        "ProbeFailure",
                        "probe failed on purpose",
                        "PROBE_FAILED"
                    )
                    .request()
            );
            expect(failure.name).to.equal("ProbeFailure");
            expect(failure.message).to.equal("probe failed on purpose");
            expect((failure as Error & { code?: string }).code).to.equal(
                "PROBE_FAILED"
            );
        }
    );
}

/**
 * A request still running at disposal is not waited for: it rejects with
 * RootDisposedError when the port closes, and so does a request sent after
 * disposal.
 */
export async function assertDisposalRejectsRunningCall(
    runSdkInThread: boolean
): Promise<void> {
    let host: RuntimeConnection<ProbeHostRoot> | undefined;
    let running: Promise<Error> | undefined;
    let disposalMs = 0;
    await withRuntime(
        runSdkInThread,
        probeHostRootManifest(),
        async (instance) => {
            host = instance.host;
            await instance.host.probe.echo("ready").request();
            running = rejectionOf(instance.host.probe.hang().request());
            const startedAt = Date.now();
            await instance.dispose();
            disposalMs = Date.now() - startedAt;
        }
    );
    // the disposal waits for no handler
    expect(disposalMs).to.be.below(CUT_GRACE_MS);
    const failure = await running!;
    expect(isRootDisposedError(failure)).to.equal(true);
    expect(failure.message).to.equal(childDisposedError().message);
    const late = await rejectionOf(host!.probe.echo("late").request());
    expect(late.message).to.equal(childDisposedError().message);
}

/** An event the runtime emits reaches the typed client listener with its args. */
export async function assertApplicationEventReachesClient(
    runSdkInThread: boolean
): Promise<void> {
    await withRuntime(
        runSdkInThread,
        probeHostRootManifest(),
        async (instance) => {
            const received: Array<[string, number]> = [];
            instance.events.on("application", "probeEvent", (label, count) =>
                received.push([label, count])
            );
            // The event is posted on the port ahead of the reply.
            await instance.host.probe.emitProbeEvent("seen", 3).request();
            expect(received).to.deep.equal([["seen", 3]]);
        }
    );
}
