// @spec-test-coverage-ignore: shared staging of a stored block missing one real participant signature; executable evidence belongs to its calling test declarations
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * A three-peer channel where the writer's stored latest block lacks one
 * participant's valid confirmation signature. No peer runs the
 * participant-timeout check, so staging is not cut short by a timeout
 * dispute. One non-writer's broadcast is suppressed while the writer authors
 * the block; the writer's block is read once the other non-writer's
 * signature merged, and the silenced peer's own signed copy is read before
 * its broadcast is restored. Returns the writer, the block as the writer stored it, the
 * silenced peer's signatures on it and the ones the writer lacks.
 */
export async function stageMissingParticipantSignature(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 1);
    const forkId = h.activeForkId!;
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);

    const writer = await h.query.getNextPeerToWrite();
    const silenced = h.peers.find((peer) => peer.index !== writer.index)!;
    const third = h.peers.find(
        (peer) => peer.index !== writer.index && peer.index !== silenced.index
    )!;
    const height = await h
        .control(writer)
        .query.getNextBlockHeight(forkId)
        .request();
    await h.byzantine.stubBroadcast(silenced.index);
    // add() resolves after the writer's own commit, so the block is stored
    await h.getPeer(writer.index).p2pInstance.p2pContractInstance.add(1);
    const readBundle = async (peer: { index: number }) =>
        (await h
            .control(h.getPeer(peer.index))
            .query.getLatestBlockBundle(forkId)
            .request())!;
    // the third peer's signature reaches the writer as usual; only the
    // silenced one stays missing, so wait for that merge before reading
    // the writer's block
    const committed = await readBundle(writer);
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: third.index,
        blockHash: committed.hash,
        keepConnection: true
    });
    const thirdSignatures = (await readBundle(third)).confirmationSignatures;
    await waitFor(async () => {
        const { confirmationSignatures } = await readBundle(writer);
        return thirdSignatures.every((signature) =>
            confirmationSignatures.includes(signature)
        );
    }, h.event.protocolEventTimeoutMs());
    const writerBundle = await readBundle(writer);
    expect(writerBundle.height).to.equal(height);
    // the silenced peer signed its own copy; the writer never saw it
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: silenced.index,
        blockHash: writerBundle.hash,
        keepConnection: true
    });
    const silencedBundle = (await h
        .control(silenced)
        .query.getLatestBlockBundle(forkId)
        .request())!;
    await h.control(silenced).stub.restoreBroadcast().request();

    expect(silencedBundle.hash).to.equal(writerBundle.hash);
    const missingSignatures = silencedBundle.confirmationSignatures.filter(
        (signature) => !writerBundle.confirmationSignatures.includes(signature)
    );
    expect(
        missingSignatures.length,
        "the silenced signature is missing on the writer"
    ).to.be.greaterThan(0);
    return {
        forkId,
        writer: h.getPeer(writer.index),
        height,
        signedBlock: Codec.decode(
            writerBundle.encodedSignedBlock,
            Type.SignedBlock
        ),
        lateSignatures: silencedBundle.confirmationSignatures.map(String),
        missingSignatures
    };
}
