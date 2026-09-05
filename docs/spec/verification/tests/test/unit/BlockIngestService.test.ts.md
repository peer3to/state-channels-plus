# test/unit/BlockIngestService.test.ts — Test Report

> **Test file:** [test/unit/BlockIngestService.test.ts](../../../../../../test/unit/BlockIngestService.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [BlockIngestService.ts](../../../../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the ingest boundary with real confirmations from a teleported session: stale-fork
recognition (current fork, zero hash, invented fork, the fork left behind by a dispute, non-current forks
known through a genesis snapshot or a held block), an already stored block confirmed twice, the on-chain
timestamp recorded on the stored block, a sourceless bad confirmation, carried inbound message runs that
advance or hold the store head, and the reject paths of the full pipeline. The mapped timestamp case waits
for the store to hold the timestamp instead of reading the block right after the confirmation returns:
the ingest reply lands before the store write, so an immediate read raced the recording. Oracles are the
queue storage, the stored block's timestamp, the peer cut set, and the harness hooks.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                           | Covers                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: BlockIngestService > isKnownStaleFork > current fork, zero hash and an invented fork → all not stale`](../../../../../../test/unit/BlockIngestService.test.ts#L61) (line 61)                                                                       | —                                                                                                                                                             |
| [`Unit: BlockIngestService > isKnownStaleFork > the fork we left behind after a dispute → stale`](../../../../../../test/unit/BlockIngestService.test.ts#L91) (line 91)                                                                                    | —                                                                                                                                                             |
| [`Unit: BlockIngestService > isKnownStaleFork > a non-current fork whose genesis snapshot we hold → stale`](../../../../../../test/unit/BlockIngestService.test.ts#L111) (line 111)                                                                        | —                                                                                                                                                             |
| [`Unit: BlockIngestService > isKnownStaleFork > a non-current fork we hold a block of → stale`](../../../../../../test/unit/BlockIngestService.test.ts#L153) (line 153)                                                                                    | —                                                                                                                                                             |
| [`Unit: BlockIngestService > onBlockConfirmation → an already stored block > the same confirmation ingested twice → accepted, signatures unchanged`](../../../../../../test/unit/BlockIngestService.test.ts#L206) (line 206)                               | —                                                                                                                                                             |
| [`Unit: BlockIngestService > onBlockConfirmation → an already stored block > a confirmation carrying an on-chain timestamp → the stored block records it`](../../../../../../test/unit/BlockIngestService.test.ts#L252) (line 252)                         | [`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P2`](../../../../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md#unit-test-block-ingest-1-jv64as.p2) |
| [`Unit: BlockIngestService > onBlockConfirmationStruct > a sourceless bad confirmation → rejected without cutting any peer`](../../../../../../test/unit/BlockIngestService.test.ts#L308) (line 308)                                                       | —                                                                                                                                                             |
| [`Unit: BlockIngestService > onBlockConfirmation → carried inbound message blocks > a run linked to a held inbound block → the store head advances with the snapshot`](../../../../../../test/unit/BlockIngestService.test.ts#L356) (line 356)             | —                                                                                                                                                             |
| [`Unit: BlockIngestService > onBlockConfirmation → carried inbound message blocks > runs with no reachable ancestor → persisted, the head never moves above the gap`](../../../../../../test/unit/BlockIngestService.test.ts#L411) (line 411)              | —                                                                                                                                                             |
| [`Unit: BlockIngestService > onBlockConfirmation → reject paths (full pipeline probe) > a linked writer block with a wrong snapshot hash → invalid transition, VM turn restored`](../../../../../../test/unit/BlockIngestService.test.ts#L505) (line 505)  | —                                                                                                                                                             |
| [`Unit: BlockIngestService > onBlockConfirmation → reject paths (full pipeline probe) > a forged inbound message block → forged hook fires, block rejected`](../../../../../../test/unit/BlockIngestService.test.ts#L541) (line 541)                       | —                                                                                                                                                             |
| [`Unit: BlockIngestService > onBlockConfirmation → reject paths (full pipeline probe) > a rejected block carrying a real inbound run → the run is not stored, the head stays put`](../../../../../../test/unit/BlockIngestService.test.ts#L618) (line 618) | —                                                                                                                                                             |
