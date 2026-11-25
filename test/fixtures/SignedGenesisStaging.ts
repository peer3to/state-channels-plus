// @spec-test-coverage-ignore: shared staging; executable evidence belongs to its calling test declarations
import { compareAddresses } from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type MathPeerTestHarness from "@test/fixtures/MathPeerTestHarness";
import { expect } from "chai";
import { ethers } from "ethers";

/**
 * Two runtimes negotiate through the lobby while the one in `role` swallows
 * its genesis join log, so neither its inbound store nor its local diamond
 * holds the genesis join block: it must install the genesis it signed,
 * checked against the chain's hash.
 */
export async function assertSignedGenesisInstalledWithoutJoinBlock(
    h: MathPeerTestHarness,
    role: "lower" | "higher"
): Promise<void> {
    await h.setup(2, { autoConnect: false });
    const zeroIsLower =
        compareAddresses(h.getPeer(0).address, h.getPeer(1).address) < 0;
    const stale = (role === "lower") === zeroIsLower ? 0 : 1;
    const held = await h.rpcStub.holdInboundMessageEvents(stale);
    const topic = ethers.id(`channel-opened-stale-mirror-${role}`);

    const [opened, otherOpened] = await Promise.all(
        h.peers.map((peer) => peer.p2pInstance.p2pSigner.joinLobby(topic))
    );

    expect(otherOpened!.channelId).to.equal(opened!.channelId);
    const snapshot = await h.channelManager.getStateSnapshot(opened!.channelId);
    const ctl = h.control(h.getPeer(stale));
    // premise - the stale peer never stored the genesis join block
    expect(
        await ctl.query
            .getInboundMessageBlock(
                snapshot.snapshotData.latestInboundMessageBlockHash
            )
            .request()
    ).to.equal(null);
    expect(await ctl.query.getForkId().request()).to.equal(snapshot.forkId);
    expect(await ctl.query.getLiveStateMachineStateHash().request()).to.equal(
        snapshot.snapshotData.stateMachineStateHash
    );
    expect(h.event.getEventCallCount(stale, "onAbort")).to.equal(0);
    await held.release({ replay: false });
}
