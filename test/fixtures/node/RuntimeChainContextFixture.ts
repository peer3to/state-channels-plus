// @spec-test-coverage-ignore: real SDK startup and held-response staging; declarations live in RuntimeChainContext.test.ts.
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import { createLoggerSdkFixture } from "./LoggerServiceFixture";
import { startLogReceiver } from "../logging/LogUploader.fixture";
import { setupP2pRuntime } from "@/evm/p2pRuntime/setupP2pRuntime";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
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
        setup.setupOptions.signerSecret!
    );
    const provider = context.provider;
    if (!(provider instanceof WebSocketProvider))
        throw new Error("Expected the runtime socket provider");
    try {
        if (subscribed) {
            const send = provider.send.bind(provider);
            let subscriptionReady: Promise<unknown> | undefined;
            provider.send = (...args) => {
                const pending = send(...args);
                if (args[0] === "eth_subscribe") subscriptionReady = pending;
                return pending;
            };
            await provider.on("block", () => {});
            await subscriptionReady;
            provider.send = send;
        }
        await provider.destroy();
        expect(provider.destroyed).to.equal(true);
        expect(await provider.listenerCount()).to.equal(0);
        await provider.destroy();
        expect(provider.destroyed).to.equal(true);
    } finally {
        await provider.destroy();
        await stopRuntimeTransportModesFixture();
    }
}
