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

/**
 * Start a real host, stop before `deployComplete`, and invoke one endpoint.
 * Everything that needs the runtime graph refuses with "Runtime is not ready";
 * the deploy signer answers, because deployment is what it exists for.
 */
export async function checkPreDeploymentRequest(
    invoke: (host: PreDeploymentHost) => Promise<unknown>,
    succeeds = false
): Promise<void> {
    const h = TestSession.getHarness();
    await h.setup(2, { autoConnect: false });
    const channel = createRuntimeChannel();
    const signer = ethers.Wallet.createRandom();
    const clientRouter = new RpcRouter<
        Record<string, never>,
        P2pRuntimeHostRoot
    >(() => ({}), undefined);
    new MessagePortTransport(channel.port1, clientRouter);
    const host = clientRouter.remoteRpc;
    try {
        await startP2pRuntimeHost(
            channel.port2,
            {
                config: { ...config, VM_DEDICATED_THREAD: false },
                scm: {
                    address: await h.channelManager.getAddress(),
                    abiJson: h.channelManager.interface.formatJson()
                },
                stateMachine: {
                    address: await h.getPeer(0).contractInstance.getAddress(),
                    abiJson: h
                        .getPeer(0)
                        .contractInstance.interface.formatJson()
                },
                signerSecret: signer.privateKey
            },
            { threadLabel: "pre-deployment-readiness" }
        );
        if (succeeds) {
            expect(await invoke(host)).to.equal(signer.address);
        } else {
            let message = "";
            try {
                await invoke(host);
            } catch (error) {
                message =
                    error instanceof Error ? error.message : String(error);
            }
            expect(message).to.contain("Runtime is not ready");
        }
        await host.lifecycle.dispose().request({ timeoutMs: null });
    } finally {
        channel.port1.close();
        channel.port2.close();
    }
}
