# E2E-BlockQueueManager.test.ts

Test file: [test/e2e/E2E-BlockQueueManager.test.ts](../../../../../../test/e2e/E2E-BlockQueueManager.test.ts)

## Overview

The suite exercises `BlockQueueManager` on real running sessions — real blocks, real signatures,
live collaborators — poking the component host-side through the harness control RPC
(`ingestBlockConfirmationWait`, `execOnHost`, query/byzantine/rpcStub services). It covers the
ingest guards (forged author signature, author signatures in contract-rejected encodings,
wrong-channel block, outsider-authored block), the
queue-timeout expiry branches (future-block eviction without punishment, queued-entry merge into a
stored block with strays stripped and the supplier blacklisted, unknown-fork probe that asks both
supplier and author to sync and punishes through the failed sync), the wrong-fork recovery paths
(local reduction at ingest when the current fork is disputed, quarantine-for-sync of unknown
forks, queue drain after a fork transition), the `wrongGenesisDetected` strategy fallback with and
without a genesis snapshot, the stale-fork entry gates, and the queue-timeout window arithmetic.
The allowance and stored-copy quota cases overflow a supplier's allowance with distinct nonce
signatures by the supplier's own key, check the bounded retention, and expect the supplier's
blacklist as a double signer.
Oracles are storage/queue/blacklist/connection state read over the query RPC, event-spy counts
(`onSetState`, dispute events), recorded rpc-stub call counts and targets, and — in the host-side
unit-scope tests — captured scheduler calls and strategy return values. The validation predicate
chain itself is out of scope (owned by `test/unit/ValidationService.test.ts`), as is on-chain
dispute adjudication. The formerly bundled permutations are now split into one-scenario IDs, so
the expiry branches this suite demonstrates are assigned per test; expiry branches the suite
does not reach (`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P1` gate order, `.P3` generic drop, `.P4`
stale-fork silent drop at expiry, `.P5` own-fork coalescing, `.P7` schedule branch) stay
unassigned.
The signature-encoding case holds back an author's next block (stubbed broadcast), then feeds the
observer that block with each contract-rejected re-encoding of the author's real signature from
`SignatureEncodingFixture`, relayed by a third peer. Every copy returns `keepConnection` false
(the authenticity-failure outcome: the supplier is cut) and the block stays out of storage, so it is
neither committed nor countersigned. The same bytes with the canonical signature are then
committed, and the stored block carries the observer's countersignature — the positive control
that the refusals were about the encoding only.
The first test (`known slashes reject network contributions even when slash log recovery fails`)
runs the shared `assertSlashAdmission("failed-recovery")` helper; no permutation is assigned to it
yet.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

The spectator drain case holds a fresh spectator's sync with the channel tip in its payload and
suppresses its queue timeouts; a copy of the tip is ingested and the next block reaches the spectator
by the participants' gossip. Once the sync stores the tip, the spectator must apply the gossiped block.

## Tests

- `known slashes reject network contributions even when slash log recovery fails`: none
- `a sender absent after membership refresh failure uses ordinary network sync`: REQ-GOSSIP-4-J5Z4DF.T1.P32, REQ-GOSSIP-4-J5Z4DF.T1.P37
- `an existing sync handles an unknown-source copy without another wire request`: REQ-GOSSIP-4-J5Z4DF.T1.P30, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P24, REQ-GOSSIP-4-J5Z4DF.T1.P36
- `failed ingress sync blacklists its sender without queueing the triggering block`: REQ-GOSSIP-4-J5Z4DF.T1.P29, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P25
- `a real slash rejects the next supplier copy without changing held honest work`: REQ-GOSSIP-4-J5Z4DF.T1.P4, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P3
- `stored network copies are bounded before each ordinary merge`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P22
- `one supplier's valid signature variants cannot spend another participant's allowance`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P6, REQ-ID-5-GW1ZEY.T1.P18
- `observed slash removes cached eligibility before the next stored network copy`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P7
- `an authoritative slash refresh discards a cache-miss copy without sync`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P8
- `a pending join cache miss refreshes from chain before stored-copy admission without sync`: REQ-GOSSIP-4-J5Z4DF.T1.P2, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P9, REQ-GOSSIP-4-J5Z4DF.T1.P34, UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P10
- `a delivered pending join event admits the first network copy without another read`: REQ-GOSSIP-4-J5Z4DF.T1.P3, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P10
- `successful ingress sync ends the request without queueing the triggering copy`: REQ-GOSSIP-4-J5Z4DF.T1.P28, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P26, REQ-GOSSIP-4-J5Z4DF.T1.P35
- `independent source allowances preserve honest signatures for ordinary processing`: REQ-GOSSIP-4-J5Z4DF.T1.P10, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P23
- `stored block survives malformed confirmations from one eligible network supplier`: REQ-GOSSIP-4-J5Z4DF.T1.P11, INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P15
- `ingest rejects a block confirmation with a forged author signature`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P17
- `ingest refuses author signature encodings the contracts reject, then commits the canonically signed block`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P40, INV-MIRROR-1-VAF778.T1.P10
- `ingest drops a wrong-channel block and cuts the transport when the sender is known`: REQ-BLOCK-PIPE-2-PCXNT6.T1.P10
- `ingest cuts both an eligible relayer and the author of an outsider-authored block`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P18
- `future block whose source proves its lineage at queue timeout is applied and the source kept`: REQ-BLOCK-PIPE-4-CF52J6.T1.P7, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P8
- `future block at a height its source holds a different block at queue timeout is dropped and the source excluded`: REQ-BLOCK-PIPE-4-CF52J6.T1.P8, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P10
- `junk supplier is excluded even when another sync toward it is in flight at queue timeout`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P12
- `future block at a height its source never reached at queue timeout is dropped and the source struck`: REQ-BLOCK-PIPE-4-CF52J6.T1.P9, UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P11
- `queued entry that becomes stored merges at queue timeout: strays stripped, supplier blacklisted`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P6
- `a spectator whose sync stores a queued tip copy applies the next gossiped block without its queue timeout`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P48
- `recovers the first reduced-fork block by reducing locally at ingest`: REQ-BLOCK-PIPE-9-QA66GT.T1.P5
- `queues an unknown-fork block for sync; the failed sync, not the queue, punishes the supplier`: REQ-BLOCK-PIPE-4-CF52J6.T1.P3, REQ-BLOCK-PIPE-4-CF52J6.T1.P6
- `a queue timeout accepts a proved successor fork without excluding the supplier or author`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P13, REQ-SYNC-1-T2589H.T1.P8
- `unknown-fork timeout asks both the supplier and the author to sync`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P9
- `unknown fork: both the supplier and the author are asked and both are cut`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P19
- `still recovers via local reduction when the raced block is on yet another unknown fork`: INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P20
- `drains an early reduced-fork block once the fork transition catches up`: REQ-BLOCK-PIPE-6-XQ0RTT.T1.P4
- `missing genesis: no proof to build, sources blacklisted, no dispute`: REQ-BLOCK-PIPE-8-N529VH.T1.P3, INV-BCP-6-1E943Z.T1.P3
- `present genesis: builds the WrongGenesis proof and disputes the fork`: INV-BCP-6-1E943Z.T1.P1
- `never validates an entry whose fork is not current`: REQ-BCP-4-MS5VVZ.T1.P10
- `schedules the full window fresh, only the remainder after aging, and nothing at the deadline`: UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P2
