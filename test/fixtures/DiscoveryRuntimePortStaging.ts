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

/** The runtime owns no channel: the state a fresh runtime starts in and a reset returns to. */
export const assertClean = async (
    h: ReturnType<typeof TestSession.getHarness>,
    peer = h.peers[0]
) => {
    expect({
        channelId: await h.control(peer).query.getChannelId().request(),
        status: await h.control(peer).query.getStatus().request()
    }).to.deep.equal({
        channelId: ethers.ZeroHash,
        status: Status.NOT_OPENED
    });
};
