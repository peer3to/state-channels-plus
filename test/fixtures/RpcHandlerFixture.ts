// @spec-test-coverage-ignore: support fixture for the mapped RpcHandler integration cases; it is not an evidence unit

import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import path from "node:path";

const PING_PONG_MANIFEST = path.resolve(
    __dirname,
    "customRpc/PingPongRpcManifest.ts"
);

export class RpcHandlerFixture {
    public harness: PeerTestHarness<PingPongRpc, MathStateMachine>;

    constructor() {
        this.harness = new PeerTestHarness<PingPongRpc, MathStateMachine>({
            deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
        });
    }

    public async setup(numPeers: number): Promise<void> {
        await this.harness.setup(numPeers, {
            autoConnect: false,
            customRpcManifest: { module: PING_PONG_MANIFEST }
        });
        await this.harness.lifecycle.openChannel();
        await this.harness.network.connectPeers(
            Array.from({ length: numPeers }, (_, index) => index)
        );
        await this.harness.network.waitForP2PConnections();
    }

    public control(peerIndex: number): RemoteRpcProxyType<PingPongRpc> {
        return this.harness.control(
            this.harness.getPeer(peerIndex)
        ) as unknown as RemoteRpcProxyType<PingPongRpc>;
    }

    public address(peerIndex: number) {
        return this.harness.getPeer(peerIndex).address;
    }

    public async receivedPingNonces(peerIndex: number): Promise<string[]> {
        return this.control(peerIndex)
            .pingService.getReceivedPingNonces()
            .request();
    }

    public async waitForPingCount(
        peerIndex: number,
        nonce: string,
        count: number
    ): Promise<void> {
        await waitFor(async () => {
            const nonces = await this.receivedPingNonces(peerIndex);
            return nonces.filter((value) => value === nonce).length === count;
        }, this.harness.event.protocolEventTimeoutMs());
    }

    public async cleanup(): Promise<void> {
        await this.harness.cleanup();
    }
}
