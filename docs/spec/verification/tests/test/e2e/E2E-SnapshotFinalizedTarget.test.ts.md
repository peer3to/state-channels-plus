# E2E-SnapshotFinalizedTarget.test.ts — Test report

> **Test file:** [test/e2e/E2E-SnapshotFinalizedTarget.test.ts](../../../../../../test/e2e/E2E-SnapshotFinalizedTarget.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Posts the latest finalized snapshot despite later unfinalized progress. Checks no transaction for a non-advancing target, membership-hop overlap and synced observer reconstruction.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                                | Covers                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`E2E: Snapshot update to the finalized target > E20: a poster whose head block is unfinalized advances the chain only to its final point`](../../../../../../test/e2e/E2E-SnapshotFinalizedTarget.test.ts#L18) (line 18)                                                                       | [`REQ-SP-8-9ZCCEJ.T5.P1`](../../../../specification/disputes/state-proofs.md#req-sp-8-9zccej.t5.p1)   |
| [`E2E: Snapshot update to the finalized target > E20 (no progress): with only an unfinalized block above the chain anchor no update transaction is sent; once a newer point is final the update advances to it`](../../../../../../test/e2e/E2E-SnapshotFinalizedTarget.test.ts#L72) (line 72)  | [`REQ-SP-8-9ZCCEJ.T5.P2`](../../../../specification/disputes/state-proofs.md#req-sp-8-9zccej.t5.p2)   |
| [`E2E: Snapshot update to the finalized target > E20 (overlapping support): a later final point whose support run overlaps the change hop is the posted target, not the change block`](../../../../../../test/e2e/E2E-SnapshotFinalizedTarget.test.ts#L126) (line 126)                          | [`REQ-SP-8-9ZCCEJ.T5.P3`](../../../../specification/disputes/state-proofs.md#req-sp-8-9zccej.t5.p3)   |
| [`E2E: Snapshot update to the finalized target > E20 (overlapping proof): the chain verifies the overlapping proof; a sync-only observer persists the shared blocks once and reconstructs a chain-valid proof`](../../../../../../test/e2e/E2E-SnapshotFinalizedTarget.test.ts#L148) (line 148) | [`REQ-SP-10-JMVHTB.T6.P1`](../../../../specification/disputes/state-proofs.md#req-sp-10-jmvhtb.t6.p1) |
