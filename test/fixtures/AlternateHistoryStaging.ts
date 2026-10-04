// @spec-test-coverage-ignore: alternate-history staging shared by dispute E2E cases
import {
    postedProof,
    storedProofBlock,
    storedState,
    submitPendingJoin
} from "./DisputeAuditStaging";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { readMathPeer } from "./OffChainPromotionFixture";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import type { Bytes, ForkId, Hash } from "@/types/types";
import { Codec, hash as keccakHash, Type } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

/**
 * Heights Charlie's honest history adds above the shared block: with David
 * admitted too, the writer rotation reaches Alice again only at block 8, so
 * the honest history runs to block 9 to stay above the double signs.
 */
const HONEST_BLOCKS = 3;
const HONEST_BLOCKS_WITH_DAVID = 5;
/** Heights the alternate history adds above the shared block. */
const ALTERNATE_BLOCKS = 6;

export type AlternateHistory = {
    forkId: ForkId;
    alice: number;
    bob: number;
    charlie: number;
    /** The last block both histories hold. */
    sharedHeight: number;
    /** Charlie's math balance after the honest history admitted him. */
    charlieDeposit: bigint;
    /** The math sum at Charlie's honest head. */
    honestSum: bigint;
    /** The height of Charlie's honest head. */
    honestHeadHeight: number;
    /**
     * Per colluder, the first height whose honest and alternate blocks share
     * that colluder as author: Bob's and Alice's double signs.
     */
    doubleSignHeights: number[];
    /** The height of the alternate head, above Charlie's honest head. */
    alternateHeadHeight: number;
    /** The math sum at the alternate head. */
    alternateSum: bigint;
    /**
     * David, a second pending joiner admitted with Charlie by the honest
     * history, and his math balance there; staged only on request.
     */
    david?: { index: number; deposit: bigint };
};

/**
 * `witnessIndex` crafts its next block (the real transition of a math add by
 * its next writer), the author and every peer of `signerIndices` sign it,
 * and the witness and every peer of `observerIndices` run it through their
 * own block pipeline.
 */
async function witnessNextBlock(
    h: MathPeerTestHarness,
    witnessIndex: number,
    signerIndices: number[],
    observerIndices: number[] = []
) {
    const witness = h.getPeer(witnessIndex);
    const control = h.control(witness);
    const encodedData = (
        witness.contractInstance as MathStateMachine
    ).interface.encodeFunctionData("add", [1]) as Bytes;
    const { encodedBlock, author } = await control.byzantine
        .craftNextBlock(encodedData)
        .request();
    const authorPeer = h.peers.find((peer) => peer.address === author)!;
    const block = await Block.fromBlockStruct(
        Codec.decode(encodedBlock, Type.Block),
        authorPeer.signer
    );
    block.expandSignatures(
        await Promise.all(
            signerIndices
                .map((index) => h.getPeer(index))
                .filter((peer) => peer.address !== author)
                .map((peer) => block.sign(peer.signer))
        )
    );
    const encodedConfirmation = Codec.encode(
        block.blockConfirmationStruct,
        Type.BlockConfirmation
    ) as string;
    for (const index of [witnessIndex, ...observerIndices]) {
        const peer = h.control(h.getPeer(index));
        await peer.byzantine
            .ingestBlockConfirmation(encodedConfirmation)
            .request();
        expect(
            await peer.query.getLatestBlockHeight(block.forkId).request(),
            `peer ${index} stores block ${block.height}`
        ).to.equal(block.height);
    }
}

/** The author of the block at `height` stored on the peer. */
async function storedAuthor(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    height: number
): Promise<string> {
    const { confirmation } = await storedProofBlock(
        h,
        peerIndex,
        forkId,
        height
    );
    return String(Block.fromBlockConfirmation(confirmation).author);
}

/**
 * Alice (peer 0) and Bob (peer 1) author blocks 0-3. Charlie syncs and
 * submits his join; Alice and Bob omit it and author block 4, which all
 * three hold. Charlie is then cut off. Honest history: blocks 5-7 that
 * admit Charlie at block 5, held only by Charlie. All three sign block 5;
 * the later blocks carry only their author's and Charlie's signatures, so
 * Charlie's latest threshold-final point stays the admitting block 5.
 * Alternate history: blocks 5-10 without the join, signed by Alice and
 * Bob, held only by them. The authors of blocks 5 and 6 are Bob and Alice
 * in both histories, so each double-signed. Alice and Bob are colluders:
 * they never time out, dispute or kill on their own; Charlie never times
 * out. With Alice and Bob slashed, Charlie alone is the on-chain threshold
 * set.
 */
export async function stageAlternateHistoryWithoutCharlie(
    h: MathPeerTestHarness
): Promise<AlternateHistory> {
    return await stageAlternateHistory(h, false);
}

/**
 * `stageAlternateHistoryWithoutCharlie` with David, a second pending joiner:
 * he joins right after Charlie, holds the shared block and is cut off with
 * him, from Charlie too. The honest history admits both at block 5, which
 * David signs as well, and runs to block 9; David holds all of it: Bob double-signs block 5 and
 * Alice block 8. David never signs the alternate history nor Charlie's
 * dispute. He never times out nor disputes. With Alice and Bob
 * slashed, the on-chain threshold set is Charlie and David, so Charlie's
 * dispute alone is not final.
 */
export async function stageAlternateHistoryWithoutCharlieAndDavid(
    h: MathPeerTestHarness
): Promise<AlternateHistory & { david: { index: number; deposit: bigint } }> {
    const staged = await stageAlternateHistory(h, true);
    return { ...staged, david: staged.david! };
}

async function stageAlternateHistory(
    h: MathPeerTestHarness,
    withDavid: boolean
): Promise<AlternateHistory> {
    await h.lifecycle.start(2, 0);
    const [alice, bob] = [0, 1];
    const charlie = await h.join.addSpectatorWait();
    const david = withDavid ? await h.join.addSpectatorWait() : undefined;
    await h.transition.advanceState({
        count: 4,
        waitForFinalization: true,
        waitForPeers: [alice, bob]
    });
    for (const index of [alice, bob]) {
        await h.byzantine.stubPendingInboundInclusion(index);
        await h.rpcStub.suppressDisputeKill(index);
    }
    await h.dispute.suppressDisputeInitiation([alice, bob]);
    await h.rpcStub.suppressTimeoutCheck(charlie.index);
    await submitPendingJoin(h, charlie, [alice, bob]);
    if (david) {
        await h.rpcStub.suppressTimeoutCheck(david.index);
        await h.dispute.suppressDisputeInitiation([david.index]);
        await submitPendingJoin(h, david, [alice, bob]);
    }
    const joiners = [charlie, ...(david ? [david] : [])];
    // the shared block: the joins stay pending
    await h.transition.advanceState({ count: 1, waitForPeers: [alice, bob] });
    await h.assert.sync.peersInSyncWait({
        peerIndices: [alice, bob, ...joiners.map((peer) => peer.index)]
    });
    const forkId = h.activeForkId!;
    const sharedHeight = (await h
        .control(charlie)
        .query.getLatestBlockHeight(forkId)
        .request())!;

    for (const joiner of joiners)
        await h.network.blacklistAndDisconnectPeer(joiner.index);
    // David holds every honest block: he signs block 5 and authors some of
    // the later ones
    const observers = david ? [david.index] : [];
    await witnessNextBlock(
        h,
        charlie.index,
        [alice, bob, ...joiners.map((peer) => peer.index)],
        observers
    );
    for (let i = 1; i < (david ? HONEST_BLOCKS_WITH_DAVID : HONEST_BLOCKS); i++)
        await witnessNextBlock(h, charlie.index, [charlie.index], observers);
    // the writer comes from Alice's head: Charlie's head is higher, and the
    // harness's default next writer is the one of the highest head
    for (let i = 0; i < ALTERNATE_BLOCKS; i++) {
        const writer = await h
            .control(h.getPeer(alice))
            .query.getNextToWrite()
            .request();
        await h.transition.peerWrite({
            peer: h.peers.find((peer) => peer.address === writer)!.index,
            waitForPeers: [alice, bob]
        });
    }

    expect(
        await h.control(charlie).query.getStatus().request(),
        "the honest history admitted Charlie"
    ).to.equal(Status.PARTICIPATING);
    expect(
        await h
            .control(h.getPeer(alice))
            .query.getLatestBlockHeight(forkId)
            .request(),
        "the alternate history is longer"
    ).to.equal(sharedHeight + ALTERNATE_BLOCKS);
    const honestHeadHeight = (await h
        .control(charlie)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    expect(
        honestHeadHeight,
        "the alternate head is above Charlie's honest head"
    ).to.be.lessThan(sharedHeight + ALTERNATE_BLOCKS);
    // the first height each colluder authored in both histories
    const doubleSignHeights = new Map<string, number>();
    for (let height = sharedHeight + 1; height <= honestHeadHeight; height++) {
        const author = await storedAuthor(h, alice, forkId, height);
        if (
            !doubleSignHeights.has(author) &&
            (await storedAuthor(h, charlie.index, forkId, height)) === author
        )
            doubleSignHeights.set(author, height);
    }
    expect(
        [...doubleSignHeights.keys()],
        "Alice and Bob each double-signed"
    ).to.have.members([h.getPeer(alice).address, h.getPeer(bob).address]);
    expect(
        Math.max(...doubleSignHeights.values()),
        "Charlie's honest head is above the double signs"
    ).to.be.lessThan(honestHeadHeight);

    // marked only now: the harness picks writers among unmarked peers. Their
    // own SDKs hold only the alternate history, so a reduction from
    // Charlie's honest head fails on them
    for (const index of [alice, bob])
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: index });

    const honest = await readMathPeer(h, charlie.index);
    const alternate = await readMathPeer(h, alice);
    const deposit = (address: string) =>
        honest.state.balances[honest.state.participants.indexOf(address)];
    for (const joiner of joiners) {
        expect(
            honest.state.participants,
            "the honest history admitted every joiner"
        ).to.include(joiner.address);
        expect(
            alternate.state.participants,
            "the alternate history never admitted a joiner"
        ).to.not.include(joiner.address);
    }
    return {
        forkId,
        alice,
        bob,
        charlie: charlie.index,
        sharedHeight,
        charlieDeposit: deposit(charlie.address),
        honestSum: honest.state.number,
        honestHeadHeight,
        doubleSignHeights: [...doubleSignHeights.values()],
        alternateHeadHeight: sharedHeight + ALTERNATE_BLOCKS,
        alternateSum: alternate.state.number,
        ...(david
            ? { david: { index: david.index, deposit: deposit(david.address) } }
            : {})
    };
}

/**
 * `posterIndex` uploads its self-removal dispute re-pointed, with auditing
 * data, at the one milestone `run`: its first block finalizes `finalized`,
 * whose state is `finalizedState`, and its last block commits `latest`.
 */
async function postAlternateDispute(
    h: MathPeerTestHarness,
    posterIndex: number,
    proof: {
        run: BlockConfirmationStruct[];
        finalized: StateSnapshotStruct;
        finalizedState: Bytes;
        latest: StateSnapshotStruct;
    }
) {
    await h
        .control(h.getPeer(posterIndex))
        .dispute.setForceExit(true)
        .request();
    return await h.tamper.postTamperedDispute(
        posterIndex,
        (dispute, _confirmation, auditingData) => {
            const posted = postedProof(dispute, auditingData!, {
                milestones: [proof.run],
                milestoneSnapshots: [proof.finalized],
                latestStateSnapshot: proof.latest,
                finalizedState: proof.finalizedState
            });
            Object.assign(dispute, posted.dispute);
            Object.assign(auditingData!, posted.auditingData);
        }
    );
}

/**
 * Alice posts the alternate history from the shared block through the
 * double-signed blocks. Charlie's replay of it meets his own blocks at those
 * heights and stores a double-sign fraud proof against each author. The
 * posted history crosses Charlie's threshold-final point (block 5) with a
 * different block, so his replay starts right above the shared block and
 * judges every posted block on the alternate history. It ends below
 * Charlie's head: it does not outrun his history. Resolves once Charlie stores both
 * proofs.
 */
export async function postDoubleSignEvidence(
    h: MathPeerTestHarness,
    staged: AlternateHistory
) {
    await postAlternateRun(h, staged, Math.max(...staged.doubleSignHeights));
}

/**
 * Alice posts the whole alternate history from the shared block through its
 * head, above Charlie's honest head, with a valid balance invariant.
 * Charlie's replay stores a double-sign fraud proof against the authors of
 * blocks 5 and 6 and judges every alternate block. Resolves with the posted
 * dispute's hash once Charlie stores both proofs.
 */
export async function postFullAlternateHistory(
    h: MathPeerTestHarness,
    staged: AlternateHistory
) {
    return await postAlternateRun(h, staged, staged.alternateHeadHeight);
}

/**
 * Alice posts the alternate blocks from the shared block through
 * `headHeight`; resolves with the posted dispute's hash once Charlie stores
 * a double-sign fraud proof against Alice and Bob.
 */
async function postAlternateRun(
    h: MathPeerTestHarness,
    staged: AlternateHistory,
    headHeight: number
) {
    const { forkId, alice, bob, charlie, sharedHeight } = staged;
    const run = [];
    for (let height = sharedHeight; height <= headHeight; height++)
        run.push(await storedProofBlock(h, alice, forkId, height));
    const { disputeConfirmation } = await postAlternateDispute(h, alice, {
        run: run.map(({ confirmation }) => confirmation),
        finalized: run[0].snapshot,
        finalizedState: await storedState(h, alice, run[0].snapshot),
        latest: run.at(-1)!.snapshot
    });
    const doubleSign = String(
        toSolidityFraudProofType(FraudProofType.BlockDoubleSign)
    );
    const auditor = h.control(h.getPeer(charlie));
    await waitFor(async () => {
        for (const index of [alice, bob]) {
            const type = await auditor.query
                .getFraudProofType(h.getPeer(index).address)
                .request();
            if (type !== doubleSign) return false;
        }
        return true;
    }, h.event.protocolEventTimeoutMs());
    return keccakHash(disputeConfirmation.signedDispute.encodedDispute);
}

/**
 * Resolves once the chain slashed Alice and Bob: Charlie's dispute applied
 * his double-sign proofs. With both slashed, Charlie alone is the on-chain
 * threshold set, so his dispute is final and its output is the reduction.
 */
export async function waitForColludersSlashed(
    h: MathPeerTestHarness,
    staged: AlternateHistory
) {
    const { alice, bob, charlie } = staged;
    const colluders = [h.getPeer(alice).address, h.getPeer(bob).address];
    await waitFor(async () => {
        const slashed = await h.query.onChainSlashedParticipants(charlie);
        return colluders.every((address) => slashed.includes(address));
    }, h.event.protocolEventTimeoutMs());
}

/**
 * Bob posts the alternate head block re-committed to a snapshot with one
 * more deposit than the chain holds, signed again by its author and the
 * other colluder: threshold-final, with a broken balance invariant.
 */
export async function postAlternateHeadWithInvalidBalance(
    h: MathPeerTestHarness,
    staged: AlternateHistory
) {
    const { forkId, alice, bob } = staged;
    const head = (await h
        .control(h.getPeer(bob))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    const { confirmation, snapshot } = await storedProofBlock(
        h,
        bob,
        forkId,
        head
    );
    const { totalDeposits } = snapshot.snapshotData;
    const forged = StateSnapshot.from({
        ...snapshot,
        snapshotData: {
            ...snapshot.snapshotData,
            totalDeposits: {
                ...totalDeposits,
                amount: BigInt(totalDeposits.amount) + 1n
            }
        }
    }).toStruct();
    const original = Block.fromBlockConfirmation(confirmation);
    const colluders = [alice, bob].map((index) => h.getPeer(index));
    const author = colluders.find((peer) => peer.address === original.author)!;
    const block = await Block.fromBlockStruct(
        {
            ...original.blockStruct,
            stateSnapshotHash: StateSnapshot.from(forged).hash
        },
        author.signer
    );
    block.expandSignatures(
        await Promise.all(
            colluders
                .filter((peer) => peer !== author)
                .map((peer) => block.sign(peer.signer))
        )
    );
    return await postAlternateDispute(h, bob, {
        run: [block.blockConfirmationStruct],
        finalized: forged,
        finalizedState: await storedState(h, bob, snapshot),
        latest: forged
    });
}

/**
 * Resolves once Charlie holds, by hash, the snapshot and the state of every
 * alternate block above the shared block through `headHeight`: his replay of
 * the posted alternate blocks persisted them. Each differs from Charlie's
 * own honest snapshot at that height.
 */
export async function waitForAlternateStatesHeld(
    h: MathPeerTestHarness,
    staged: AlternateHistory,
    headHeight: number
) {
    const { forkId, alice, charlie, sharedHeight, honestHeadHeight } = staged;
    const auditor = h.control(h.getPeer(charlie)).query;
    const alternate: { hash: Hash; stateHash: Hash }[] = [];
    for (let height = sharedHeight + 1; height <= headHeight; height++) {
        const { snapshot } = await storedProofBlock(h, alice, forkId, height);
        const hash = StateSnapshot.from(snapshot).hash;
        // above his honest head the replay may store the alternate block
        if (height <= honestHeadHeight)
            expect(
                (await auditor.getBlockByHeight(forkId, height).request())!
                    .stateSnapshotHash,
                `Charlie's own block ${height} commits another snapshot`
            ).to.not.equal(hash);
        alternate.push({
            hash,
            stateHash: snapshot.snapshotData.stateMachineStateHash as Hash
        });
    }
    await waitFor(async () => {
        for (const { hash, stateHash } of alternate) {
            if (!(await auditor.getStateSnapshotStructByHash(hash).request()))
                return false;
            if (
                (await auditor.getStateMachineState(stateHash).request()) ===
                null
            )
                return false;
        }
        return true;
    }, h.event.protocolEventTimeoutMs());
}

/**
 * The peer's reduction of the dispute it stored under `disputeHash`, alone:
 * the chain's reduce over it, then the peer's own reduce data for that
 * output: the reduced head's height and state, read from its storage by
 * hash.
 */
export async function readReduction(
    h: MathPeerTestHarness,
    peerIndex: number,
    disputeHash: Hash
) {
    return await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const dispute = sm.storage.disputes.getDispute(args.disputeHash);
            if (!dispute) throw new Error("the dispute is not stored");
            const computation = await sm.reductionManager.computeReduction(
                dispute.input.forkId as ForkId,
                [dispute]
            );
            if (!computation) throw new Error("no reduce data");
            const { latestStateSnapshot, encodedStateMachineState } =
                computation.reduceData;
            return {
                headHeight: Number(latestStateSnapshot.blockHeight),
                encodedStateMachineState: String(encodedStateMachineState)
            };
        },
        { disputeHash },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * Asserts the peer's state after the reduction: Charlie and David are the
 * participants with their honest-history deposits, and the math sum is `sum`.
 */
export async function expectReducedToJoiners(
    h: MathPeerTestHarness,
    staged: AlternateHistory & { david: { index: number; deposit: bigint } },
    peerIndex: number,
    sum: bigint,
    message: string
) {
    const reduced = await readMathPeer(h, peerIndex);
    const joiners = [
        {
            address: h.getPeer(staged.charlie).address,
            deposit: staged.charlieDeposit
        },
        {
            address: h.getPeer(staged.david.index).address,
            deposit: staged.david.deposit
        }
    ];
    expect(reduced.state.participants, "Alice and Bob removed").to.have.members(
        joiners.map(({ address }) => address)
    );
    for (const { address, deposit } of joiners)
        expect(
            reduced.state.balances[reduced.state.participants.indexOf(address)],
            "each joiner keeps its deposit"
        ).to.equal(deposit);
    expect(reduced.state.number, message).to.equal(sum);
}
