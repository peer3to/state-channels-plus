// @spec-test-coverage-ignore: signer-admission staging shared by mapped ingest, merge and e2e tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { BlockHeight, ForkId } from "@/types/types";
import { suppressTimeoutChecks } from "@test/fixtures/OlderDisputeStaging";
import {
    decodeConfirmation,
    dropStoredBlock,
    localFinalizedView,
    stageJoinThenLeave
} from "@test/fixtures/ProofOwnerStaging";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";
import { ethers } from "ethers";

/** A join-then-leave channel (`stageJoinThenLeave`) as peer 0 now sees it. */
export type JoinExitStaging = {
    forkId: ForkId;
    joinHeight: number;
    leaveHeight: number;
    joinerIndex: number;
    latestHeight: number;
};

/**
 * Peer `signerIndex` signs the block at `height` as peer `peerIndex` stores
 * it. Returns that stored confirmation, the block hash and the signature.
 */
export async function signStoredBlockAs(
    h: MathPeerTestHarness,
    peerIndex: number,
    height: BlockHeight,
    signerIndex: number
): Promise<{
    confirmation: BlockConfirmationStruct;
    blockHash: string;
    signature: string;
}> {
    const block = await h
        .control(h.getPeer(peerIndex))
        .query.getBlockByHeight(h.activeForkId!, height)
        .request();
    expect(block, `a stored block at height ${height}`).to.not.equal(null);
    return {
        confirmation: decodeConfirmation(block!.encodedBlockConfirmation),
        blockHash: block!.hash,
        signature: await h
            .getPeer(signerIndex)
            .signer.signMessage(ethers.getBytes(block!.hash))
    };
}

/**
 * After `stageJoinThenLeave`, peer 0 has no source eligibility: its event
 * handler still runs the exit's ChannelStorageCleared (which clears it), and
 * its held snapshot event never restores it. Republish what its latest block
 * commit published, so a participant's gossip reaches the merge.
 */
export async function restoreCommitEligibility(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<void> {
    const published = await h.execOnHost(h.getPeer(peerIndex), (sm) => {
        const latest = sm.storage.blocks.getLatestBlock(sm.forkId);
        if (!latest) return false;
        sm.membershipService.publishOffChainEligibility(
            sm.storage.getParticipantsUnion(
                latest.coordinates,
                latest.stateSnapshotHash
            )
        );
        return true;
    });
    expect(published, "a latest stored block").to.equal(true);
}

/**
 * `stageJoinThenLeave`, then peer 0 holds no final point above the genesis:
 * it lost the joiner's signature on the join block `j` and the blocks `j + 1`
 * and `k`. Its one hop from the genesis spans the join and the exit, and the
 * joiner is in neither the genesis nor the post-exit snapshot.
 */
export async function stageJoinAndExitInOneHop(
    h: MathPeerTestHarness
): Promise<JoinExitStaging> {
    const staging = await stageJoinThenLeave(h);
    const { forkId, joinHeight, leaveHeight, joinerIndex } = staging;
    await h
        .control(h.getPeer(0))
        .stub.stripStoredBlockSignature(
            forkId,
            joinHeight,
            h.getPeer(joinerIndex).address
        )
        .request();
    await dropStoredBlock(h, 0, joinHeight + 1);
    await dropStoredBlock(h, 0, leaveHeight);
    await restoreCommitEligibility(h, 0);
    expect(
        await localFinalizedView(h, 0),
        "peer 0 proves no final point above the genesis"
    ).to.equal(null);
    return staging;
}

/**
 * `stageJoinThenLeave`, then the leaver's departure hop is not final at peer
 * 0: it lost peer 1's signature on the exit block `k` and the block `k + 1`.
 * Its final point is the join block, where the leaver is a participant.
 */
export async function stageDepartureHopNotFinal(
    h: MathPeerTestHarness
): Promise<JoinExitStaging> {
    const staging = await stageJoinThenLeave(h);
    const { forkId, joinHeight, leaveHeight } = staging;
    await h
        .control(h.getPeer(0))
        .stub.stripStoredBlockSignature(
            forkId,
            leaveHeight,
            h.getPeer(1).address
        )
        .request();
    await dropStoredBlock(h, 0, leaveHeight + 1);
    expect(
        (await localFinalizedView(h, 0))?.height,
        "peer 0's final point is the join block"
    ).to.equal(joinHeight);
    return staging;
}

/**
 * Three peers, every timeout check suppressed. `laggingIndex` holds its
 * InboundMessagesProcessed events (event recovery cannot heal them), then a
 * top-up of peer 0 lands that only the other peers observe. Peer `laggingIndex`
 * is not the next writer, so the next block can carry the top-up.
 */
export async function stageUnobservedInboundTopUp(
    h: MathPeerTestHarness,
    laggingIndex: number
) {
    await h.lifecycle.start(3, 0);
    const allPeers = h.peers.map((peer) => peer.index);
    await suppressTimeoutChecks(h, allPeers);
    const held = await h.rpcStub.holdInboundMessageEvents(laggingIndex);
    for (
        let block = 0;
        block < 3 &&
        (await h.query.getNextPeerToWrite()).index === laggingIndex;
        block++
    )
        await h.transition.advanceState({
            count: 1,
            waitForPeers: allPeers,
            waitForFinalization: false
        });
    expect(
        (await h.query.getNextPeerToWrite()).index,
        "the next writer observes the top-up"
    ).to.not.equal(laggingIndex);
    await h.join.forceInboundJoinWait({
        participant: h.getPeer(0).address,
        observePeerIndices: allPeers.filter((index) => index !== laggingIndex)
    });
    const topUpHash = (await h
        .control(h.getPeer(0))
        .query.getLatestInboundMessageHash()
        .request()) as string;
    return { held, topUpHash };
}
