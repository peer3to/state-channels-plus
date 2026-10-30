# SpectateService.test.ts

Test file: [test/unit/SpectateService.test.ts](../../../../../../test/unit/SpectateService.test.ts)
Exercises: [SpectateService.ts](../../../../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md), [EventSyncService.ts](../../../../implementation/source/src/stateManager/eventSync/EventSyncService.ts.md)

## Overview

The declarations drive the real SpectateService through request policy, proof verification and multi-peer synchronization. Pinned requests accept a minimum height or a verified successor; delayed-install cases hold the responder's VM write and verify both peers remain unblacklisted. An unprovable height retains mutual blacklist liability. A valid proof below the requested minimum is rejected.

The policy cases distinguish initial load from pinned recovery and preserve a synced observer on caller-owned recovery failure. Snapshot races accept already-landed state. Responder cases recover committed disputes missing locally, fail a request whose window the responder cannot read yet without blacklisting the requester (the requester takes one counted close), and prove the successor when local dispute events are suppressed. These are component scenarios through real collaborators, including the RPC boundary. The reduce-data failure runs on a spectator cut off before the window's reduced head: it reads the window from chain events, fails the request and stores no fraud proof. The inbound-run variant stays the named gap UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P10: `rpcStub.holdInboundMessageStorage` puts a responder's local diamond inbound head above its inbound storage, but a participant responder's audit of the window's disputes then fails on the same missing run before it stores them, so its window read fails first; a spectator responder, which persists disputes without auditing, is not yet staged.

The batching case records one finality call containing two predicates and the exact rejection reason `dispute window not linked`. Its two windows are identical, so it does not test result-index mapping; that belongs to distinct-window lineage scenarios.

The linkage cases take the responder's real one-window payload for a disputed fork while the chain stays on that fork. Setting the first window's fork to its own reduced fork, or appending the same window again, is rejected with only `dispute window not linked`; the unchanged payload is accepted with no rejection. Two late-payload cases take the payload while the chain is still on the disputed fork, then let the reduction land and the chain adopt the reduced fork before applying it. Unchanged, the adopted window is skipped: the sync is accepted with no rejection and the responder stays off the blacklist. With the window's reduced fork replaced by one the chain did not record, nothing is skipped and the sync is rejected with only `dispute window not linked`. Two historic rejection cases set the last milestone snapshot's height to the on-chain height (so another snapshot at that height) or one below it, and expect only `proof regresses the on-chain snapshot`.

The pinned-fork dispute case generates a payload that advances the fork, commits a dispute on that fork before the requester applies the pinned response, and asserts the historic verification accepts it with no recorded rejection and no blacklist. The historic-verification case posts a same-fork snapshot, advances two blocks, and applies a proof whose threshold is that on-chain snapshot, asserting acceptance with no rejection.
The same-fork snapshot case creates the requester before opening the four-participant channel. This keeps worker startup outside the block-zero deadline while preserving the isolated requester and the snapshot-before-validation oracle.

Six inbound cases stage the disputed window so that its reduce applies a top-up of peer 0. The requester's inbound storage write is held from before the top-up, so its local diamond applies the top-up but its inbound storage never holds it. When peer 0 has landed only the reduction on chain, so that the window is chain-final while the chain stays on the source fork, a payload whose inbound list carries an extra fabricated successor is still accepted. The requester then stores none of the listed blocks, and its inbound head stays where it was. The same holds when the requester's window fetch is held after its finality read, peer 0 lands the reduction on chain, and the fetch is released: the local reduction returns early, and nothing listed is stored. In the concurrent case the requester's sync of the forged payload is held after it persisted the window; a second sync of peer 0's genuine payload then reduces the window locally and is accepted. After release the forged sync is accepted too, the stored blocks are exactly the genuine served ones, and the inbound head is on the last of them, so the fabricated successor is never stored. When the window is not chain-final, the requester reduces it locally, accepts, and stores exactly the served inbound blocks, with its inbound head on the last one. If that local reduction gets the list with the fabricated successor, the local diamond reverts: the sync is rejected as a served reduction that reverts, nothing listed is stored, the inbound head stays and the local window stays unreduced. The last case points every dispute of the unreduced window at a fork with no dispute window and claims a fabricated reduced fork whose genesis hashes its own data, with no milestone and no outbound block. The sync is rejected as a dispute window mismatch before any local reduction; the responder is blacklisted, the requester stays on the source fork, its local window stays unreduced and no inbound block is stored.

Five cases check a window's other reduction inputs on the same staging. A window the requester reduces locally, served with an extra signature by a non-participant on every dispute confirmation, is accepted and none of those signatures is stored. In the chain-final, reduction-after-finality-read and concurrent cases, the payload carries an extra signature by a non-participant on every dispute confirmation, a confirmation of a dispute the chain never committed and a latest snapshot with another timestamp; the sync is accepted, and the requester's storage holds none of the extra signatures, no confirmation for the uncommitted dispute and no snapshot under the forged hash. In the last one the requester's whole dispute-log handler is held, so it handles none of the window's dispute logs; it syncs peer 0's genuine payload, stores none of the window's confirmations and moves to the reduced fork. Recovering the window's disputes afterwards returns every committed dispute from the chain's logs: the dispute handler skips the fork the requester left and never reads its audit predicate, and the recovery stores the chain's copy of each confirmation.

Four cases pin the requester's provider at the current block (its head and every `latest` read stay
there and its streamed logs above it are held), then land a held exit snapshot post that moves the
chain anchor, which the responder observes. In the first the provider catches up once the sync is
waiting on the payload's chain block and a real block is mined; the sync verifies the outbound run from the moved anchor and
accepts, with the responder kept. In the second the provider stays pinned; after one agreement window
the sync fails with no rejection recorded, and the responder is neither blacklisted nor disconnected.
The second also checks that the wait ran out its whole agreement window and that the requester
kept its old anchor. In the third the responder's provider is pinned too while another node keeps
streaming its logs, so its local diamond holds the moved anchor ahead of its head; the payload names
the streamed block and the requester waits for it, then accepts. In the fourth the requester's sync
service stops while the sync waits; the sync fails with no
rejection well before the agreement window ends.
One `applySyncResponse` case stubs the requester's local diamond so the unfinalized blocks of an honest payload start with a block whose bytes do not decode; the sync returns false and records only the "block confirmation rejected" reason, so neither the pipeline log nor the pipeline throws.

The genesis-timestamp cases mutate only the served genesis timestamp. A genesis-only payload before block zero, with one second added, is rejected as genesis timestamp mismatch, blacklists the responder and leaves the stored genesis equal to the on-chain one; the unaltered payload is accepted. A reduced-fork payload, with the chain still on the disputed fork, is rejected the same way and its altered genesis is not stored. With the chain snapshot already past genesis, a lagging spectator that holds the genesis accepts a proof whose genesis is one second later and keeps its held genesis. Taken before the chain kill period ends, with the requester's clock held ahead so its local mirror already sees the window expired, the same successor gets no verdict: the sync is not accepted, names the origin window as unsettled, records no rejection and keeps the responder off the blacklist. With block 0's snapshot on chain (height 0 but not a genesis), an unaltered payload is accepted.

Two install cases stage a reducible disputed fork and sync an observer onto the successor. In the first, a read inside the install throws after the VM write: the sync throws, the VM keeps its state, the successor genesis is not stored and the fork stays. In the second, the install is held at its entry while a successor block authored after the payload was served waits in the observer's queue; its held queue timeout runs inside that window, sees an unknown fork (not a known stale one) and probes its source, and after the install the block is stored on the successor without a blacklist.

The unreduced-window cases have peer 0 serve peer 2 a real latest-state payload around a valid
self-removal dispute by peer 1. A payload carrying the window in its kill period, the same payload
applied by a peer 2 whose `DisputeCommitted` events are held (its local diamond gets the window only
from the sync's own chain fetch), one served before the dispute and applied after it commits, and
one applied after the kill period with every reduction held, return not synced naming the window,
with no recorded rejection and no blacklist. A payload with a fabricated window for the undisputed
on-chain fork is rejected as `dispute window not on chain`, and one older than the chain's
reduction (served before the dispute, applied after `reduceWindowOnChain`) is rejected as
`latest fork is disputed`; both blacklist peer 0. The last case blacklists an honest payload under
the current stale-response policy.

Five cases pin the chain as the judge and the wait itself. A reduction landed between the
finality read and the window fetch makes the local recomputation of a payload claiming another
successor revert on a reduced window: rejected as `served reduction reverts`. With the applied
outcome held before the sync acts on it (`stubHoldSpectateSyncApplication` with `holdAfterApply`),
the window is reduced while nothing listens; after release the responder answers a second request
and the sync returns true with the requester on the chain's reduced fork, so the wait ended on its
own chain read. When the wait's `getReducedResult` read fails (`stubFailChainReads`), the sync
rejects with that error, the responder is neither asked again nor blacklisted, and `stop` resolves.
Reductions of another fork's window and of this fork in another channel, emitted on the requester's
event bus while it waits, leave the responder at one request; the chain's own reduction then
brings the second request and the sync returns true. Disposing the service while the applied
outcome is held, before the wait starts, makes the sync return false at once with one request and no
blacklist.

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
- `one still-syncing answer shared by a plain sync and three block-source syncs gives one counted close and no blacklist`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P116, REQ-SPC-3-AZBKR1.T1.P10
- `one sync request supports initial load and exact recovery`: INV-SYNC-2-AT3RXE.T1.P1
- `exact recovery failure preserves a synced observer runtime`: INV-SYNC-3-A7A2ED.T1.P4
- `a dispute opens on the pinned fork after the proof was served → accepted, responder neither rejected nor blacklisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P28
- `the same-fork target snapshot lands before validation → accepts the proof`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P13, UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P8, INV-SYNC-2-AT3RXE.T1.P3
- `a last-milestone block whose bytes do not decode → milestones invalid, the sync does not throw`: none
- `on-chain snapshot ahead of the payload genesis on the same fork → milestones and the latest-fork outbound run verified from it, accepted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P34
- `requester's provider behind the responder's after a snapshot post → the sync waits until its chain head reaches the payload's chain block, then verifies from the moved anchor and accepts; responder kept`: INV-SYNC-2-AT3RXE.T1.P4, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P117
- `requester's provider stays behind the payload's chain block for one agreement window → not synced with no verdict: no rejection, responder neither blacklisted nor cut`: INV-SYNC-3-A7A2ED.T1.P34, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P118
- `responder's own provider lags the logs another node streamed into its local diamond → the payload names the streamed block, the lagging requester waits for it and accepts; responder kept`: INV-SYNC-2-AT3RXE.T1.P5, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P120
- `requester's sync service stops while it waits for its chain head → not synced at once with no verdict, before the agreement window ends`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P119
- `a milestone prepended wholly below the on-chain anchor carrying a snapshot above it → sync accepted, neither its block nor the snapshot is stored`: none
- `milestone snapshot at the requester's own finalized point altered → accepted from that point, the altered snapshot is not stored`: none
- `every milestone below the on-chain anchor with a forged newer snapshot → rejected, milestones invalid`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P33
- `outbound block above the on-chain anchor forged → rejected, latest-fork outbound blocks invalid`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P31
- `served window still in its kill period → not accepted, no verdict naming the window, responder not blacklisted`: REQ-SYNC-4-AWHFPA.T1.P1
- `served window in its kill period the requester has not applied → not accepted, no verdict naming the window, responder not blacklisted`: REQ-SYNC-4-AWHFPA.T1.P6
- `served window the chain does not hold → rejected, dispute window not on chain`: REQ-SYNC-4-AWHFPA.T1.P2
- `dispute opens on the latest fork after the payload was served → not accepted, no verdict naming the window, responder not blacklisted`: REQ-SYNC-4-AWHFPA.T1.P3
- `payload older than the latest fork's reduction, its reduced window missing → rejected, latest fork is disputed`: REQ-SYNC-4-AWHFPA.T1.P4
- `dispute opens on the latest fork after the payload was served, its kill period over but the chain has not reduced it → not accepted, no verdict naming the window, responder not blacklisted`: REQ-SYNC-4-AWHFPA.T1.P17
- `the chain reduces the served window between the finality read and the window fetch, the payload claiming another successor → local reduction reverts on the reduced window, rejected, served reduction reverts`: REQ-SYNC-4-AWHFPA.T1.P16
- `the chain reduces the window after the sync read it but before the sync waits → the wait ends on its chain read, the same peer is asked again and the sync succeeds`: REQ-SYNC-4-AWHFPA.T1.P18
- `the wait's chain read fails → the sync rejects with the read's error, the responder is neither blacklisted nor asked again, stop resolves`: REQ-SYNC-4-AWHFPA.T1.P20
- `the service is disposed after the sync applied its answer but before it waits → the sync returns false without waiting, the responder is asked once and not blacklisted`: REQ-SYNC-4-AWHFPA.T1.P22
- `reductions of another window and of another channel while the sync waits → ignored: the responder is asked again only after the chain reduces the served window`: REQ-SYNC-4-AWHFPA.T1.P21
- `first dispute window not on the on-chain fork → rejected, dispute window not linked`: INV-SYNC-1-XCQZ28.T1.P7, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P36
- `second dispute window not continuing from the first reduced fork → rejected, dispute window not linked`: INV-SYNC-1-XCQZ28.T1.P8, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P37
- `payload served before the chain adopted its window's reduced fork → prefix skipped, accepted, responder not blacklisted`: INV-SYNC-1-XCQZ28.T1.P9, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P39
- `adopted prefix window claiming a reduced fork the chain did not record → rejected, dispute window not linked`: INV-SYNC-1-XCQZ28.T1.P10, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P40
- `single dispute window starting at the on-chain fork → accepted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P38
- `chain-final unadopted window with a fabricated inbound successor → accepted, no window inbound block stored, inbound head unchanged`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P93
- `window reduced locally during sync → accepted, its inbound blocks stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P94
- `window the chain has not reduced, reduced locally during sync with a fabricated inbound successor → local reduction reverts, no verdict naming the window, no window inbound block stored, inbound head unchanged`: REQ-SYNC-4-AWHFPA.T1.P15, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P97
- `unreduced window whose disputes name a fork without a window, claiming a fabricated self-consistent reduced fork → rejected as a dispute window mismatch, responder blacklisted, nothing persisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P98, INV-SYNC-1-XCQZ28.T1.P15
- `unreduced window whose disputes name the window's fork under another channel, claiming a fabricated self-consistent reduced fork → rejected as a dispute window mismatch, responder blacklisted, nothing persisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P99, INV-SYNC-1-XCQZ28.T1.P16
- `reduction lands on chain after the finality read and before the window fetch, with a fabricated inbound successor → accepted, no window inbound block stored, inbound head unchanged`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P95
- `window already reduced locally by a concurrent sync, with a fabricated inbound successor → accepted, only the concurrent sync's genuine inbound blocks stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P96
- `window reduced locally during sync, with forged confirmation signatures → accepted, no forged signature stored`: INV-SYNC-1-XCQZ28.T1.P20, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P110
- `chain-final unadopted window with forged confirmation signatures, an uncommitted dispute and a forged window snapshot → accepted, none of them stored`: INV-SYNC-1-XCQZ28.T1.P18, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P111
- `reduction lands on chain after the finality read and before the window fetch, with forged confirmation signatures, an uncommitted dispute and a forged window snapshot → accepted, none of them stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P112
- `window already reduced locally by a concurrent sync, with forged confirmation signatures, an uncommitted dispute and a forged window snapshot → accepted, none of them stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P113
- `chain-final unadopted window synced by a requester that handled none of its dispute logs → the sync stores no confirmation, and the requester, now on the reduced fork, recovers every window dispute from chain logs without auditing`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P25
- `committed dispute missing locally → recovers before generating the payload`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P9
- `reduce data unavailable for a disputed window → the request fails, no fraud proof stored`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P11
- `dispute window unavailable → the request fails, the requester is not blacklisted`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P6, REQ-SPC-3-AZBKR1.T1.P7
- `all dispute events suppressed → recovers and proves the successor fork`: none
- `genesis-only payload before block zero with only the timestamp changed → rejected, genesis timestamp mismatch, responder blacklisted, altered genesis not stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P121
- `genesis-only payload before block zero matching the on-chain genesis → accepted, responder not blacklisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P122
- `reduced-fork genesis with only the timestamp changed → rejected, genesis timestamp mismatch, altered genesis not stored`: INV-SYNC-1-XCQZ28.T1.P13, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P123
- `chain past genesis on the same fork, lagging requester, genesis with only the timestamp changed → accepted, the held genesis is kept`: INV-SYNC-1-XCQZ28.T1.P22, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P125
- `successor genesis applied while the chain has not yet expired its origin window → not synced with no verdict, the origin window named unsettled, responder not blacklisted, not stored`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P124
- `block 0's snapshot on chain, height 0 but not a genesis, unaltered payload → accepted, no rejection, responder not blacklisted`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P126
- `genesis-case window snapshot with only the timestamp changed → rejected, window genesis timestamp mismatch, responder blacklisted, the held genesis is kept`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P127
- `genesis-case window snapshot unaltered → accepted, responder not blacklisted, the genesis stays the genuine one`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P128
- `genesis-case window applied while the chain has not yet expired its kill period → not synced with no verdict, the window named unsettled, responder not blacklisted, the held genesis is kept`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P129
