import type { BlockHeight, ForkId, Hash } from "@/types/types";

export type CoordinateKey = string;

/** `dispute:<disputeHash>` (audit evidence) or `sync:<finalizedSnapshotHash>` (sync evidence) */
export type EvidenceKey = string;

const AUDIT_EVIDENCE_PREFIX = "dispute:";
const SYNC_EVIDENCE_PREFIX = "sync:";

export function coordinateKey(
    forkId: ForkId,
    height: BlockHeight
): CoordinateKey {
    return `${forkId}:${height}`;
}

export function auditEvidenceKey(disputeHash: Hash): EvidenceKey {
    return `${AUDIT_EVIDENCE_PREFIX}${disputeHash}`;
}

export function syncEvidenceKey(finalizedSnapshotHash: Hash): EvidenceKey {
    return `${SYNC_EVIDENCE_PREFIX}${finalizedSnapshotHash}`;
}

export function isSyncEvidenceKey(key: EvidenceKey): boolean {
    return key.startsWith(SYNC_EVIDENCE_PREFIX);
}
