// @spec-test-coverage-ignore: real pre-deployment runtime fixture
import { startP2pRuntimeHost } from "@/evm/p2pRuntime/P2pRuntimeHost";
import type {
    RuntimeClientRequest,
    RuntimeHostMessage
} from "@/evm/p2pRuntime/types";
import type { RuntimeRequestInput } from "@/evm/p2pRuntime/worker/protocol";
import { config } from "@/utils/config";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

export async function checkPreDeploymentRequest(
    request: RuntimeRequestInput,
    succeeds = false
): Promise<void> {
    const h = TestSession.getHarness();
    await h.setup(2, { autoConnect: false });
    const channel = createRuntimeChannel();
    const signer = ethers.Wallet.createRandom();
    // Request IDs map to the callback waiting for that host response.
    const responses = new Map<number, (message: RuntimeHostMessage) => void>();
    channel.port1.onMessage((raw) => {
        const message = raw as RuntimeHostMessage;
        if (message.type === "response")
            responses.get(message.requestId)?.(message);
    });
    channel.port1.start();
    const send = (input: RuntimeRequestInput, requestId: number) =>
        new Promise<RuntimeHostMessage>((resolve) => {
            responses.set(requestId, resolve);
            channel.port1.post({ ...input, requestId } as RuntimeClientRequest);
        });
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
        const response = await send(request, 701);
        expect(response.type).to.equal("response");
        if (response.type !== "response") throw new Error("Expected response");
        expect(response.requestId).to.equal(701);
        expect(response.ok).to.equal(succeeds);
        if (response.ok) {
            expect(response.result).to.equal(signer.address);
        } else {
            expect(response.error.message).to.equal("Runtime is not ready");
        }
        await send({ type: "dispose" }, 702);
    } finally {
        channel.port1.close();
        channel.port2.close();
    }
}
