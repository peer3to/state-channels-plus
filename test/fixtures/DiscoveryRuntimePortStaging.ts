// @spec-test-coverage-ignore: reusable runtime input-validation staging
import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";
export const setup = async () => {
    const h = TestSession.getHarness();
    await h.setup(2, { autoConnect: false });
    return { h, signer: h.peers[0].p2pInstance.p2pSigner };
};

export const assertClean = async (
    h: ReturnType<typeof TestSession.getHarness>
) => {
    expect(await h.control(h.peers[0]).query.getChannelId().request()).to.equal(
        ethers.ZeroHash
    );
    expect(await h.control(h.peers[0]).query.getStatus().request()).to.equal(
        Status.NOT_OPENED
    );
};

/**
 * Both peers join `topic` with their matched negotiations parked at the
 * handoff; `leave` runs on each peer's signer there; the negotiations then
 * fail unsigned. A recorded leave ends both joins with no rematch and no
 * channel.
 */
export const expectLeftHandoffEndsJoins = async (
    h: ReturnType<typeof TestSession.getHarness>,
    topic: string,
    leave: (
        signer: (typeof h.peers)[number]["p2pInstance"]["p2pSigner"]
    ) => Promise<void>
) => {
    const indices = h.peers.map((_, index) => index);
    const releases = await Promise.all(
        indices.map((index) => h.rpcStub.holdMatchedNegotiation(index, true))
    );
    try {
        const joins = h.peers.map((peer) =>
            peer.p2pInstance.p2pSigner.joinLobby(topic)
        );
        await h.rpcStub.waitForHeldMatchedNegotiation(indices);
        for (const peer of h.peers) await leave(peer.p2pInstance.p2pSigner);
        await Promise.all(releases.map((release) => release()));
        expect(await Promise.all(joins)).to.deep.equal([undefined, undefined]);
        for (const peer of h.peers) {
            const control = h.control(peer);
            expect(await control.query.getChannelId().request()).to.equal(
                ethers.ZeroHash
            );
            expect(await control.query.getStatus().request()).to.equal(
                Status.NOT_OPENED
            );
            const availability = await control.query
                .getLobbyAvailability()
                .request();
            expect(availability.topic).to.equal(undefined);
            expect(availability.matching).to.equal(false);
        }
    } finally {
        await Promise.all(releases.map((release) => release()));
    }
};
