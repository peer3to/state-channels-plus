# test/unit/DisputeManagerLocalFirst.test.ts — Test Report

> **Test file:** [test/unit/DisputeManagerLocalFirst.test.ts](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeManager.ts](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite builds peer 0's own dispute with `fetchConstructedDispute` on a Math session and watches
the `isLastMilestoneFinalByEveryone` probe on both sides with a record-only mirror observer: the
local diamond's answers and failures, and the chain manager's reads, answers, failures and error
codes. The staged states are a late joiner whose head milestone still waits for its signature
(local "not final"), a plain three-peer start (both sides "final"), and
`stageMirrorMissingJoin`, which hides a chain join from the mirror so the mirror says "final" while
the chain says "not final". Failure injection makes the next local read revert inside the EVM or
fail as a transport error, or makes the next chain read fail as a transport error.

The oracles are `dispute.postedAuditingData`, the auditing-data hash committed in the dispute
input (it must equal the hash of the auditing data that was built), the observed local and chain
answers and read counts, and the error thrown by construction.

[`REQ-MIRROR-4-H9C4YS.T1.P4`](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys.t1.p4) is assigned to the mirror-missing-join test: a local "final" alone
never leaves the data out; the chain read decides, and when it says "not final" the data is
posted and committed. The remaining [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) permutations these tests touch (safe
answer without a chain read, revert falls back, executor failure propagates) are left for their
owning reports.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                  | Covers                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: DisputeManager.constructDispute local-first finality > local not final -> kept without a chain read, the auditing data is posted`](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts#L11) (line 11)                            | [`UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P10`](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-2-fb6g5r.p10)                                                                                                                 |
| [`Unit: DisputeManager.constructDispute local-first finality > local final, chain final -> one chain read, the auditing data is left out`](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts#L32) (line 32)                            | [`UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P13`](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-2-fb6g5r.p13)                                                                                                                 |
| [`Unit: DisputeManager.constructDispute local-first finality > mirror missing the join: local final, chain not final -> one chain read, the auditing data is posted`](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts#L48) (line 48) | [`UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P11`](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-2-fb6g5r.p11), [`REQ-MIRROR-4-H9C4YS.T1.P4`](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys.t1.p4) |
| [`Unit: DisputeManager.constructDispute local-first finality > local revert -> the chain answers final instead, the auditing data is left out`](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts#L68) (line 68)                       | [`UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P12`](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-2-fb6g5r.p12)                                                                                                                 |
| [`Unit: DisputeManager.constructDispute local-first finality > local executor failure (not a revert) -> construction throws it, no chain read`](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts#L90) (line 90)                       | [`UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P14`](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-2-fb6g5r.p14)                                                                                                                 |
| [`Unit: DisputeManager.constructDispute local-first finality > local final, chain RPC refuses the connection -> construction throws it`](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts#L114) (line 114)                            | [`UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P15`](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-2-fb6g5r.p15)                                                                                                                 |
