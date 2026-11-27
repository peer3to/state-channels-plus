import {
    auditEvidenceKey,
    EvidenceKey,
    isSyncEvidenceKey,
    syncEvidenceKey
} from "./keys";
import { StateSnapshot } from "@/models";
import type { ProofEvidence } from "@/types/disputes";
import type { Bytes, ForkId, Hash } from "@/types/types";
import { hash } from "@/utils/hash";
import type { Logger } from "@/utils/logging/Logger";

/**
 * Proofs kept as evidence outside the stored proof: audit evidence (one per
 * audited dispute) and sync evidence (one per finalized snapshot). Only sync
 * evidence is bounded, per fork; audit evidence is pinned (never counted,
 * refused or evicted). A fork's records stay until `dropFork`. The value is
 * plain data with a `Codec` type (`Type.ProofEvidence`). A fork whose
 * signing a synced proof stopped is kept with that sync evidence until
 * `dropFork`.
 */
export class ProofEvidenceStorage {
    private readonly maxSyncRecordsPerFork: number;
    private readonly logger?: Logger;
    private readonly evidenceByKey = new Map<EvidenceKey, ProofEvidence>();
    // the forks on which a synced proof, kept as sync evidence, showed this
    // peer's own history to be the side chain; only `dropFork` lifts one
    private readonly signingStoppedForkIds = new Set<ForkId>();

    constructor(maxSyncRecordsPerFork: number, logger?: Logger) {
        this.maxSyncRecordsPerFork = maxSyncRecordsPerFork;
        this.logger = logger;
    }

    /** Stores `evidence` as the audit evidence of `disputeHash`, replacing an earlier one. */
    public setAuditEvidence(
        disputeHash: Hash,
        evidence: ProofEvidence
    ): EvidenceKey {
        const key = auditEvidenceKey(disputeHash);
        this.evidenceByKey.set(key, evidence);
        return key;
    }

    /**
     * Stores `evidence` under its proof's finalized snapshot, replacing an
     * earlier record there. A new record on a fork that already holds the
     * maximum of sync records is refused (logged): returns `undefined`.
     */
    public setSyncEvidence(evidence: ProofEvidence): EvidenceKey | undefined {
        const key = syncEvidenceKey(
            StateSnapshot.from(evidence.proof.finalizedSnapshot).hash
        );
        if (
            !this.evidenceByKey.has(key) &&
            this.countSyncRecords(evidence.forkId) >= this.maxSyncRecordsPerFork
        ) {
            this.logger?.warn("Sync evidence refused: fork holds the maximum", {
                forkId: evidence.forkId,
                evidenceKey: key,
                maxSyncRecordsPerFork: this.maxSyncRecordsPerFork
            });
            return undefined;
        }
        this.evidenceByKey.set(key, evidence);
        return key;
    }

    public get(key: EvidenceKey): ProofEvidence | undefined {
        return this.evidenceByKey.get(key);
    }

    /** Every record (audit and sync) of `forkId`. */
    public getForkEvidence(forkId: ForkId): ProofEvidence[] {
        return [...this.evidenceByKey.values()].filter(
            (evidence) => evidence.forkId === forkId
        );
    }

    /** The audit records of `forkId`: sync records are left out. */
    public getForkAuditEvidence(forkId: ForkId): ProofEvidence[] {
        return [...this.evidenceByKey]
            .filter(
                ([key, evidence]) =>
                    !isSyncEvidenceKey(key) && evidence.forkId === forkId
            )
            .map(([, evidence]) => evidence);
    }

    /**
     * A snapshot some record holds (its anchor, a hop's snapshot, its final
     * point or its latest point) whose hash is `snapshotHash`.
     */
    public getSnapshot(snapshotHash: Hash): StateSnapshot | undefined {
        for (const { proof, latestSnapshot } of this.evidenceByKey.values()) {
            for (const struct of [
                proof.anchorSnapshot,
                ...proof.hops.map((hop) => hop.snapshot),
                proof.finalizedSnapshot,
                latestSnapshot
            ]) {
                const snapshot = StateSnapshot.from(struct);
                if (snapshot.hash === snapshotHash) return snapshot;
            }
        }
        return undefined;
    }

    /** A held state (final or latest, never `0x`) some record holds whose hash is `stateHash`. */
    public getStateMachineState(stateHash: Hash): Bytes | undefined {
        for (const {
            proof,
            encodedLatestState
        } of this.evidenceByKey.values()) {
            for (const state of [
                proof.encodedFinalizedState,
                encodedLatestState
            ]) {
                if (state !== "0x" && hash(state) === stateHash) return state;
            }
        }
        return undefined;
    }

    /**
     * Stops this peer's signing on `forkId`: the final history of a synced
     * proof kept as sync evidence kills this peer's own proof there. It is
     * never lifted on that fork; only `dropFork` clears it.
     */
    public stopSigning(forkId: ForkId): void {
        this.signingStoppedForkIds.add(forkId);
    }

    /** Whether a synced proof stopped this peer's signing on `forkId` (`stopSigning`). */
    public hasStoppedSigning(forkId: ForkId): boolean {
        return this.signingStoppedForkIds.has(forkId);
    }

    /** Drops every record (audit and sync) of `forkId` and its signing stop; other forks keep theirs. */
    public dropFork(forkId: ForkId): void {
        for (const [key, evidence] of this.evidenceByKey) {
            if (evidence.forkId === forkId) this.evidenceByKey.delete(key);
        }
        this.signingStoppedForkIds.delete(forkId);
    }

    private countSyncRecords(forkId: ForkId): number {
        let count = 0;
        for (const [key, evidence] of this.evidenceByKey) {
            if (isSyncEvidenceKey(key) && evidence.forkId === forkId) count++;
        }
        return count;
    }
}
