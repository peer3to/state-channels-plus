// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { waitFor } from "../../utils/waitFor";
import { P2PManagerFixture } from "../P2PManagerFixture";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertPeerRpcRecovery(): Promise<void> {
    const fixture = new P2PManagerFixture();
    const token = ethers.id("real held peer request");
    try {
        await fixture.setup({ peerCount: 3, openChannel: true });
        const harness = fixture.getHarness();
        await harness.network.connectAllPeers();
        await harness.network.waitForP2PConnections();
        const first = harness.getPeer(0).p2pInstance.hostRpc;
        const second = harness.getPeer(1).p2pInstance.hostRpc;
        const foreign = harness.getPeer(2).p2pInstance.hostRpc;
        const foreignAddress = fixture.address(2);
        const pending = first.p2pManagerProbe
            .holdNetworkReply(token)
            .request(fixture.address(1))
            .then(
                () => "unexpected success",
                (error: Error) => error.message
            );
        try {
            await waitFor(
                async () =>
                    (
                        await second.p2pManagerProbe
                            .networkReplyState(token, foreignAddress)
                            .request()
                    ).held
            );
            const state = await first.p2pManagerProbe
                .networkReplyState(token, foreignAddress)
                .request();
            expect(state.requestId !== undefined).to.equal(true);
            foreign.p2pManagerProbe
                .sendNetworkReply(fixture.address(0), state.requestId!)
                .sendOne();
            await waitFor(
                async () =>
                    (
                        await first.p2pManagerProbe
                            .networkReplyState(token, foreignAddress)
                            .request()
                    ).foreignBlacklisted
            );
            expect(
                (
                    await first.p2pManagerProbe
                        .networkReplyState(token, foreignAddress)
                        .request()
                ).requestId
            ).to.equal(state.requestId);
            expect(
                await first.network
                    .closePeerTransportByAddress(fixture.address(1))
                    .request()
            ).to.equal(true);
            expect(await pending).to.equal(
                "Peer disconnected before RPC response arrived"
            );
            expect(
                (
                    await first.p2pManagerProbe
                        .networkReplyState(token, foreignAddress)
                        .request()
                ).requestId
            ).to.equal(undefined);
            await second.p2pManagerProbe.releaseNetworkReply(token).request();
            await harness.network.reconnectPeers([0, 1]);
            await waitFor(
                async () =>
                    await first.query
                        .isConnectedTo(fixture.address(1))
                        .request()
            );
            const result = await first.pingService
                .sum(4, 7, token)
                .request(fixture.address(1));
            expect(result.sum).to.equal(11);
            expect(result.nonce).to.equal(token);
            expect(result.requester).to.equal(fixture.address(0));
        } finally {
            await second.p2pManagerProbe.releaseNetworkReply(token).request();
            await pending;
        }
    } finally {
        await fixture.cleanup();
    }
}
