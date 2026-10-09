# SpectateService.test.ts

Test file: [test/unit/SpectateService.test.ts](../../../../../../test/unit/SpectateService.test.ts)
Exercises: [SpectateService.ts](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md)

## Overview

The declarations drive the real SpectateService through request policy, proof verification and multi-peer synchronization. Pinned requests accept a minimum height or a verified successor; delayed-install cases hold the responder's VM write and verify both peers remain unblacklisted. An unprovable height retains mutual blacklist liability. A valid proof below the requested minimum is rejected.

The policy cases distinguish initial load from pinned recovery and preserve a synced observer on caller-owned recovery failure. Snapshot races accept already-landed state. Responder cases recover committed disputes missing locally, refuse an unreadable window, and prove the successor when local dispute events are suppressed. These are component scenarios through real collaborators, including the RPC boundary.

The batching case records one finality call containing two predicates and the exact rejection reason `dispute window not linked`. Its two windows are identical, so it does not test result-index mapping; that belongs to distinct-window lineage scenarios.

The linkage cases take the responder's real one-window payload for a disputed fork while the chain stays on that fork. Setting the first window's fork to its own reduced fork, or appending the same window again, is rejected with only `dispute window not linked`; the unchanged payload is accepted with no rejection. Two late-payload cases take the payload while the chain is still on the disputed fork, then let the reduction land and the chain adopt the reduced fork before applying it. Unchanged, the adopted window is skipped: the sync is accepted with no rejection and the responder stays off the blacklist. With the window's reduced fork replaced by one the chain did not record, nothing is skipped and the sync is rejected with only `dispute window not linked`. Two historic rejection cases set the last milestone snapshot's height to the on-chain height (so another snapshot at that height) or one below it, and expect only `proof regresses the on-chain snapshot`.

The pinned-fork dispute case generates a payload that advances the fork, commits a dispute on that fork before the requester applies the pinned response, and asserts the historic verification accepts it with no recorded rejection and no blacklist. The historic-verification case posts a same-fork snapshot, advances two blocks, and applies a proof whose threshold is that on-chain snapshot, asserting acceptance with no rejection.
The same-fork snapshot case creates the requester before opening the four-participant channel. This keeps worker startup outside the block-zero deadline while preserving the isolated requester and the snapshot-before-validation oracle.

Six inbound cases stage the disputed window so that its reduce applies a top-up of peer 0. The requester's inbound storage write is held from before the top-up, so its local diamond applies the top-up but its inbound storage never holds it. When peer 0 has landed only the reduction on chain, so that the window is chain-final while the chain stays on the source fork, a payload whose inbound list carries an extra fabricated successor is still accepted. The requester then stores none of the listed blocks, and its inbound head stays where it was. The same holds when the requester's window fetch is held after its finality read, peer 0 lands the reduction on chain, and the fetch is released: the local reduction returns early, and nothing listed is stored. In the concurrent case the requester's sync of the forged payload is held after it persisted the window; a second sync of peer 0's genuine payload then reduces the window locally and is accepted. After release the forged sync is accepted too, the stored blocks are exactly the genuine served ones, and the inbound head is on the last of them, so the fabricated successor is never stored. When the window is not chain-final, the requester reduces it locally, accepts, and stores exactly the served inbound blocks, with its inbound head on the last one. If that local reduction gets the list with the fabricated successor, the local diamond reverts: the sync is rejected as a served reduction that reverts, nothing listed is stored, the inbound head stays and the local window stays unreduced. The last case points every dispute of the unreduced window at a fork with no dispute window and claims a fabricated reduced fork whose genesis hashes its own data, with no milestone and no outbound block. The sync is rejected as a dispute window mismatch before any local reduction; the responder is blacklisted, the requester stays on the source fork, its local window stays unreduced and no inbound block is stored.

One `applySyncResponse` case stubs the requester's local diamond so the unfinalized blocks of an honest payload start with a block whose bytes do not decode; the sync returns false and records only the "block confirmation rejected" reason, so neither the pipeline log nor the pipeline throws.

Two install cases stage a reducible disputed fork and sync an observer onto the successor. In the first, a read inside the install throws after the VM write: the sync throws, the VM keeps its state, the successor genesis is not stored and the fork stays. In the second, the install is held at its entry while a successor block authored after the payload was served waits in the observer's queue; its held queue timeout runs inside that window, sees an unknown fork (not a known stale one) and probes its source, and after the install the block is stored on the successor without a blacklist.

## Tests

- `concurrent identical sync requests share the completed result`: none
- `a higher in-flight sync satisfies a lower requested height`: none
- `a higher requested height waits then runs its own pinned sync`: none
- `concurrent sync callers both receive a completed proof failure`: none
- `concurrent source syncs accept when a second persist overwrites the first reduction`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P24
- `sync batches finality reads for two supplied windows before rejection`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P25
- `old-fork sync succeeds while successor installation is held without either blacklist`: REQ-SYNC-1-T2589H.T1.P10
- `successor sync succeeds before its genesis is installed without either blacklist`: REQ-SYNC-1-T2589H.T1.P11
- `a successor sync whose install read fails after the VM write → throws, the VM is restored, nothing of the payload is stored, the fork stays`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P102
- `a successor block's queue timeout running while the sync install is held → the fork is unknown, not known stale: the block is probed, then stored on the successor`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P103
- `pinned sync serves the exact current height`: REQ-SYNC-1-T2589H.T1.P12
- `pinned sync serves a newer proof than the requested height`: REQ-SYNC-1-T2589H.T1.P13
- `pinned sync refuses a height above the available proof`: REQ-SYNC-1-T2589H.T1.P14
- `pinned sync rejects a valid proof below the requested minimum`: REQ-SYNC-1-T2589H.T1.P15
- `concurrent proof application does not mistake local reduction for chain finality`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P21
- `sync accepts a reduction landing after its chain window was persisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P22
- `plain pinned sync accepts a proved successor of the requested fork`: REQ-SYNC-1-T2589H.T1.P9, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P19
- `plain pinned sync refuses an unknown fork`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P20
- `one sync request supports initial load and exact recovery`: INV-SYNC-2-AT3RXE.T1.P1
- `exact recovery failure preserves a synced observer runtime`: INV-SYNC-3-A7A2ED.T1.P4
- `a dispute opens on the pinned fork after the proof was served → accepted, responder neither rejected nor blacklisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P28
- `the same-fork target snapshot lands before validation → accepts the proof`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P13, UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P8, REQ-SPC-1-H10R5K.T1.P6
- `a last-milestone block whose bytes do not decode → milestones invalid, the sync does not throw`: none
- `on-chain snapshot ahead of the payload genesis on the same fork → milestones and the latest-fork outbound run verified from it, accepted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P34
- `a milestone prepended wholly below the on-chain anchor carrying a snapshot above it → sync accepted, neither its block nor the snapshot is stored`: none
- `milestone snapshot at the requester's own finalized point altered → accepted from that point, the altered snapshot is not stored`: none
- `every milestone below the on-chain anchor with a forged newer snapshot → rejected, milestones invalid`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P33
- `outbound block above the on-chain anchor forged → rejected, latest-fork outbound blocks invalid`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P31
- `first dispute window not on the on-chain fork → rejected, dispute window not linked`: INV-SYNC-1-XCQZ28.T1.P7, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P36
- `second dispute window not continuing from the first reduced fork → rejected, dispute window not linked`: INV-SYNC-1-XCQZ28.T1.P8, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P37
- `payload served before the chain adopted its window's reduced fork → prefix skipped, accepted, responder not blacklisted`: INV-SYNC-1-XCQZ28.T1.P9, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P39
- `adopted prefix window claiming a reduced fork the chain did not record → rejected, dispute window not linked`: INV-SYNC-1-XCQZ28.T1.P10, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P40
- `single dispute window starting at the on-chain fork → accepted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P38
- `chain-final unadopted window with a fabricated inbound successor → accepted, no window inbound block stored, inbound head unchanged`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P93
- `window reduced locally during sync → accepted, its inbound blocks stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P94
- `window reduced locally during sync with a fabricated inbound successor → local reduction reverts, rejected, no window inbound block stored, inbound head unchanged`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P97
- `unreduced window whose disputes name a fork without a window, claiming a fabricated self-consistent reduced fork → rejected as a dispute window mismatch, responder blacklisted, nothing persisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P98, INV-SYNC-1-XCQZ28.T1.P15
- `unreduced window whose disputes name the window's fork under another channel, claiming a fabricated self-consistent reduced fork → rejected as a dispute window mismatch, responder blacklisted, nothing persisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P99, INV-SYNC-1-XCQZ28.T1.P16
- `reduction lands on chain after the finality read and before the window fetch, with a fabricated inbound successor → accepted, no window inbound block stored, inbound head unchanged`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P95
- `window already reduced locally by a concurrent sync, with a fabricated inbound successor → accepted, only the concurrent sync's genuine inbound blocks stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P96
- `committed dispute missing locally → recovers before generating the payload`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P9
- `reduce data unavailable for a disputed window → payload refused (needs a mirror ahead of storage)`: none
- `dispute window unavailable → payload refused, no throw`: none
- `all dispute events suppressed → recovers and proves the successor fork`: none
