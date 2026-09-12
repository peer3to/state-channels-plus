// @spec-test-coverage-ignore: real pre-deployment runtime fixture
import { startP2pRuntimeHost } from "@/evm/p2pRuntime/P2pRuntimeHost";
import type { P2pRuntimeHostRoot } from "@/evm/p2pRuntime/rpc/P2pRuntimeHostRoot";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import { RpcRouter } from "@/rpc/RpcRouter";
import MessagePortTransport from "@/transport/MessagePortTransport";
import { config } from "@/utils/config";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

/** the host's services as a client before the runtime graph exists */
export type PreDeploymentHost = RemoteRpcServices<P2pRuntimeHostRoot>;

/** a nothing port: no listener accepts a websocket here */
const UNREACHABLE_PROVIDER_URL = "ws://127.0.0.1:1";

type Staging = {
    host: PreDeploymentHost;
    /** the host's own wallet address, once its chain context built it */
    signerAddress: string;
    start: () => Promise<void>;
    close: () => void;
};

/** the client end of a real runtime port, and the host start it is waiting on */
async function stageHost(providerUrl?: string): Promise<Staging> {
    const h = TestSession.getHarness();
    await h.setup(2, { autoConnect: false });
    const channel = createRuntimeChannel();
    const signer = ethers.Wallet.createRandom();
    const clientRouter = new RpcRouter<
        Record<string, never>,
        P2pRuntimeHostRoot
    >(() => ({}), undefined);
    new MessagePortTransport(channel.port1, clientRouter);
    const scm = {
        address: await h.channelManager.getAddress(),
        abiJson: h.channelManager.interface.formatJson()
    };
    const stateMachine = {
        address: await h.getPeer(0).contractInstance.getAddress(),
        abiJson: h.getPeer(0).contractInstance.interface.formatJson()
    };
    return {
        host: clientRouter.remoteRpc,
        signerAddress: signer.address,
        start: () =>
            startP2pRuntimeHost(
                channel.port2,
                {
                    config: {
                        ...config,
                        VM_DEDICATED_THREAD: false,
                        ...(providerUrl ? { PROVIDER_URL: providerUrl } : {})
                    },
                    scm,
                    stateMachine,
                    signerSecret: signer.privateKey
                },
                { threadLabel: "pre-deployment-readiness" }
            ),
        close: () => {
            channel.port1.close();
            channel.port2.close();
        }
    };
}

/** the message an endpoint refused with, or "" when it answered */
async function refusal(invoke: () => Promise<unknown>): Promise<string> {
    try {
        await invoke();
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * Start a real host, stop before `deployComplete`, and invoke one endpoint.
 * Everything that needs the runtime graph refuses with "Runtime is not ready"
 * and names the piece it wanted.
 */
export async function checkPreDeploymentRequest(
    invoke: (host: PreDeploymentHost) => Promise<unknown>,
    expectedSubject: string
): Promise<void> {
    const staged = await stageHost();
    try {
        await staged.start();
        expect(await refusal(() => invoke(staged.host))).to.equal(
            `Runtime is not ready: ${expectedSubject}`
        );
        await staged.host.lifecycle.dispose().request({ timeoutMs: null });
    } finally {
        staged.close();
    }
}

/** the deploy signer answers before deployment: deploying is what it is for */
export async function checkPreDeploymentAddressRead(): Promise<void> {
    const staged = await stageHost();
    try {
        await staged.start();
        expect(await staged.host.deploySigner.getAddress().request()).to.equal(
            staged.signerAddress
        );
        await staged.host.lifecycle.dispose().request({ timeoutMs: null });
    } finally {
        staged.close();
    }
}

/**
 * The read is on the line before the host exists, so it can only be answered
 * by the gate the deploy signer waits on: it resolves with the address the
 * chain context built.
 */
export async function checkDeployReadDuringStartup(): Promise<void> {
    const staged = await stageHost();
    try {
        const read = staged.host.deploySigner
            .getAddress()
            .request({ timeoutMs: null });
        await staged.start();
        expect(await read).to.equal(staged.signerAddress);
        await staged.host.lifecycle.dispose().request({ timeoutMs: null });
    } finally {
        staged.close();
    }
}

/**
 * The same parked read against a host whose chain context never comes up: it
 * fails with the startup cause, not with the line closing under it.
 */
export async function checkDeployReadAgainstFailedStartup(): Promise<void> {
    const staged = await stageHost(UNREACHABLE_PROVIDER_URL);
    try {
        const read = staged.host.deploySigner
            .getAddress()
            .request({ timeoutMs: null });
        const startupFailure = await refusal(staged.start);
        expect(startupFailure).to.contain(
            "P2P runtime requires a reachable WebSocket provider"
        );
        expect(await refusal(() => read)).to.equal(startupFailure);
    } finally {
        staged.close();
    }
}
