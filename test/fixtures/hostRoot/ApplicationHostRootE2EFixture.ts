// @spec-test-coverage-ignore: shared real-peer staging for E2E-ApplicationHostRoot
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import type { RawRequestOutcome } from "@test/fixtures/customRpc/harnessControl/services/byzantine/ByzantineService";
import type { ProbeHostRoot } from "@test/fixtures/hostRoot/ProbeHostRoot";
import {
    probeHostRootManifest,
    probeRpcManifest
} from "@test/fixtures/hostRoot/ProbeHostRootManifest";
import type { ProbeRpc } from "@test/fixtures/hostRoot/ProbeRpc";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";

type Peer = TestPeer<ProbeRpc, MathStateMachine>;

/** How a pending request settles when its transport closes (P2PManager.closeConnection). */
export const PEER_DISCONNECTED_ERROR =
    "Peer disconnected before RPC response arrived";

/** Connected peers that all run the probe application's two roots. */
export class ApplicationHostRootE2EFixture {
    public readonly harness = new PeerTestHarness<ProbeRpc, MathStateMachine>({
        deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
    });

    public async setup(peerCount: number): Promise<void> {
        await this.harness.setup(peerCount, {
            autoConnect: false,
            customRpcManifest: probeRpcManifest(),
            hostRootManifest: probeHostRootManifest()
        });
        await this.harness.lifecycle.openChannel();
        await this.harness.network.connectPeers(
            this.harness.peers.map((peer) => peer.index)
        );
        await this.harness.network.waitForP2PConnections();
    }

    public async cleanup(): Promise<void> {
        await this.harness.cleanup();
    }

    /** The peer's host connection, typed by the root its manifest named. */
    public host(peer: Peer): RuntimeConnection<ProbeHostRoot> {
        return peer.p2pInstance.host as RuntimeConnection<ProbeHostRoot>;
    }

    /** How `from`'s network request to `to`'s `probe.echo` settled. */
    public networkProbeEchoOutcome(
        from: Peer,
        to: Peer,
        value: string
    ): Promise<RawRequestOutcome> {
        return this.harness
            .control(from)
            .byzantine.requestRawRpc(to.address, "probe", "echo", [value])
            .request();
    }

    /** `receiver` blacklisted `caller` and the two are no longer connected. */
    public async expectDisconnected(
        receiver: Peer,
        caller: Peer
    ): Promise<void> {
        await waitFor(
            async () =>
                (await this.harness
                    .control(receiver)
                    .query.isBlacklisted(caller.address)
                    .request()) &&
                !(await this.harness
                    .control(receiver)
                    .query.isConnectedTo(caller.address)
                    .request()),
            this.harness.event.protocolEventTimeoutMs()
        );
    }
}
