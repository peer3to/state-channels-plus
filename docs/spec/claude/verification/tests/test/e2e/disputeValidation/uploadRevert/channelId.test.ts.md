# test/e2e/disputeValidation/uploadRevert/channelId.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/channelId.test.ts](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/channelId.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single upload-gate case driven at the on-chain manager boundary: after `preDisputeSetup`,
`postTamperedDispute` randomizes `dispute.input.channelId` and the harness asserts the upload
transaction reverts with the decoded custom error `ErrorCantParticipateInDispute` — the
sender is not an eligible participant of the claimed channel, so no dispute window is
created. Audit-side behavior is out of scope; the tampered dispute never reaches the
state-proof checks. The candidate permutations bundle scenarios this single revert cannot
cover in full: `UNIT-TEST-DISPUTE-MANAGER-FACET-1.P1` spans every upload gate,
`REQ-ENFDIS-2.T1.P4` pairs ineligible with slashed uploaders, and
`REQ-DISPUTE-PIPE-1.T1.P2` wants each wrong identity in turn — so no ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                     | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / uploadRevert / channelId > dispute.input.channelId = random → dispute upload fails → ErrorCantParticipateInDispute`](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/channelId.test.ts#L17) (line 17) | —      |
