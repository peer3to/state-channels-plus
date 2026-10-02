// @spec-test-coverage-ignore: shared unlinked-previous-snapshot staging exercised by mapped E2E declarations

import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
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
 * Invalid-transition proof against the real signed block at `height` and its
 * real predecessor block, with a previous snapshot that is the peer's own
 * snapshot moved to another fork and a made-up state; nothing links that
 * snapshot to the block.
 */
async function unlinkedPreviousSnapshotProof(
    h: MathPeerTestHarness,
    height: number
) {
    const observer = h.control(h.getPeer(0));
    const bundle = await observer.query
        .getBlockByHeight(h.activeForkId!, height)
        .request();
    expect(bundle, `block ${height} stored`).to.not.equal(null);
    const previous =
        height === 0
            ? null
            : await observer.query
                  .getBlockByHeight(h.activeForkId!, height - 1)
                  .request();
    const { encodedSnapshot } = await observer.query
        .getLocalStateSnapshotStruct()
        .request();
    const forgedSnapshot = Codec.decode(encodedSnapshot, Type.StateSnapshot);
    forgedSnapshot.forkId = hash();

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
                    previousBlockStateSnapshot: forgedSnapshot,
                    previousStateStateMachineState: hexString(64)
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

/** An outsider forges both blocks' predecessors; nobody is slashed. */
export async function assertOutsiderUnlinkedSnapshotSlashesNobody(
    h: MathPeerTestHarness
): Promise<void> {
    await startChannelWithTwoBlocks(h);
    const outsider = connectStateChannelManager(
        await h.getPeer(0).p2pInstance.stateChannelManagerContract.getAddress(),
        h.signerFor(slotAccountIndex(h.peers.length))
    );

    for (const height of [0, 1]) {
        const { fraudProof } = await unlinkedPreviousSnapshotProof(h, height);
        await applyFraudProof(h, outsider, fraudProof);
    }
    await h.assert.dispute.slashedOnChainExactly([]);
}

/** A participant forges a later block's predecessor; only the submitter is slashed. */
export async function assertParticipantUnlinkedSnapshotSlashesSubmitter(
    h: MathPeerTestHarness
): Promise<void> {
    await startChannelWithTwoBlocks(h);
    const { author, fraudProof } = await unlinkedPreviousSnapshotProof(h, 1);
    const submitter = h.peers.find(
        (peer) => peer.address.toLowerCase() !== author.toLowerCase()
    )!;

    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: submitter.index });
    await applyFraudProof(
        h,
        submitter.p2pInstance.stateChannelManagerContract,
        fraudProof
    );
    await h.assert.dispute.slashedOnChainExactly([submitter.address]);
}
