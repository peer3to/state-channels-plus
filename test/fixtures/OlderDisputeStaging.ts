// @spec-test-coverage-ignore: older-dispute and departed-submitter staging shared by the plan-35 E2E cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import StateSnapshot from "@/models/StateSnapshot";
import {
    Status,
    TimeoutSupersededByFinalStateProofEthersType,
    timeoutWaitTime
} from "@/types";
import type { ForkId } from "@/types/types";
import { addressesEqual, Codec, Type } from "@/utils";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import { waitFor } from "@test/utils/waitFor";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ZeroHash } from "ethers";

/** The participant-timeout check is off on `peerIndices`, so idle staging opens no real timeout window. */
export async function suppressTimeoutChecks(
    h: MathPeerTestHarness,
    peerIndices: number[]
): Promise<void> {
    await Promise.all(
        peerIndices.map((peerIndex) =>
            h.rpcStub.suppressTimeoutCheck(peerIndex)
        )
    );
}

/**
 * A fresh spectator synced while `authoringPeerIndices` author at least
 * three finalized blocks: its finalized state is newer than everything
 * authored before the spawn. `isolateFromIndices` are blacklisted pairwise
 * before the connection, so the spectator never syncs from them.
 */
export async function addFreshSpectator(
    h: MathPeerTestHarness,
    options: { authoringPeerIndices: number[]; isolateFromIndices?: number[] }
): Promise<number> {
    const { peer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: options.authoringPeerIndices,
        minimumBlocks: 3,
        maximumBlocks: 19,
        waitForFinalization: true,
        beforeConnect: async (created) => {
            for (const isolatedIndex of options.isolateFromIndices ?? []) {
                const isolated = h.getPeer(isolatedIndex);
                await h
                    .control(created)
                    .network.blacklistAndDisconnectPeerByAddress(
                        isolated.address
                    )
                    .request();
                await h
                    .control(isolated)
                    .network.blacklistAndDisconnectPeerByAddress(
                        created.address
                    )
                    .request();
            }
        }
    });
    return peer.index;
}

/**
 * The peer's own on-chain join, with the current threshold set's
 * confirmation signatures; returns once `observerIndices` stored the join
 * and the joiner is a pending participant. No block consumes the join.
 */
export async function joinAsPendingParticipant(
    h: MathPeerTestHarness,
    joinerIndex: number,
    observerIndices: number[]
): Promise<void> {
    const joiner = h.getPeer(joinerIndex);
    const previousLatestHash =
        (await h
            .control(h.getPeer(observerIndices[0]!))
            .query.getLatestInboundMessageHash()
            .request()) ?? undefined;
    const prepared = await h.join.buildJoinChannelConfirmation({
        joiner,
        channelId: h.channelId
    });
    await joiner.p2pInstance.p2pSigner.joinChannel(
        prepared.confirmation,
        prepared.expectedSnapshotHash,
        prepared.expectedForkId
    );
    await h.assert.storage.honestPeersObserveInboundMessageWait({
        previousLatestHash,
        peerIndices: observerIndices
    });
    await h.event.waitUntilPeerStatus(joinerIndex, Status.PENDING_PARTICIPANT);
}

/** Every peer in `peerIndices` holds the chain's inbound head (a dispute must name it). */
export async function waitForChainInboundHead(
    h: MathPeerTestHarness,
    peerIndices: number[]
): Promise<void> {
    const { latestInboundMessageBlockHash } =
        await h.channelManager.getChannelBalance(h.channelId);
    await waitFor(async () => {
        const heads = await Promise.all(
            peerIndices.map((peerIndex) =>
                h
                    .control(h.getPeer(peerIndex))
                    .query.getLatestInboundMessageHash()
                    .request()
            )
        );
        return heads.every((head) => head === latestInboundMessageBlockHash);
    }, h.event.protocolEventTimeoutMs());
}

/** Height of the peer's latest locally finalized state (its trusted audit start), or null. */
export async function readLocalFinalizedHeight(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
): Promise<number | null> {
    return await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const snapshot =
                await sm.agreementManager.getLocalFinalizedSnapshot(
                    args.forkId
                );
            return snapshot ? snapshot.blockHeight : null;
        },
        { forkId }
    );
}

/**
 * The reduction of `forkId`'s window as the chain computes it from the
 * surviving committed disputes (killed ones are gone from the window), read
 * on `observerIndex` through its own reduction path, with the reduced fork
 * the chain recorded for that window. A reducer installs its fork before its
 * reduce transaction is sent, so the chain's record is awaited first.
 */
export async function readWindowReduction(
    h: MathPeerTestHarness,
    observerIndex: number,
    forkId: ForkId
) {
    await waitFor(
        async () =>
            (await h.channelManager.getReducedResult(h.channelId, forkId))
                .reducedForkId !== ZeroHash,
        h.event.protocolEventTimeoutMs()
    );
    return await h.execOnHost(
        h.getPeer(observerIndex),
        async (sm, args) => {
            const disputes = await sm.reductionManager.getSyncedForkDisputes(
                args.forkId
            );
            if (!disputes)
                throw new Error(
                    "readWindowReduction: the window's disputes are not readable"
                );
            const computation = await sm.reductionManager.computeReduction(
                args.forkId,
                disputes
            );
            if (!computation)
                throw new Error(
                    "readWindowReduction: the reduce data is not available"
                );
            const output = computation.reduceData.reducedOutput;
            // the host reads the result by name: it is not an array there
            const { reducedForkId: executedReducedForkId } =
                await sm.stateChannelManagerContract.getReducedResult(
                    sm.channelId,
                    args.forkId
                );
            return {
                disputers: disputes.map((dispute) =>
                    String(dispute.input.disputer)
                ),
                latestBlockHeight: Number(
                    output.latestBlock.transaction.header.transactionCnt
                ),
                slashedParticipants: output.slashedParticipants.map(
                    (participant) => String(participant)
                ),
                timeoutParticipant: String(output.timeout.participant),
                selfRemovals: output.selfRemovals.map((participant) =>
                    String(participant)
                ),
                participants: computation.reducedSnapshotData.participants.map(
                    (participant) => String(participant)
                ),
                reducedForkId: String(computation.reducedForkId),
                /** the reduced fork the chain recorded for the window */
                executedReducedForkId: String(executedReducedForkId)
            };
        },
        { forkId }
    );
}

/** Hash of the chain's snapshot in the block that killed `disputer`'s dispute. */
export async function readSnapshotHashAtKill(
    h: MathPeerTestHarness,
    disputer: string
): Promise<string> {
    const kills = (
        await h.channelManager.queryFilter(
            h.channelManager.filters.DisputeKilled(h.channelId)
        )
    ).filter((log) => addressesEqual(log.args.disputer, disputer));
    if (kills.length !== 1)
        throw new Error(
            `Expected one kill of ${disputer}'s dispute, got ${kills.length}`
        );
    return StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId, {
            blockTag: kills[0]!.blockNumber
        })
    ).hash as string;
}

/**
 * `observerIndex`'s own threshold-final proof up to `height` (its latest
 * final point when omitted), encoded as a TimeoutSupersededByFinalState
 * counter, with the height of the final point it proves.
 */
export async function buildFinalStateCounter(
    h: MathPeerTestHarness,
    observerIndex: number,
    forkId: ForkId,
    height?: number
): Promise<{ encodedProof: string; finalHeight: number }> {
    return await h.execOnHost(
        h.getPeer(observerIndex),
        async (sm, args, { ethers }) => {
            const { finalProof, finalizedSnapshot } =
                await sm.agreementManager.buildFinalProof(
                    args.forkId,
                    args.height ?? undefined
                );
            return {
                encodedProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    [args.abiType],
                    [{ finalProof }]
                ),
                finalHeight: finalizedSnapshot.blockHeight
            };
        },
        {
            forkId,
            height: height ?? null,
            abiType: TimeoutSupersededByFinalStateProofEthersType
        }
    );
}

/**
 * The block at `height` as `observerIndex` holds it: its author, the
 * participant union its threshold needs, and whether `departed` signed it.
 */
export async function readAccusedBlock(
    h: MathPeerTestHarness,
    observerIndex: number,
    forkId: ForkId,
    height: number,
    departed: string
) {
    const accused = await h.execOnHost(
        h.getPeer(observerIndex),
        (sm, args) => {
            const block = sm.storage.blocks.getBlock(args.forkId, args.height);
            if (!block) return null;
            const requiredSigners = sm.storage.getParticipantsUnion(
                { forkId: args.forkId, height: args.height },
                block.stateSnapshotHash
            );
            return {
                author: String(block.author),
                requiredSigners: requiredSigners.map((signer) =>
                    String(signer)
                ),
                everyoneSigned: block.didEveryoneSign(requiredSigners),
                signedByDeparted:
                    block.findSignature(args.departed) !== undefined
            };
        },
        { forkId, height, departed }
    );
    if (!accused)
        throw new Error(
            `readAccusedBlock: peer ${observerIndex} holds no block at height ${height}`
        );
    return accused;
}

/**
 * Four peers; the next writer (Alice) authors her departure and leaves the
 * channel off chain. Her automatic exit post parks at its send, so she stays
 * in the chain's participant set and may still dispute. She is then cut off
 * from the network and holds nothing after her departure block. Every peer's
 * participant-timeout check is off. Before Alice disputes, the caller awaits
 * `confirmExitParked` (her post is parked and the chain still lets her
 * dispute); it releases the parked post with `releaseExitPost` before the
 * test ends.
 */
export async function stageDepartedEligibleLeaver(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({ peerCount: 4, transitionCount: 2 });
    const forkId = h.activeForkId!;
    const alice = await h.query.getNextPeerToWrite();
    const remaining = h.peers
        .map((peer) => peer.index)
        .filter((peerIndex) => peerIndex !== alice.index);

    const exitPost = await h.rpcStub.holdSnapshotPostSend(alice.index);
    await h.transition.participantLeaveStateTransition({
        leaverIndex: alice.index
    });
    await suppressTimeoutChecks(
        h,
        h.peers.map((peer) => peer.index)
    );
    await h.network.blacklistAndDisconnectPeer(alice.index);

    const departureHeight = Number(
        await h.control(alice).query.getLatestBlockHeight(forkId).request()
    );
    const observer = h.getPeer(remaining[0]!);
    // her departure block is the last one she signed
    const lastSigned = await h
        .control(observer)
        .query.getLatestSignedBlockByParticipant(forkId, alice.address)
        .request();
    expect(lastSigned?.height).to.equal(departureHeight);
    // departed off chain ...
    const participants = await h
        .control(observer)
        .query.getParticipants()
        .request();
    expect(
        participants.some((address) => addressesEqual(address, alice.address))
    ).to.equal(false);

    return {
        forkId,
        alice,
        remaining,
        departureHeight,
        confirmExitParked: async () => {
            await exitPost.waitUntilHeld();
            // still eligible on chain while her exit post is parked
            expect(
                await h.channelManager.canParticipateInDisputes(
                    h.channelId,
                    alice.address
                )
            ).to.equal(true);
        },
        releaseExitPost: async () => {
            await exitPost.release();
        }
    };
}

/**
 * Departed Alice times out `accused` at `accusedHeight`, the height after her
 * last signed state, and uploads that dispute. The claim's timeout window
 * after her departure block has passed, so it is not refuted as too early.
 */
export async function postDepartedTimeoutDispute(
    h: MathPeerTestHarness,
    options: {
        aliceIndex: number;
        accused: string;
        accusedHeight: number;
        markMalicious: boolean;
        /**
         * The chain refuses a non-forced timeout of a block whose calldata is
         * posted (RaceConditionDisputeTimeoutCalldataPosted): a claim against
         * posted calldata reaches the chain only as a forced timeout.
         */
        isForced?: boolean;
    }
): Promise<DisputeStruct> {
    // time is the input here: the claim must be timely to reach its counter.
    // The margin past the deadline is one p2pTime, the clock tolerance the
    // protocol gives a writer.
    const departure = await h
        .control(h.getPeer(options.aliceIndex))
        .query.getLatestBlockInfo(h.activeForkId!)
        .request();
    if (!departure) throw new Error("Alice holds no departure block");
    const { header } = Codec.decode(
        departure.encodedBlock,
        Type.Block
    ).transaction;
    expect(Number(header.transactionCnt) + 1).to.equal(options.accusedHeight);
    const timeConfig = resolveTestTimeConfig(h.options.timeConfig);
    await h.event.waitUntilTimestamp(
        Number(header.timestamp) +
            timeoutWaitTime(timeConfig, options.accusedHeight) +
            timeConfig.p2pTime
    );
    await h.tamper.plantFreshTimeoutForParticipant(
        options.aliceIndex,
        options.accused
    );
    const { dispute } = await h.tamper.postTamperedDispute(
        options.aliceIndex,
        (tampered) => {
            if (options.isForced) tampered.input.timeout.isForced = true;
        },
        { markMalicious: options.markMalicious }
    );
    expect(Number(dispute.input.timeout.blockHeight)).to.equal(
        options.accusedHeight
    );
    expect(
        addressesEqual(dispute.input.timeout.participant, options.accused)
    ).to.equal(true);
    return dispute;
}

/**
 * The older-dispute path with the auditor's own newer state.
 * `postOlderDispute` commits a dispute that ends below the pending
 * auditor's finalized state, from a disputer that signed nothing newer. The
 * auditor holds no state at that height. Its audit must not read the older
 * balance, must store no counter, and must upload its own newer dispute with
 * posted auditing data (the omission rule fails: pending peers never signed
 * the newer state). That dispute must be committed and the reduction of the
 * window must select its state.
 */
export async function assertNewerStateAnswersOlderDispute(
    h: MathPeerTestHarness,
    options: {
        forkId: ForkId;
        olderDisputerIndex: number;
        auditorIndex: number;
        /** A participant that holds every state of the fork. */
        observerIndex: number;
        honestPeerIndices: number[];
        postOlderDispute: () => Promise<unknown>;
    }
): Promise<void> {
    const { forkId, auditorIndex, observerIndex } = options;
    const disputer = h.getPeer(options.olderDisputerIndex);
    const auditor = h.getPeer(auditorIndex);
    const observer = h.getPeer(observerIndex);

    const olderHeight = Number(
        await h.control(disputer).query.getLatestBlockHeight(forkId).request()
    );
    const olderStateHash = await h
        .control(disputer)
        .query.getLatestStateMachineStateHash(forkId)
        .request();
    if (olderStateHash === null)
        throw new Error("The older disputer holds no latest state");
    const auditorHeight = Number(
        await h.control(auditor).query.getLatestBlockHeight(forkId).request()
    );

    // the auditor is pending and trusts a final state above the older one
    expect(await h.control(auditor).query.getStatus().request()).to.equal(
        Status.PENDING_PARTICIPANT
    );
    expect(
        (await readLocalFinalizedHeight(h, auditorIndex, forkId)) ?? -1
    ).to.be.greaterThan(olderHeight);
    // it never held the older state
    expect(
        await h
            .control(auditor)
            .query.getStateMachineState(olderStateHash)
            .request()
    ).to.equal(null);
    // the disputer signed nothing above its dispute: no newer-signature counter exists
    for (const holder of [observer, auditor]) {
        const lastSigned = await h
            .control(holder)
            .query.getLatestSignedBlockByParticipant(forkId, disputer.address)
            .request();
        expect(
            lastSigned === null || lastSigned.height <= olderHeight
        ).to.equal(true);
    }

    let submittedHeight: number | undefined;
    const balanceReads = await h.mirror.observe(
        auditorIndex,
        "verifyBalanceInvariantCheckSnapshot"
    );
    const uploads = await h.rpcStub.recordDisputeSubmissions(auditorIndex, {
        hold: true,
        forward: true
    });
    try {
        await options.postOlderDispute();
        // the older dispute is the window's only commitment: the auditor's
        // own upload is held and the participants add none
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            forkId
        );
        expect(commitments.length).to.equal(1);
        const olderCommitment = commitments[0]!;
        // the auditor's verdict on it: accepted (its confirmation stored),
        // with no counter, before its own upload
        await waitFor(
            () =>
                h
                    .control(auditor)
                    .query.hasDisputeConfirmation(olderCommitment)
                    .request(),
            h.event.protocolEventTimeoutMs()
        );
        const olderDispute = await h.query.getDispute(
            auditorIndex,
            olderCommitment
        );
        expect(
            addressesEqual(olderDispute!.input.disputer, disputer.address)
        ).to.equal(true);
        await uploads.waitUntilHeld();

        const observation = await balanceReads.observation();
        expect(observation.local.reads).to.equal(0);
        expect(observation.chain.reads).to.equal(0);
        expect(
            await h.control(auditor).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([]);
        expect(
            await h
                .control(auditor)
                .query.getStateMachineState(olderStateHash)
                .request()
        ).to.equal(null);

        const [submission] = await uploads.submissions();
        if (!submission) throw new Error("The auditor uploaded nothing");
        const ownDispute = Codec.decode(
            submission.encodedDispute,
            Type.Dispute
        );
        expect(
            addressesEqual(ownDispute.input.disputer, auditor.address)
        ).to.equal(true);
        expect(
            await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                ownDispute
            )
        ).to.equal(false);
        // A final block may arrive after the initial auditor-height read.
        // Reduction must select the exact state the auditor actually submits.
        if (submission.encodedAuditingData === null)
            throw new Error("The auditor omitted its auditing data");
        const submittedSnapshot = StateSnapshot.from(
            Codec.decode(
                submission.encodedAuditingData,
                Type.DisputeAuditingData
            ).latestStateSnapshot
        );
        expect(submittedSnapshot.hash).to.equal(
            ownDispute.input.latestStateSnapshotHash
        );
        submittedHeight = submittedSnapshot.blockHeight;
        expect(submittedHeight).to.be.at.least(auditorHeight);
        expect(submittedHeight).to.be.greaterThan(olderHeight);
        expect(ownDispute.postedAuditingData).to.equal(true);
        expect(submission.encodedAuditingData).to.not.equal(null);
    } finally {
        await uploads.release();
    }
    await waitFor(
        async () => (await uploads.submissions())[0]?.waited === true,
        h.event.protocolEventTimeoutMs()
    );
    expect((await uploads.submissions())[0]?.revert).to.equal(null);

    await h.dispute.resolveDisputeWait({
        forkId,
        honestPeerIndices: options.honestPeerIndices,
        assertMaliciousRemoved: false
    });

    const reduction = await readWindowReduction(h, observerIndex, forkId);
    expect(
        reduction.disputers.some((address) =>
            addressesEqual(address, auditor.address)
        )
    ).to.equal(true);
    expect(
        reduction.disputers.some((address) =>
            addressesEqual(address, disputer.address)
        )
    ).to.equal(true);
    expect(submittedHeight).to.not.equal(undefined);
    expect(reduction.latestBlockHeight).to.equal(submittedHeight);
    expect(reduction.latestBlockHeight).to.be.greaterThan(olderHeight);
    expect(reduction.slashedParticipants).to.deep.equal([]);
    expect(reduction.reducedForkId).to.equal(
        await h.control(observer).query.getForkId().request()
    );
    expect(reduction.executedReducedForkId).to.equal(reduction.reducedForkId);
    await h.assert.dispute.slashedOnChainExactly([]);

    expect(
        await h.control(auditor).query.getDisputeFraudProofTypes().request()
    ).to.deep.equal([]);
    expect(
        (await auditor.p2pInstance.quiesce()).map((error) => error.message)
    ).to.deep.equal([]);
}
