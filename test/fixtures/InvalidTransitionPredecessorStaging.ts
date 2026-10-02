// @spec-test-coverage-ignore: shared invalid-transition proof staging exercised by mapped E2E declarations

import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import { hash, hexString } from "@test/factory";
import type { MathPeerTestHarness } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import type { StateChannelManagerInterface } from "@typechain-types";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { expect } from "chai";

/** Peers 0..2 author blocks 0 and 1 of a live channel. */
async function startChannelWithTwoBlocks(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 2);
    return h.activeForkId!;
}

/**
 * Invalid-transition proof against the honest signed block at `height`, built
 * from peer 0's stored data: the real predecessor block, the snapshot it
 * commits to (the genesis snapshot at height 0) and that snapshot's state.
 * `forged` moves the snapshot to another fork and swaps in a made-up state, so
 * nothing links it to the block.
 */
async function invalidTransitionProof(
    h: MathPeerTestHarness,
    height: number,
    forged: boolean
) {
    const forkId = h.activeForkId!;
    const observer = h.control(h.getPeer(0));
    const bundle = await observer.query
        .getBlockByHeight(forkId, height)
        .request();
    expect(bundle, `block ${height} stored`).to.not.equal(null);
    const previous =
        height === 0
            ? null
            : await observer.query
                  .getBlockByHeight(forkId, height - 1)
                  .request();
    const previousSnapshotHash = previous
        ? (previous.stateSnapshotHash as Hash)
        : await observer.query.getGenesisSnapshotHash(forkId).request();
    const stored = await observer.query
        .getStateSnapshotStructByHash(previousSnapshotHash!)
        .request();
    expect(
        stored,
        `predecessor snapshot of block ${height} stored`
    ).to.not.equal(null);
    const previousSnapshot = Codec.decode(
        stored!.encodedSnapshot,
        Type.StateSnapshot
    );
    const previousState = await observer.query
        .getStateMachineState(
            previousSnapshot.snapshotData.stateMachineStateHash as Hash
        )
        .request();
    expect(
        previousState,
        `predecessor state of block ${height} stored`
    ).to.not.equal(null);
    if (forged) previousSnapshot.forkId = hash();

    return {
        author: bundle!.author,
        fraudProof: {
            proofType: toSolidityFraudProofType(
                FraudProofType.BlockInvalidStateTransition
            ),
            participant: bundle!.author,
            encodedProof: Codec.encode(
                {
                    invalidBlock: Codec.decode(
                        bundle!.encodedSignedBlock,
                        Type.SignedBlock
                    ),
                    previousBlock: previous
                        ? Codec.decode(
                              previous.encodedSignedBlock,
                              Type.SignedBlock
                          )
                        : { encodedBlock: "0x", signature: "0x" },
                    previousBlockStateSnapshot: previousSnapshot,
                    previousStateStateMachineState: forged
                        ? hexString(64)
                        : previousState!
                },
                FraudProofType.BlockInvalidStateTransition
            )
        }
    };
}

async function applyFraudProof(
    h: MathPeerTestHarness,
    submitter: StateChannelManagerInterface,
    fraudProof: FraudProofStruct
) {
    const tx = await submitter.applyFraudProofs([fraudProof], {
        channelId: h.channelId
    });
    await tx.wait();
}

async function outsiderManager(h: MathPeerTestHarness) {
    return connectStateChannelManager(
        await h.getPeer(0).p2pInstance.stateChannelManagerContract.getAddress(),
        h.signerFor(slotAccountIndex(h.peers.length))
    );
}

/** A participant that did not author `author`'s block submits the proof; only it is slashed. */
async function assertParticipantSubmitterSlashed(
    h: MathPeerTestHarness,
    author: string,
    fraudProof: FraudProofStruct
) {
    const submitter = h.peers.find((peer) => peer.address !== author)!;
    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: submitter.index });
    await applyFraudProof(
        h,
        submitter.p2pInstance.stateChannelManagerContract,
        fraudProof
    );
    await h.assert.dispute.slashedOnChainExactly([submitter.address]);
}

/** An outsider forges both blocks' predecessors; nobody is slashed. */
export async function assertOutsiderUnlinkedSnapshotSlashesNobody(
    h: MathPeerTestHarness
): Promise<void> {
    await startChannelWithTwoBlocks(h);
    const outsider = await outsiderManager(h);
    for (const height of [0, 1]) {
        const { fraudProof } = await invalidTransitionProof(h, height, true);
        await applyFraudProof(h, outsider, fraudProof);
    }
    await h.assert.dispute.slashedOnChainExactly([]);
}

/** A participant forges a later block's predecessor; only the submitter is slashed. */
export async function assertParticipantUnlinkedSnapshotSlashesSubmitter(
    h: MathPeerTestHarness
): Promise<void> {
    await startChannelWithTwoBlocks(h);
    const { author, fraudProof } = await invalidTransitionProof(h, 1, true);
    await assertParticipantSubmitterSlashed(h, author, fraudProof);
}

/**
 * Proofs from the genuine stored predecessors of both honest blocks: an
 * outsider's slash nobody, a participant's slash only the submitter.
 */
export async function assertGenuinePredecessorProofsKeepHonestSigners(
    h: MathPeerTestHarness
): Promise<void> {
    await startChannelWithTwoBlocks(h);
    const outsider = await outsiderManager(h);
    for (const height of [0, 1]) {
        const { fraudProof } = await invalidTransitionProof(h, height, false);
        await applyFraudProof(h, outsider, fraudProof);
    }
    await h.assert.dispute.slashedOnChainExactly([]);

    const { author, fraudProof } = await invalidTransitionProof(h, 1, false);
    await assertParticipantSubmitterSlashed(h, author, fraudProof);
}

/** Heights of stored blocks that consume an inbound block, and that emit an outbound block. */
async function messageBlockHeights(h: MathPeerTestHarness) {
    const forkId = h.activeForkId!;
    const query = h.control(h.getPeer(0)).query;
    const latest = await query.getLatestBlockBundle(forkId).request();
    const inbound: number[] = [];
    const outbound: number[] = [];
    let previousOutboundHeight = -1n;
    for (let height = 0; height <= latest!.height; height++) {
        const bundle = await query.getBlockByHeight(forkId, height).request();
        const block = Codec.decode(
            Codec.decode(bundle!.encodedSignedBlock, Type.SignedBlock)
                .encodedBlock as string,
            Type.Block
        );
        if (block.messageBlocks.length > 0) inbound.push(height);
        const stored = await query
            .getStateSnapshotStructByHash(bundle!.stateSnapshotHash as Hash)
            .request();
        const outboundHeight = BigInt(
            Codec.decode(stored!.encodedSnapshot, Type.StateSnapshot)
                .snapshotData.latestOutboundMessageBlockHeight
        );
        if (
            previousOutboundHeight >= 0n &&
            outboundHeight > previousOutboundHeight
        )
            outbound.push(height);
        previousOutboundHeight = outboundHeight;
    }
    return { inbound, outbound };
}

/**
 * Genuine predecessor proofs against client-built blocks that carry messages:
 * one consuming a real top-up deposit, one emitting a leave's exit message.
 * The inbound block's author stays slashable, so an outsider's proof must slash
 * nobody. The leaver is no longer slashable, so a participant submits the
 * exit-block proof and only that submitter may be slashed.
 */
export async function assertGenuinePredecessorProofsOverMessageBlocksKeepSigners(
    h: MathPeerTestHarness
): Promise<void> {
    await startChannelWithTwoBlocks(h);
    await h.join.forceInboundJoinWait({ participant: h.getPeer(0).address });
    await h.transition.advanceState({ count: 3 });
    const leaverIndex = await h.transition.participantLeaveStateTransition();
    const { inbound, outbound } = await messageBlockHeights(h);
    expect(inbound, "a block consumed the deposit").to.not.be.empty;
    expect(outbound, "a block emitted the exit").to.not.be.empty;

    const outsider = await outsiderManager(h);
    for (const height of inbound) {
        const { fraudProof } = await invalidTransitionProof(h, height, false);
        await applyFraudProof(h, outsider, fraudProof);
    }
    await h.assert.dispute.slashedOnChainExactly([]);

    const { author, fraudProof } = await invalidTransitionProof(
        h,
        outbound[0],
        false
    );
    expect(author).to.equal(h.getPeer(leaverIndex).address);
    await assertParticipantSubmitterSlashed(h, author, fraudProof);
}
