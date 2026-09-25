// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { signatureReencodings } from "./QueueAdmissionFixture";
import { Block, StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

// Odd-length hex: not ABI-encodable as bytes, so only raw paths carry it.
export const NON_HEX_SIGNATURE = "0x123";

/**
 * An unaudited dispute persist stores a milestone confirmation whose values
 * are a genuine signature behind two of its chain-rejected re-encodings. The
 * persisting peer never saw the block, so nothing already held masks them.
 */
export async function assertPersistedMilestoneKeepsGenuineSignature(
    includeUnfinalizedBlocks: boolean
) {
    const h = MathTestSession.getHarness();
    await h.scenario.preDisputeSetupDisconnectedPeer();
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(3);
    const signedBlock = dispute.input.stateProof.signedBlocks[0];
    const block = Block.fromSignedBlock(signedBlock);
    const signer = h.peers.find((peer) => peer.address !== block.author)!;
    const genuine = await signer.signer.signMessage(
        ethers.getBytes(block.hash)
    );
    const { v0, highS } = signatureReencodings(genuine);
    dispute.input.stateProof.milestones = [
        {
            blockConfirmations: [
                { signedBlock, signatures: [v0, highS, genuine] }
            ]
        },
        ...dispute.input.stateProof.milestones
    ];
    expect(
        await h.control(h.getPeer(2)).query.getBlockByHash(block.hash).request()
    ).to.equal(null);

    const persisted = await h.dispute.persistDisputeData(2, dispute, {
        auditingData,
        includeUnfinalizedBlocks
    });

    expect(persisted.threwMessage).to.equal(undefined);
    const stored = await h
        .control(h.getPeer(2))
        .query.getBlockByHash(block.hash)
        .request();
    expect(stored!.confirmationSignatures).to.deep.equal([genuine]);
}

/**
 * A sync payload's finalized block carries a chain-rejected re-encoding in
 * front of the genuine signature it copies, and a value that is not a byte
 * string. The syncing peer stores only genuine signatures and completes.
 */
export async function assertSyncPayloadKeepsGenuineSignatures() {
    const h = MathTestSession.getHarness();
    // Create the syncing peer before genesis; it stays off the channel's wire.
    await h.setup(4);
    const participantIndices = [0, 1, 2];
    const forkId =
        await h.lifecycle.openChannelForParticipants(participantIndices);
    const requester = h.getPeer(3);
    await h.network.blacklistAndDisconnectPeer(requester.index);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: participantIndices,
        waitForFinalization: true
    });
    const responder = h.getPeer(0);
    const latestHeight = await h
        .control(responder)
        .query.getLatestBlockHeight(forkId)
        .request();
    const payload = await h
        .control(responder)
        .spectate.generateSyncPayload(h.channelId, forkId, latestHeight!)
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    expect(payload, "sync payload").to.not.equal(null);
    const decoded = Codec.decode(payload!.encodedSyncPayload, Type.SyncPayload);
    const confirmation = decoded.stateProof.milestones[0].blockConfirmations[0];
    const genuineSignatures = confirmation.signatures.map(String);
    expect(genuineSignatures).to.not.have.lengthOf(0);
    const { v35 } = signatureReencodings(genuineSignatures[0]);

    const result = await h
        .control(requester)
        .spectate.persistSyncPayload(payload!.encodedSyncPayload, [
            v35,
            NON_HEX_SIGNATURE
        ])
        .request();

    expect(result.shouldAbort).to.equal(false);
    const block = Block.fromBlockConfirmation(confirmation);
    const stored = await h
        .control(requester)
        .query.getBlockByHash(block.hash)
        .request();
    expect(stored!.confirmationSignatures).to.have.members(genuineSignatures);
    expect(stored!.confirmationSignatures).to.have.lengthOf(
        genuineSignatures.length
    );
    // The whole payload was applied, up to the latest finalized state.
    const latestSnapshot =
        decoded.milestoneSnapshots.at(-1) ?? decoded.latestForkGenesisSnapshot;
    expect(
        await h
            .control(requester)
            .query.getLatestStateMachineStateHash(forkId)
            .request()
    ).to.equal(StateSnapshot.from(latestSnapshot).stateMachineStateHash);
}

/**
 * A copy of a block nobody else stores yet carries a value that is not a
 * byte string next to its supplier's genuine signature. The receiver commits
 * the block with the genuine signature and cuts the supplier.
 */
export async function assertNonHexNewBlockCopyKeepsGenuineSignature() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 0, { maxChannelParticipants: 3 });
    const { leader, observer, authored } =
        await h.transition.authorNextBlockOffWireWait();
    await h.control(leader).stub.restoreBroadcast().request();
    const source = h.peers.find(
        (peer) => peer.index !== leader.index && peer.index !== observer.index
    )!;
    const genuine = await source.signer.signMessage(
        ethers.getBytes(authored.hash)
    );

    await h
        .control(source)
        .byzantine.sendRawBlockConfirmation(
            authored.encodedSignedBlock,
            [NON_HEX_SIGNATURE, genuine],
            observer.address
        )
        .request();
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: observer.index,
        blockHash: authored.hash
    });

    const stored = await h
        .control(observer)
        .query.getBlockByHash(authored.hash)
        .request();
    expect(stored!.confirmationSignatures).to.include(genuine);
    expect(stored!.confirmationSignatures).to.not.include(NON_HEX_SIGNATURE);
    expect(
        await h.control(observer).query.isBlacklisted(source.address).request()
    ).to.equal(true);
}
