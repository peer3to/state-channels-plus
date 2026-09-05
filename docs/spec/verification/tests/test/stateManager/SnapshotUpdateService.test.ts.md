# test/stateManager/SnapshotUpdateService.test.ts — Test Report

> **Test file:** [test/stateManager/SnapshotUpdateService.test.ts](../../../../../../test/stateManager/SnapshotUpdateService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SnapshotUpdateService.ts](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the real `SnapshotUpdateService` instance inside each peer's worker realm via
`execOnHost`, against live channels staged by the harness (plain four-peer sessions, pre-dispute
setups with byzantine blocks, and full final-dispute resolutions). The oracles inspect the
prepared update itself: `canPost`, the calldata count, and — for the terminal case — the parsed
`updateStateSnapshotFork` transaction and its target fork. The cases cover the zero-generation
no-op on an undisputed fork, a successful `postStateSnapshotWait`, two admission gates (a current
dispute without a final reduced result blocks fork calldata; a same-fork snapshot that has not
consumed the on-chain inbound head blocks same-fork calldata), and a walk across two finalized
dispute windows that assembles exactly one terminal fork update targeting the second resolution's
fork. On-chain acceptance of the posted snapshot and outbound-range assembly details are out of
scope here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SnapshotUpdateService > returns an admissible no-op when the on-chain fork is not disputed`](../../../../../../test/stateManager/SnapshotUpdateService.test.ts#L7) (line 7)                       | [`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P4`](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md#unit-test-snapshot-update-service-1-a4b38n.p4)                                                                                                                                |
| [`SnapshotUpdateService > submits a prepared snapshot`](../../../../../../test/stateManager/SnapshotUpdateService.test.ts#L30) (line 30)                                                            | [`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P5`](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md#unit-test-snapshot-update-service-1-a4b38n.p5)                                                                                                                                |
| [`SnapshotUpdateService > blocks fork calldata while the current dispute has no final reduced result`](../../../../../../test/stateManager/SnapshotUpdateService.test.ts#L51) (line 51)             | [`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P6`](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md#unit-test-snapshot-update-service-1-a4b38n.p6)                                                                                                                                |
| [`SnapshotUpdateService > blocks same-fork calldata when its snapshot has not consumed the on-chain inbound head`](../../../../../../test/stateManager/SnapshotUpdateService.test.ts#L94) (line 94) | [`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P7`](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md#unit-test-snapshot-update-service-1-a4b38n.p7)                                                                                                                                |
| [`SnapshotUpdateService > walks two finalized dispute windows and prepares one terminal fork update`](../../../../../../test/stateManager/SnapshotUpdateService.test.ts#L135) (line 135)            | [`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P1`](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md#unit-test-snapshot-update-service-1-a4b38n.p1), [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P6`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p6) |
