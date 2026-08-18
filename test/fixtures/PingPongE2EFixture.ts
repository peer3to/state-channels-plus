// @spec-test-coverage-ignore: shared setup for direct custom-RPC E2E cases
import path from "node:path";

import { MathStateMachine } from "@typechain-types";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import type { TestPeer } from "@test/harness/core/types";

export class PingPongE2EFixture {
    public readonly harness = new PeerTestHarness<
        PingPongRpc,
        MathStateMachine
    >({
        deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
    });

    public async setup(peerCount: number): Promise<void> {
        await this.harness.setup(peerCount, {
            autoConnect: false,
            customRpcManifest: {
                module: path.resolve(
                    __dirname,
                    "customRpc/PingPongRpcManifest.ts"
                )
            },
            timeConfig: {
                agreementTime: 10,
                p2pTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 2
            }
        });
        await this.harness.lifecycle.openChannel();
        await this.harness.rpc.connectPeers(
            this.harness.peers.map((peer) => peer.index)
        );
        await this.harness.network.waitForP2PConnections();
    }

    public async cleanup(): Promise<void> {
        await this.harness.cleanup();
    }

    public control(
        peer: TestPeer<PingPongRpc, MathStateMachine>
    ): RemoteRpcProxyType<PingPongRpc> {
        return this.harness.control(peer) as RemoteRpcProxyType<PingPongRpc>;
    }
}
