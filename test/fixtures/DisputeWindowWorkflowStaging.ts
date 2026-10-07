// @spec-test-coverage-ignore: real dispute-window workflows (kill then dispute, late challenges, evidence at window opening, frozen-view replay, fatal audits) staged for the plan-35 E2E declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { BlockOrigin } from "@/storage/QueueStorage";
import type { ForkId, Hash } from "@/types/types";
import { Codec, Type, hash } from "@/utils";
import { disputeOnHost } from "@test/fixtures/ReplayGasLimitStaging";
import { waitFor } from "@test/utils/waitFor";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ZeroAddress } from "ethers";

/** The window commitment of `dispute`, as the chain stores it. */
export function commitmentOf(dispute: DisputeStruct): Hash {
    return hash(Codec.encode(dispute, Type.Dispute)) as Hash;
}

/** The latest block of a dispute's state proof. */
export function latestProofBlock(dispute: DisputeStruct): Block {
    const last = dispute.input.stateProof.milestones
        .at(-1)
        ?.blockConfirmations.at(-1);
    if (!last) throw new Error("The dispute's state proof is empty");
    return Block.fromBlockConfirmation(last);
}

/** The first block of a dispute's last milestone. */
export function lastMilestoneFirstBlock(dispute: DisputeStruct): Block {
    const first =
        dispute.input.stateProof.milestones.at(-1)?.blockConfirmations[0];
    if (!first) throw new Error("The dispute's state proof is empty");
    return Block.fromBlockConfirmation(first);
}

/**
 * `spammerIndex` uploads its own dispute with every enforcement basis
 * removed (no timeout, slash or self-removal, no existing-window claim):
 * an honest auditor proves InvalidDisputeReason against it.
 */
export async function postSpamDispute(
    h: MathPeerTestHarness,
    spammerIndex: number
): Promise<DisputeStruct> {
    const { dispute } = await h.tamper.postTamperedDispute(
        spammerIndex,
        (dispute) => {
            dispute.input.timeout.participant = ZeroAddress;
            dispute.input.onChainSlashes = [];
            dispute.input.selfRemoval = false;
            dispute.input.requireExistingDisputeWindow = false;
        }
    );
    return dispute;
}

/** Hold every peer's `reduction-*` timers: the window stays as staged. */
export async function holdReductions(h: MathPeerTestHarness): Promise<void> {
    for (const peer of h.peers)
        await h.control(peer).stub.stubHoldReductionTasks().request();
}

/** Restore every peer's reduction timers and run the held ones. */
export async function releaseReductions(h: MathPeerTestHarness): Promise<void> {
    for (const peer of h.peers)
        await h.control(peer).stub.restoreReductionTasks(true).request();
}

/**
 * Wait until the chain's kill period of `forkId` is over and return the
 * chain's kill-period state. Time is the input here: the next step must run
 * after the period, as the chain measures it.
 */
export async function waitPastKillPeriod(
    h: MathPeerTestHarness,
    forkId: ForkId,
    observerIndex: number
) {
    const { killPeriodEnd } = await h.query.killPeriod(forkId, observerIndex);
    await h.event.waitUntilTimestamp(killPeriodEnd + 2);
    return h.query.killPeriod(forkId, observerIndex);
}

/** The channel's DisputeCommitted logs (both kinds), in chain order. */
export async function committedDisputeLogs(h: MathPeerTestHarness) {
    const manager = h.channelManager;
    const plain = await manager.queryFilter(
        manager.filters.DisputeCommitted(h.channelId)
    );
    const withData = await manager.queryFilter(
        manager.filters.DisputeCommittedWithAuditingData(h.channelId)
    );
    const project = (
        encodedDispute: string,
        log: { transactionHash: string; blockNumber: number; index: number }
    ) => {
        const dispute = Codec.decode(encodedDispute, Type.Dispute);
        return {
            disputer: dispute.input.disputer,
            forkId: dispute.input.forkId,
            commitment: commitmentOf(dispute),
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index
        };
    };
    return [
        ...plain.map((log) =>
            project(
                log.args.disputeConfirmation.signedDispute.encodedDispute,
                log
            )
        ),
        ...withData.map((log) =>
            project(
                log.args.disputeConfirmation.signedDispute.encodedDispute,
                log
            )
        )
    ].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

/** The channel's DisputeKilled logs, in chain order, with their block time. */
export async function killedDisputeLogs(h: MathPeerTestHarness) {
    const manager = h.channelManager;
    const logs = await manager.queryFilter(
        manager.filters.DisputeKilled(h.channelId)
    );
    return Promise.all(
        logs.map(async (log) => ({
            disputer: log.args.disputer,
            disputeHash: log.args.disputeHash,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index,
            timestamp: (await log.getBlock()).timestamp
        }))
    );
}

/**
 * The reduction `peerIndex` computes from its own storage for the committed
 * window of `forkId` (the same computation its reduction submits). Fails
 * when the peer lacks the data the reduction needs.
 */
export async function computeLocalReduction(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
) {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const commitments =
                await sm.eventSyncService.loadSynchronizedWindowCommitments(
                    sm.channelId,
                    args.forkId
                );
            if (!commitments)
                throw new Error("The window commitments are not available");
            const disputes =
                await sm.agreementManager.getForkDisputes(commitments);
            const computation =
                await sm.reductionManager.computeReductionLocally(
                    args.forkId,
                    disputes
                );
            if (!computation)
                throw new Error("The peer cannot compute the reduction");
            const output = computation.reduceData.reducedOutput;
            return {
                disputeCount: disputes.length,
                latestBlockHeight: Number(
                    output.latestBlock.transaction.header.transactionCnt
                ),
                latestBlockStateSnapshotHash: String(
                    output.latestBlock.stateSnapshotHash
                ),
                latestStateSnapshotHeight: Number(
                    computation.reduceData.latestStateSnapshot.blockHeight
                ),
                slashedParticipants: [...output.slashedParticipants],
                selfRemovals: [...output.selfRemovals],
                timeoutParticipant: output.timeout.participant,
                reducedForkId: computation.reducedForkId
            };
        },
        { forkId },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * E49: four peers. Spammer 1 opens the window with a spam dispute. Peer 0 is
 * the only peer in the kill race: it audits the spam, and its kill rides in
 * front of its own dispute in one multicall. The multicall is recorded and
 * forwarded; with `holdReplacement` it parks at its send (built, estimated
 * and signed inside the kill window) and every reduction is held. Peer 0's
 * lone kills (the fallback when no upload carried the kill) are recorded.
 */
export async function stageKillAndReplacement(
    h: MathPeerTestHarness,
    options: { holdReplacement: boolean }
) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const forkId = h.activeForkId!;
    const replacer = h.getPeer(0);
    const spammer = h.getPeer(1);
    for (const index of [1, 2, 3]) await h.rpcStub.suppressDisputeKill(index);
    if (options.holdReplacement) await holdReductions(h);
    const replacement = await h.rpcStub.recordDisputeSubmissions(
        replacer.index,
        { forward: true, hold: options.holdReplacement }
    );
    const loneKills = await h.rpcStub.recordDisputeFraudProofApplies(
        replacer.index
    );
    const spam = await postSpamDispute(h, spammer.index);
    return { forkId, replacer, spammer, spam, replacement, loneKills };
}

/**
 * E22: four peers, reductions held. Peer 0 opens the window with its own
 * self-removal dispute, so it audits the later spam dispute of peer 1 as a
 * peer that already disputed: its kill goes alone (`killDispute`). The other
 * peers neither dispute nor kill. Peer 0's kill is recorded and forwarded;
 * with `holdKill` it parks at its send, after the audit and the kill-period
 * pre-check passed inside the window.
 */
export async function stageSpamAfterOwnDispute(
    h: MathPeerTestHarness,
    options: { holdKill: boolean }
) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const forkId = h.activeForkId!;
    const killer = h.getPeer(0);
    const spammer = h.getPeer(1);
    const others = [1, 2, 3];
    await holdReductions(h);
    for (const index of others) await h.rpcStub.suppressDisputeKill(index);
    await h.dispute.suppressDisputeInitiation(others);
    const ownUploads = await h.rpcStub.recordDisputeSubmissions(killer.index, {
        forward: true
    });
    await h.control(killer).dispute.setForceExit(true).request();
    await disputeOnHost(h, killer.index, forkId);
    const [ownSubmission] = await ownUploads.submissions();
    const own = Codec.decode(ownSubmission.encodedDispute, Type.Dispute);
    await h.event.waitForPeers("onDisputeCommitted", [0, 2, 3], 1, {
        mode: "atLeast"
    });
    const kills = await h.rpcStub.recordDisputeFraudProofApplies(killer.index, {
        hold: options.holdKill
    });
    const spam = await postSpamDispute(h, spammer.index);
    return { forkId, killer, spammer, own, spam, kills };
}

/**
 * Four peers, reductions held, every participant-timeout check stopped (no
 * timeout dispute cuts the staging short). The next writer authors block
 * `height` off-wire: no other peer holds it.
 */
export async function stageOffWireBlock(
    h: MathPeerTestHarness,
    options?: { evidenceTime?: number }
) {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig:
            options?.evidenceTime !== undefined
                ? { evidenceTime: options.evidenceTime }
                : undefined
    });
    await holdReductions(h);
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const { leader, authored, startHeight, forkId } =
        await h.transition.authorNextBlockOffWireWait();
    const others = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== leader.index);
    return { forkId, leader, others, authored, height: startHeight };
}

/**
 * E19/E47: {@link stageOffWireBlock}, then the leader turns blind to gossip
 * (it reacts to chain events only). Roles among the other peers: an
 * offender, an opener and a late peer whose dispute initiation is
 * suppressed. The caller submits the offender's invalid block: the opener
 * disputes it from height - 1 and the leader then adds its own dispute from
 * its audit of the opener.
 */
export async function stageHigherStateOverOpener(
    h: MathPeerTestHarness,
    options?: { evidenceTime?: number }
) {
    const staged = await stageOffWireBlock(h, options);
    const restoreLeaderNetwork = await h.rpcStub.dropNetworkConfirmations(
        staged.leader.index
    );
    const [offenderIndex, openerIndex, lateIndex] = staged.others;
    await h.dispute.suppressDisputeInitiation([lateIndex]);
    return {
        ...staged,
        offender: h.getPeer(offenderIndex),
        opener: h.getPeer(openerIndex),
        late: h.getPeer(lateIndex),
        restoreLeaderNetwork
    };
}

/**
 * E47/E48: `disputerIndex` (dispute initiation suppressed so far) asks to
 * leave and uploads its own dispute from its frozen view late in the
 * evidence period. The upload is built and parked at its send, then released
 * `marginSeconds` before the evidence period ends.
 */
export async function uploadLateLowerStateDispute(
    h: MathPeerTestHarness,
    disputerIndex: number,
    forkId: ForkId,
    marginSeconds: number
) {
    const disputer = h.getPeer(disputerIndex);
    await h.control(disputer).dispute.setForceExit(true).request();
    const upload = await h.rpcStub.recordDisputeSubmissions(disputerIndex, {
        hold: true,
        forward: true
    });
    await h.dispute.restoreDisputeInitiation([disputerIndex]);
    const attempt = disputeOnHost(h, disputerIndex, forkId);
    // observed below; keeps a failure from being an unhandled rejection meanwhile
    attempt.catch(() => undefined);
    await upload.waitUntilHeld();
    const [created, evidenceTime] = await Promise.all([
        h.channelManager.getDisputeWindowCreationTimestamp(h.channelId, forkId),
        h.execOnHost(disputer, (sm) => sm.timeConfig.evidenceTime)
    ]);
    const evidenceEnd = Number(created) + evidenceTime;
    // time is the input: the lower-state dispute arrives shortly before the
    // evidence period closes
    await h.event.waitUntilTimestamp(evidenceEnd - marginSeconds);
    await upload.release();
    await attempt;
    const [submission] = await upload.submissions();
    return {
        dispute: Codec.decode(submission.encodedDispute, Type.Dispute),
        waited: submission.waited,
        evidenceEnd
    };
}

/**
 * E47: `disputerIndex` uploads a lower-state dispute late in the evidence
 * period whose only claim is a false timeout: it names `accused` as the
 * writer that failed to produce the next block after the disputer's frozen
 * view. Its timeout is planted on the disputer's host, dated at the window
 * creation (so the upload's own window guard admits it), and the dispute is
 * built by the real `constructDispute` before the window opens. The returned
 * upload re-signs it and sends directly `marginSeconds` before evidence ends. The disputer is marked
 * malicious.
 */
export async function prepareLateFalseTimeoutDispute(
    h: MathPeerTestHarness,
    disputerIndex: number,
    accused: string,
    forkId: ForkId
) {
    const disputer = h.getPeer(disputerIndex);
    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: disputerIndex });
    await h.tamper.plantFreshTimeoutForParticipant(disputerIndex, accused);
    const { dispute, disputeConfirmation, auditingData } =
        await h.dispute.fetchConstructedDispute(disputerIndex, forkId);
    // Construct the frozen lower-state claim before the opener starts the window.
    return async (marginSeconds: number) => {
        const [created, evidenceTime] = await Promise.all([
            h.channelManager.getDisputeWindowCreationTimestamp(
                h.channelId,
                forkId
            ),
            h.execOnHost(disputer, (sm) => sm.timeConfig.evidenceTime)
        ]);
        // the timeout is the dispute's only reason
        dispute.input.timeout.minTimeStamp = created;
        dispute.input.onChainSlashes = [];
        dispute.input.selfRemoval = false;
        await h.tamper.resignDispute(
            disputer.signer,
            dispute,
            disputeConfirmation
        );
        const evidenceEnd = Number(created) + evidenceTime;
        const contract = disputer.p2pInstance.stateChannelManagerContract;
        // Complete the real estimation before waiting near the admission deadline.
        const gasLimit = dispute.postedAuditingData
            ? await contract.uploadDisputeWithCalldata.estimateGas(
                  disputeConfirmation,
                  auditingData
              )
            : await contract.uploadDispute.estimateGas(disputeConfirmation);
        const request = dispute.postedAuditingData
            ? await contract.uploadDisputeWithCalldata.populateTransaction(
                  disputeConfirmation,
                  auditingData,
                  { gasLimit }
              )
            : await contract.uploadDispute.populateTransaction(
                  disputeConfirmation,
                  { gasLimit }
              );
        // Fee and chain metadata reads also belong before the deadline wait.
        // The real host signer still owns nonce assignment and broadcasting.
        const signer = disputer.p2pInstance.chainSigner;
        const populated = await signer.populateTransaction(request);
        // time is the input: the lower-state dispute arrives shortly before the
        // evidence period closes
        await h.event.waitUntilTimestamp(evidenceEnd - marginSeconds);
        const transaction = await signer.sendTransaction(populated);
        await transaction.wait();
        return { dispute, evidenceEnd };
    };
}

/** The state-machine state hash a peer's stored snapshot at `height` commits to. */
export async function storedStateHashAt(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    height: number
): Promise<Hash> {
    const stored = await h
        .control(h.getPeer(peerIndex))
        .query.getStateSnapshotStructAt(forkId, height)
        .request();
    if (!stored)
        throw new Error(`Peer ${peerIndex} holds no snapshot at ${height}`);
    return StateSnapshot.from(
        Codec.decode(stored.encodedSnapshot, Type.StateSnapshot)
    ).stateMachineStateHash;
}

/**
 * E21: four peers, reductions held, participant timeouts stopped. The
 * auditor (not the next writer) is blind to gossip; the writer authors
 * block `height` for the others. The auditor then gets that block from its
 * author alone through the control port and signs it: its signature reaches
 * the others, theirs never reaches it. Block `height` is final for every
 * peer except the auditor, whose latest final point stays below it.
 */
export async function stageAuditorBehindLastFinalBlock(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const forkId = h.activeForkId!;
    await holdReductions(h);
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const writer = await h.query.getNextPeerToWrite();
    const auditor = h.peers.find((peer) => peer.index !== writer.index)!;
    const others = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== auditor.index);
    await h.rpcStub.dropNetworkConfirmations(auditor.index);
    const height = await h
        .control(writer)
        .query.getNextBlockHeight(forkId)
        .request();
    await h.transition.advanceState({
        count: 1,
        waitForPeers: others,
        waitForFinalization: false
    });
    const authored = await h
        .control(writer)
        .query.getBlockByHeight(forkId, height)
        .request();
    if (!authored)
        throw new Error(`Writer ${writer.index} did not author ${height}`);
    const { signedBlock } = Codec.decode(
        authored.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    await h.transition.ingestBlockConfirmationWait({
        peerIndex: auditor.index,
        blockConfirmation: { signedBlock, signatures: [] },
        ingestOptions: {
            origin: BlockOrigin.NETWORK,
            senderAddress: writer.address
        }
    });
    await waitFor(async () => {
        for (const index of others) {
            const isFinal = await h
                .control(h.getPeer(index))
                .query.didEveryoneSignBlockAt(forkId, height)
                .request();
            if (!isFinal) return false;
        }
        return true;
    }, h.event.protocolEventTimeoutMs());
    return { forkId, writer, auditor, others, authored, height };
}
