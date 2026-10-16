// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import { EvmStateMachine } from "@/evm";
import type P2pInstance from "@/evm/P2pInstance";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import { childDisposedError } from "@/rpc/internal/RemoteRoot";
import type { HostRootManifest } from "@/rpc/internal/roots/resolveHostRootManifest";
import type { ProbeSlowReply } from "@test/fixtures/hostRoot/probe/HostProbeService";
import type { ProbeHostRoot } from "@test/fixtures/hostRoot/ProbeHostRoot";
import {
    PROBE_HOST_ROOT_MODULE,
    nonClassHostRootManifest,
    probeHostRootManifest,
    probeRpcManifest
} from "@test/fixtures/hostRoot/ProbeHostRootManifest";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";

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
    run: (instance: ProbeInstance) => Promise<void>
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
        await run(instance);
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
 * A request still running when the root's disposal reaches its in-flight
 * reply drain is awaited by that drain and replies; a request sent after
 * disposal rejects without reaching the runtime.
 */
export async function assertDisposalDrainsThenRejects(
    runSdkInThread: boolean
): Promise<void> {
    let host: RuntimeConnection<ProbeHostRoot> | undefined;
    let inFlight: Promise<ProbeSlowReply> | undefined;
    await withRuntime(
        runSdkInThread,
        probeHostRootManifest(),
        async (instance) => {
            host = instance.host;
            inFlight = instance.host.probe.slow("drained").request();
            await instance.dispose();
        }
    );
    expect(await inFlight).to.deep.equal({
        value: "drained",
        isDrainHolding: true
    });
    const failure = await rejectionOf(host!.probe.echo("late").request());
    expect(failure.message).to.equal(childDisposedError().message);
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
