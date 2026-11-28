// @spec-test-coverage-ignore: proven-submission-failure staging for mapped runtime cases
import { MathTestSession as TestSession } from "@test/harness";
import { ethers } from "ethers";

/** A founder's own channel manager and chain signer on the test chain. */
export async function founderSubmitter() {
    const h = TestSession.getHarness();
    await h.lifecycle.start(2, 0);
    const founder = h.getPeer(0);
    return {
        manager: founder.p2pInstance.stateChannelManagerContract,
        signer: founder.p2pInstance.chainSigner
    };
}

export async function maxTimestamp(signer: ethers.Signer): Promise<number> {
    return (await signer.provider!.getBlock("latest"))!.timestamp + 100;
}
