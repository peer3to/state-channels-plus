# E2E-SnapshotFinalizedTarget.test.ts

Test file: [test/e2e/E2E-SnapshotFinalizedTarget.test.ts](../../../../../../test/e2e/E2E-SnapshotFinalizedTarget.test.ts)

## Overview

Posts the latest finalized snapshot despite later unfinalized progress. Checks no transaction for a non-advancing target, membership-hop overlap and synced observer reconstruction.

## Tests

- `E20: a poster whose head block is unfinalized advances the chain only to its final point`: REQ-SP-8-9ZCCEJ.T5.P1
- `E20 (no progress): with only an unfinalized block above the chain anchor no update transaction is sent; once a newer point is final the update advances to it`: REQ-SP-8-9ZCCEJ.T5.P2
- `E20 (overlapping support): a later final point whose support run overlaps the change hop is the posted target, not the change block`: REQ-SP-8-9ZCCEJ.T5.P3
- `E20 (overlapping proof): the chain verifies the overlapping proof; a sync-only observer persists the shared blocks once and reconstructs a chain-valid proof`: REQ-SP-10-JMVHTB.T6.P1
