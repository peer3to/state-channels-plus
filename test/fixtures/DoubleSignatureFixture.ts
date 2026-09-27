// @spec-test-coverage-ignore: shared fixture builds real signatures and block copies; executable evidence belongs to its calling test declarations
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import type { TestPeer } from "@test/harness/core/types";
import { expect } from "chai";

/**
 * The peer's latest stored block, and a copy of its confirmation that carries
 * `signatures` instead of the stored ones, ready for the wire.
 */
export async function latestBlockCopy(
    peer: TestPeer,
    signaturesFor: (blockHash: string) => string[]
) {
    const h = MathTestSession.getHarness();
    const block = await h
        .control(peer)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    expect(block, `peer ${peer.index} stored no block`).to.not.equal(null);
    const { signedBlock } = Codec.decode(
        block!.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const signatures = signaturesFor(block!.hash);
    return {
        hash: block!.hash,
        signedBlock,
        signatures,
        encodedBlockConfirmation: String(
            Codec.encode({ signedBlock, signatures }, Type.BlockConfirmation)
        )
    };
}
