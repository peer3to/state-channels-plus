# E2E-EvidenceComparison.test.ts

Test file: [E2E-EvidenceComparison.test.ts](../../../../../../test/e2e/E2E-EvidenceComparison.test.ts)
Exercises: [DisputeManager.ts.md](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md)

## Overview

One four-peer scenario (`stageEvidenceAuditAfterKill`). Every peer holds its reduction timers.
A spam dispute opens the window and is audited invalid everywhere, with kills held back; the
auditor (peer 3, dispute initiation suppressed) records its evidence comparisons with the
record-only probe on `DisputeManager.shouldAddOwnEvidence` and the `constructDispute` calls
inside it. Peer 2 adds a state-only dispute: the auditor audits it
valid, compares once, finds nothing to add, and keeps that answer. The auditor then stores a real
fraud proof against peer 0 or 2 (whichever is not the next writer), so its own dispute would now
apply a slash the window lacks. Peer 2 kills
the spam dispute, the auditor's dispute initiation is restored, and peer 0 adds one more dispute —
the first audit after the kill.

Oracles: the failed audit of the spam dispute recorded no comparison; the audit before the kill
recorded one; after the kill the auditor's dispute is initiated, a second comparison is recorded,
and peer 0 observes the auditor's own `DisputeCommitted` listing the offender's slash. Without the kill
invalidation (`EventHandler.onDisputeKilled` calls `DisputeManager.clearCache`) the
cached negative answer would suppress that upload.

## Tests

- `a killed dispute drops the cached comparison: the next audit compares again and the non-disputer uploads its added evidence`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P6, REQ-DISPUTE-PIPE-6-6FZB9M.T1.P8
