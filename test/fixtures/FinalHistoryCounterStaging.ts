// @spec-test-coverage-ignore: final-history counter staging shared by the conflict and regression slash-set cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { Codec, Type } from "@/utils";
import { buildAndEncodeBlock } from "@test/factory";
import { postAuditingData } from "@test/fixtures/ChallengeBoundaryStaging";
import { blockConfirmationAt } from "@test/fixtures/DisputeAuditStaging";
import {
    constructJoinerBypassDispute,
    type JoinerBypassDispute,
    readLocalFinalSnapshot,
    type SeatedJoinerHistory,
    stageSeatedJoinerHistory
} from "@test/fixtures/OmittedInboundJoinerStaging";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

/**
 * A block at `height` of the active fork, linked to peer 0's stored block
 * below it, authored by `authorIndex` and confirmed by each of
 * `confirmerIndices`. It commits a snapshot nobody holds.
 */
export async function forgeBlockSignedBy(
    h: MathPeerTestHarness,
    options: {
        height: number;
        authorIndex: number;
        confirmerIndices: number[];
    }
): Promise<BlockConfirmationStruct> {
    const author = h.getPeer(options.authorIndex);
    const previous = Block.fromBlockConfirmation(
        await blockConfirmationAt(h, 0, options.height - 1)
    );
    const encoded = await buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId: h.activeForkId!,
            transactionCnt: options.height,
            participant: author.address
        },
        previousBlockHash: previous.hash
    });
    const forged = Block.fromBlockConfirmation(
        Codec.decode(encoded, Type.BlockConfirmation)
    );
    forged.expandSignatures(
        await Promise.all(
            options.confirmerIndices.map((index) =>
                forged.sign(h.getPeer(index).signer)
            )
        )
    );
    return forged.blockConfirmationStruct;
}

/**
 * Bob's block right above the bypass hop, linked to it and committing the
 * hop's state at its own height, appended to the hop's milestone. Its
 * snapshot becomes the dispute's latest state and the posted data is
 * committed again. Returns the appended block.
 */
export async function appendTailAboveBypassHop(
    h: MathPeerTestHarness,
    history: SeatedJoinerHistory,
    bypass: JoinerBypassDispute
): Promise<Block> {
    const { dispute, auditingData, hopBlock, hopSnapshot } = bypass;
    const bob = h.getPeer(history.bobIndex);
    const height = hopBlock.height + 1;
    const tailSnapshot = StateSnapshot.from({
        ...hopSnapshot.toStruct(),
        blockHeight: height
    });
    const { transaction } = hopBlock.blockStruct;
    const tailBlock = await Block.fromBlockStruct(
        {
            ...hopBlock.blockStruct,
            transaction: {
                ...transaction,
                header: {
                    ...transaction.header,
                    participant: bob.address,
                    transactionCnt: height
                }
            },
            previousBlockHash: hopBlock.hash,
            stateSnapshotHash: tailSnapshot.hash
        },
        bob.signer
    );
    dispute.input.stateProof = {
        milestones: [
            {
                blockConfirmations: [
                    hopBlock.blockConfirmationStruct,
                    tailBlock.blockConfirmationStruct
                ]
            }
        ]
    };
    dispute.input.latestStateSnapshotHash = tailSnapshot.hash;
    auditingData.latestStateSnapshot = tailSnapshot.toStruct();
    postAuditingData(dispute, auditingData);
    return tailBlock;
}

/**
 * `stageSeatedJoinerHistory`, three more final blocks, then the bypass hop
 * one block below Charlie's latest final point, whose conflict he cannot
 * prove, and a tail block at that final point
 * (`appendTailAboveBypassHop`). The dispute carries two counters: the tail
 * block's conflict, which slashes nobody, and the hop's regression.
 */
export async function stageTailConflictAboveBypassHop(h: MathPeerTestHarness) {
    const history = await stageSeatedJoinerHistory(h);
    const charlie = h.getPeer(history.charlieIndex);
    await h.transition.advanceState({ count: 3, waitForFinalization: true });
    const latestFinal = await readLocalFinalSnapshot(
        h,
        charlie.index,
        history.forkId
    );
    const hopHeight = latestFinal.blockHeight - 1;
    expect(
        hopHeight - 1,
        "a final point past the JOIN lies below G"
    ).to.be.at.least(history.charlieFinal.blockHeight);
    const bypass = await constructJoinerBypassDispute(h, history, {
        height: hopHeight
    });
    const tailBlock = await appendTailAboveBypassHop(h, history, bypass);
    expect(
        tailBlock.height,
        "the tail block is at Charlie's final point"
    ).to.equal(latestFinal.blockHeight);
    await h.rpcStub.makeFinalPointUnprovable(charlie.index, hopHeight);
    return { history, charlie, bypass, tailBlock };
}
