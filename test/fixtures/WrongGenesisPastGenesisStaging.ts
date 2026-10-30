// @spec-test-coverage-ignore: past-genesis wrong-genesis staging exercised by explicit ValidationService, DisputeManager and E2E-FraudProofsBlockConfirmation declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { StateSnapshot } from "@/models";
import type { Address, ForkId } from "@/types/types";
import * as factory from "@test/factory";
import { expect } from "chai";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;

/**
 * Three participants author two final blocks (0, 1) and peer 0 posts the
 * latest snapshot, so the chain holds the genesis fork past its genesis.
 * Returns the fork and the author of the stored block 0.
 */
export async function stageChainPastGenesis(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0);
    const forkId = h.activeForkId!;
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    expect(
        await h.transition.postSnapshotWait({
            peerIndex: 0,
            forkId: String(forkId)
        })
    ).to.not.equal(undefined);
    const onChain = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    expect(onChain.forkID, "chain on the genesis fork").to.equal(forkId);
    expect(onChain.isGenesis, "chain past genesis").to.equal(false);
    const blockZero = (await h
        .control(h.getPeer(0))
        .query.getBlockByHeight(forkId, 0)
        .request())!;
    return { forkId, blockZeroAuthor: blockZero.author as Address };
}

/** `author`'s height-0 block on `forkId` that does not link to the genesis. */
export async function encodeUnlinkedBlockZero(
    h: MathPeerTestHarness,
    author: Peer,
    forkId: ForkId
): Promise<string> {
    return factory.buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId,
            transactionCnt: 0,
            participant: author.address as Address
        },
        previousBlockHash: factory.hash()
    });
}

/**
 * `observer` stores a WrongGenesis proof against the author of its stored
 * block 0 on `forkId` and constructs its dispute of that fork. Returns
 * whether the proof was stored, how many fraud proofs the dispute applies
 * and whether it lists the author as slashed.
 */
export async function storeWrongGenesisProofAndConstruct(
    h: MathPeerTestHarness,
    observer: Peer,
    forkId: ForkId
) {
    return h.execOnHost(
        observer,
        async (sm, args) => {
            const block = sm.storage.blocks.getBlock(args.forkId, 0)!;
            sm.fraudProofService.createWrongGenesisProof(block);
            const stored =
                sm.storage.fraudProofs.getFraudProofsForParticipant(
                    block.author
                ).length > 0;
            const { dispute, fraudProofsToApply } =
                (await sm.disputeManager.constructDispute(args.forkId))!;
            return {
                stored,
                fraudProofCount: fraudProofsToApply.length,
                authorMarkedSlashed: dispute.input.onChainSlashes.includes(
                    block.author
                )
            };
        },
        { forkId }
    );
}

/**
 * A synced spectator, then peer 0 posts the latest snapshot so the chain holds
 * the genesis fork past its genesis; another author than block 0's feeds the
 * spectator an unlinked block 0 through the spectating `wrongGenesisDetected`
 * hook. Returns the probe and whether the spectator stores a block 0.
 */
export async function runSpectatorWrongGenesisPastGenesis(
    h: MathPeerTestHarness
) {
    const spectator = await h.scenario.syncSpectator(2);
    const forkId = h.activeForkId!;
    expect(
        await h.transition.postSnapshotWait({
            peerIndex: 0,
            forkId: String(forkId)
        })
    ).to.not.equal(undefined);
    const onChain = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    expect(onChain.forkID, "chain on the genesis fork").to.equal(forkId);
    expect(onChain.isGenesis, "chain past genesis").to.equal(false);
    const blockZero = (await h
        .control(h.getPeer(0))
        .query.getBlockByHeight(forkId, 0)
        .request())!;
    const other = h.peers.find(
        (p) => p.address !== blockZero.author && p.index !== spectator.index
    )!;
    const encoded = await encodeUnlinkedBlockZero(h, other, forkId);
    const probe = await h
        .control(spectator)
        .validation.runBlockValidation(encoded, {
            strategy: "spectating",
            hook: "wrongGenesisDetected"
        })
        .request();
    const storesBlockZero =
        (await h
            .control(spectator)
            .query.getBlockByHeight(forkId, 0)
            .request()) !== null;
    return { probe, storesBlockZero, other };
}
