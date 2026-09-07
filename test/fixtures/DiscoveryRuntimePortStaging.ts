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
