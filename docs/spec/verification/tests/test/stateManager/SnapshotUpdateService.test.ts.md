# SnapshotUpdateService.test.ts

Test file: [test/stateManager/SnapshotUpdateService.test.ts](../../../../../../test/stateManager/SnapshotUpdateService.test.ts)
Exercises: [SnapshotUpdateService.ts](../../../../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md)

## Overview

The suite drives the real `SnapshotUpdateService` instance inside each peer's worker realm via
`execOnHost`, against live channels staged by the harness (plain four-peer sessions, pre-dispute
setups with byzantine blocks, and full final-dispute resolutions). The oracles inspect the
prepared update itself: `canPost`, the calldata count, and — for the terminal case — the parsed
`updateStateSnapshotFork` transaction and its target fork. The cases cover the zero-generation
no-op on an undisputed fork, a `postStateSnapshotWait` that resolves `true` and changes the on-chain snapshot, a post
held at its send while a dispute commits that resolves `false` with the chain's disputed-fork refusal, two admission gates (a current
dispute without a final reduced result blocks fork calldata; a same-fork snapshot that has not
consumed the on-chain inbound head blocks same-fork calldata), and a walk across two finalized
dispute windows that assembles exactly one terminal fork update targeting the second resolution's
fork. On-chain acceptance of the posted snapshot and outbound-range assembly details are out of
scope here.

## Tests

- `returns an admissible no-op when the on-chain fork is not disputed`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P4
- `submits a prepared snapshot`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P5
- `resolves false when a dispute commits between preparation and send`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P9
- `blocks fork calldata while the current dispute has no final reduced result`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P6
- `blocks same-fork calldata when its snapshot has not consumed the on-chain inbound head`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P7
- `walks two finalized dispute windows and prepares one terminal fork update`: UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P1, REQ-DISPUTE-PIPE-6-6FZB9M.T1.P6
