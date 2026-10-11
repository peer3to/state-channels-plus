# SnapshotUpdateService.test.ts

Test file: [test/stateManager/SnapshotUpdateService.test.ts](../../../../../../test/stateManager/SnapshotUpdateService.test.ts)
Exercises: [SnapshotUpdateService.ts](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md)

## Overview

The suite drives the real `SnapshotUpdateService` instance inside each peer's worker realm via
`execOnHost`, against live channels staged by the harness (plain four-peer sessions, pre-dispute
setups with byzantine blocks, and full final-dispute resolutions). The oracles inspect the
prepared update itself: `canPost`, the calldata count, and — for the terminal case — the parsed
`updateStateSnapshotFork` transaction and its target fork. The cases cover the zero-generation
no-op on an undisputed fork, a `postStateSnapshotWait` that resolves and changes the on-chain snapshot, a mined post whose returned snapshot (decoded from the host) has the chain's new snapshot hash and the chain snapshot's participants, a post
held at its send while a dispute commits that rejects with the chain's disputed-fork refusal, an admission gate (a current
dispute without a final reduced result blocks fork calldata, and the post resolves `undefined`), a same-fork post whose snapshot has not
consumed the on-chain inbound head that rejects with the chain's pending-inbound refusal and changes no snapshot, and a walk across two finalized
dispute windows that assembles exactly one terminal fork update targeting the second resolution's
fork. On-chain acceptance of the posted snapshot and outbound-range assembly details are out of
scope here.

## Tests

- `returns an admissible no-op when the on-chain fork is not disputed`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P4
- `submits a prepared snapshot`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P5
- `a mined post resolves with the snapshot the chain now holds`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P19
- `rejects with the disputed-fork refusal when a dispute commits between preparation and send`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P9
- `blocks fork calldata while the current dispute has no final reduced result`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P6, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P20
- `a same-fork post whose snapshot has not consumed the on-chain inbound head reverts with the pending-inbound refusal`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P7
- `walks two finalized dispute windows and prepares one terminal fork update`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P1, REQ-DISPUTE-PIPE-6-6FZB9M.T1.P6
