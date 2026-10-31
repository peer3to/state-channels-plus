// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    HELD_BUILD_CHANNEL,
    type HeldBuildHostRoot,
    type HeldBuildMessage
} from "./hostRoot/HeldBuildHostRoot";
import { setupObservedP2pRuntime } from "./node/ObservedP2pSetup";
import { RpcNodeProxy } from "./node/RpcNodeProxy";
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "./RuntimeTransportModesFixture";
import { EvmStateMachine } from "@/evm";
import type { P2pSetupOptions } from "@/evm/p2pRuntime/setupP2pRuntime";
import { IN_FLIGHT_REPLY_DRAIN_MS } from "@/rpc/internal/AInternalRpcRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type { HostRootManifest } from "@/rpc/internal/roots/resolveHostRootManifest";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
import path from "node:path";

type RuntimeSetup = Awaited<ReturnType<typeof prepareRuntimeSetup>>;

const HELD_BUILD_HOST_ROOT: HostRootManifest<HeldBuildHostRoot> = {
    module: path.resolve(__dirname, "hostRoot/HeldBuildHostRoot.ts"),
    exportName: "HeldBuildHostRoot"
};

/**
 * Runs the public setup with `options` and hands back its client root as
 * soon as it exists, the host errors it raises, and the setup's outcome.
 */
function startSetup<THost extends P2pRuntimeHostRoot>(
    setup: RuntimeSetup,
    options: P2pSetupOptions<THost>
) {
    const started: {
        client?: P2pRuntimeClientRoot;
        hostErrors: Error[];
        outcome?: Promise<unknown>;
    } = { hostErrors: [] };
    started.outcome = setupObservedP2pRuntime(
        setup.scm,
        setup.deployedStateMachine,
        setup.deployStateMachine,
        options,
        {
            onRuntimeRoot: (root) => {
                if (!(root instanceof P2pRuntimeClientRoot)) return;
                started.client = root;
                root.onHostError((error) => started.hostErrors.push(error));
            }
        }
    ).then(
        // never expected: the setup's own instance is disposed anyway
        (instance) => instance.dispose(),
        (error: unknown) => error
    );
    return started;
}

/** The runtime signer's nonce on the chain. */
async function chainNonce(setup: RuntimeSetup): Promise<number> {
    const signer = new ethers.Wallet(setup.setupOptions.signerSecret!);
    return setup.scm.runner!.provider!.getTransactionCount(signer.address);
}

/** A fresh runtime for the same signer sets up and answers. */
async function assertFreshRuntimeWorks(setup: RuntimeSetup): Promise<void> {
    const instance = await EvmStateMachine.p2pSetup(
        setup.scm,
        setup.deployedStateMachine,
        setup.deployStateMachine,
        setup.setupOptions
    );
    try {
        const signer = new ethers.Wallet(setup.setupOptions.signerSecret!);
        expect(await instance.p2pSigner.getAddress()).to.equal(signer.address);
    } finally {
        await instance.dispose();
    }
}

/**
 * The client disposes while the host's start is held at its chain reads (a
 * proxy in front of the node holds every `eth_call`), and the reads are
 * released after the disposal began: the disposal settles within the reply
 * drain bound of the release, the setup rejects, no host error is raised,
 * the signer sent nothing, and a fresh runtime for the signer works.
 */
export async function assertDisposalDuringChainReads(
    runSdkInThread: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    const setup = await prepareRuntimeSetup({
        runSdkInThread,
        vmDedicatedThread: false
    });
    const proxy = await RpcNodeProxy.start(
        String(setup.setupOptions.config!.PROVIDER_URL)
    );
    try {
        const nonce = await chainNonce(setup);
        const releaseReads = proxy.holdRequests("eth_call");
        const started = startSetup(setup, {
            ...setup.setupOptions,
            config: { ...setup.setupOptions.config, PROVIDER_URL: proxy.url }
        });
        await waitFor(() => proxy.forwardedMethods.includes("eth_call"));
        const client = started.client!;
        const disposal = client.dispose();
        // a worker host's port is closed while it still reads; an inline
        // host is disposed once its start returns
        if (runSdkInThread) await waitFor(() => client.children.size === 0);
        const releasedAt = Date.now();
        releaseReads();
        await disposal;
        expect(Date.now() - releasedAt).to.be.below(IN_FLIGHT_REPLY_DRAIN_MS);
        expect(await started.outcome).to.be.instanceOf(Error);
        expect(started.hostErrors.map((error) => error.message)).to.deep.equal(
            []
        );
        expect(await chainNonce(setup)).to.equal(nonce);
        await assertFreshRuntimeWorks(setup);
    } finally {
        await proxy.close();
        stopRuntimeTransportModesFixture();
    }
}

/**
 * The client disposes while the host's runtime build is held before the
 * runtime is constructed ({@link HeldBuildHostRoot}). The disposal settles
 * within the reply drain bound while the build is held; once released, the
 * build constructs a runtime that it cuts and stops itself, and the setup
 * rejects. A worker host lets the build through at its own cut (its thread
 * ends with the disposal); the test releases an inline host after the
 * disposal settled. No host error is raised, the signer sent nothing, and a
 * fresh runtime for the signer works.
 */
export async function assertDisposalDuringBuild(
    runSdkInThread: boolean
): Promise<void> {
    await startRuntimeTransportModesFixture();
    const setup = await prepareRuntimeSetup({
        runSdkInThread,
        vmDedicatedThread: false
    });
    const messages: HeldBuildMessage[] = [];
    const channel = new BroadcastChannel(HELD_BUILD_CHANNEL);
    channel.onmessage = (event: MessageEvent<HeldBuildMessage>) =>
        messages.push(event.data);
    const received = (type: HeldBuildMessage["type"]) =>
        messages.find((message) => message.type === type);
    try {
        const nonce = await chainNonce(setup);
        const started = startSetup(setup, {
            ...setup.setupOptions,
            hostRootManifest: HELD_BUILD_HOST_ROOT
        });
        await waitFor(() => received("held") !== undefined);
        const disposedAt = Date.now();
        const disposal = started.client!.dispose();
        await disposal;
        expect(Date.now() - disposedAt).to.be.below(IN_FLIGHT_REPLY_DRAIN_MS);
        if (!runSdkInThread) channel.postMessage({ type: "release" });
        await waitFor(() => received("built") !== undefined);
        expect(received("built")).to.deep.equal({
            type: "built",
            isCut: true,
            isStopped: true
        });
        expect(await started.outcome).to.be.instanceOf(Error);
        expect(started.hostErrors.map((error) => error.message)).to.deep.equal(
            []
        );
        expect(await chainNonce(setup)).to.equal(nonce);
        await assertFreshRuntimeWorks(setup);
    } finally {
        channel.close();
        stopRuntimeTransportModesFixture();
    }
}
