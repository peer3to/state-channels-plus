# StateManager.ts

> **Source:** [src/stateManager/StateManager.ts](../../../../../../src/stateManager/StateManager.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md), [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

## Requirements

- [`INV-BLOCK-PIPE-1-1AB2ME` (Atomic ordered commit)](../../../../specification/block-progression/block-processing.md#inv-block-pipe-1-1ab2me)
- [`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)
- [`REQ-BLOCK-PIPE-6-XQ0RTT` (Total-order application)](../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt)
- [`REQ-BLOCK-PIPE-7-FYE9VJ` (Commit before publish)](../../../../specification/block-progression/block-processing.md#req-block-pipe-7-fye9vj)
- [`REQ-BLOCK-PIPE-8-N529VH` (Evidence precedes escalation)](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)
- [`REQ-BLOCK-PIPE-10-PHAKE2` (Counter-signing policy)](../../../../specification/block-progression/block-processing.md#req-block-pipe-10-phake2)
- [`REQ-BLOCK-PIPE-11-DCHAJ2` (Signature admission by participant union)](../../../../specification/block-progression/block-processing.md#req-block-pipe-11-dchaj2)
- [`INV-SDK-ARCH-1-KNAX7F` (Coherent participant state)](../../../../specification/runtime/sdk.md#inv-sdk-arch-1-knax7f)
- [`REQ-SDK-ARCH-1-7H14H6` (Explicit ownership)](../../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6)
- [`REQ-SDK-ARCH-4-GTN7QN` (Execution isolation)](../../../../specification/runtime/sdk.md#req-sdk-arch-4-gtn7qn)
- [`REQ-DIS-10-SAHJBN` (Timeout claims MUST satisfy the deadline, linkage, schedule, and existence…)](../../../../specification/disputes/disputes.md#req-dis-10-sahjbn)
- [`REQ-JOINSIG-2-RR2G4Q` (All-or-nothing unanimity)](../../../../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)
- [`REQ-GOSSIP-3-HQZNQX` (Re-broadcast on growth)](../../../../specification/peer-communication/block-gossip.md#req-gossip-3-hqznqx)
- [`REQ-IX-2-2PY2EF` (Deterministic execution and commitment)](../../../../specification/interactions.md#req-ix-2-2py2ef)
- [`REQ-IX-3-H8WCVY` (Inbound inclusion and join flow)](../../../../specification/interactions.md#req-ix-3-h8wcvy)
- [`INV-HIST-1-5N44K9` (Block commits to the state snapshot hash)](../../../../specification/protocol-model/history-and-commitments.md#inv-hist-1-5n44k9)
- [`INV-HIST-2-27M8VA` (Hash-linking)](../../../../specification/protocol-model/history-and-commitments.md#inv-hist-2-27m8va)
- [`INV-HIST-3-T17T78` (Snapshots commit to inbound and outbound message-stream tips)](../../../../specification/protocol-model/history-and-commitments.md#inv-hist-3-t17t78)
- [`INV-MSG-3-PCR3KT` (Tip totalBalance = cumulative sum of message balances)](../../../../specification/settlement/cross-layer-messages.md#inv-msg-3-pcr3kt)
- [`REQ-MSG-3-YY569F` (Packaged inbound blocks MUST chain from the previous snapshot tip and exist…)](../../../../specification/settlement/cross-layer-messages.md#req-msg-3-yy569f)
- [`REQ-MSG-11-VS3ZGC` (A deposited-but-unincluded joiner MUST be able to force inclusion via the…)](../../../../specification/settlement/cross-layer-messages.md#req-msg-11-vs3zgc)
- [`REQ-FIN-1-SP669G` (Participants MUST NOT be required to wait for explicit threshold finality before)](../../../../specification/protocol-model/finality.md#req-fin-1-sp669g)
- [`REQ-FIN-5-DH29VZ` (Block authoring is deterministic)](../../../../specification/protocol-model/finality.md#req-fin-5-dh29vz)
- [`REQ-LIF-3-PDRTPY` (A normal state transition MAY produce an outbound message)](../../../../specification/settlement/lifecycle.md#req-lif-3-pdrtpy)
- [`REQ-LIF-6-VG861M` (Four protocol windows are configured on the manager at deployment)](../../../../specification/settlement/lifecycle.md#req-lif-6-vg861m)
- [`REQ-TJOIN-6-0HEVYH` (Single-channel runtime ownership)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)

## UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE

Full root abort

- Setup: Real runtime construction and public cleanup.
- Oracle: Each variation checks completion, closure and surviving resources.

- [x] `UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P1` — Inline abort closes the host and executor endpoints, rejects late queries, preserves a sibling SDK and tolerates repeated disposal
- [x] `UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P2` — Worker abort closes the host and executor endpoints, rejects late queries and preserves a sibling SDK
- [x] `UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P3` — Abort cancels a scheduled task before its due time, drops status to OPENED and disconnects peers
- [x] `UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P4` — Stopping retains the live provider listener; root disposal then destroys the provider, removes listeners and permits repeated disposal

## UNIT-TEST-STATE-MANAGER-1-GFPTJF

Serialized execution and restore

- Setup: Drive valid and each-failing-stage blocks through the mutex path; crash side effects post-persist
- Oracle: One block in execution at a time; every pre-persist failure restores the VM; post-persist failures never rewind

- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P1` — mutex exclusivity under concurrent eligibility
- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P2` — restore on authenticate failure
- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P3` — disarm after persist
- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P4` — fork re-check race under the lock
- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P5` — restore on validation failure
- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P6` — restore on execution failure
- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P7` — restore on commitment mismatch
- [ ] `UNIT-TEST-STATE-MANAGER-1-GFPTJF.P8` — restore on signer-union failure

## UNIT-TEST-STATE-MANAGER-2-WSMPYS

Commit order and signing rules

- Setup: Commit blocks under each `shouldSignBlock` condition incl. the posted-and-next-author case
- Oracle: Persist→sign→gossip order observable; forfeit rule never signs; echoes merge as duplicates

- [ ] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P1` — signs when every sign condition holds
- [ ] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P2` — forfeit rule
- [ ] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P3` — persist-before-gossip echo test
- [x] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P4` — status/join promotion
- [ ] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P5` — blacklisted-author no-sign
- [ ] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P6` — non-participating-status no-sign
- [x] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P7` — signer-outside-union no-sign
- [ ] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P8` — forced-join trigger arms
- [x] `UNIT-TEST-STATE-MANAGER-2-WSMPYS.P9` — final snapshot demotes an exiting participant to synced

## UNIT-TEST-STATE-MANAGER-3-32QM46

Timeout detection

- Setup: Schedule timeouts across posted/unposted predecessor and target slots, window-age races, self/non-participant skips
- Oracle: Due-time computation exact; predecessor post grants time; target commitment yields forced; early windows rejected

- [ ] `UNIT-TEST-STATE-MANAGER-3-32QM46.P1` — due-time boundary
- [ ] `UNIT-TEST-STATE-MANAGER-3-32QM46.P2` — predecessor-post reschedule
- [x] `UNIT-TEST-STATE-MANAGER-3-32QM46.P3` — normal timeout claim
- [x] `UNIT-TEST-STATE-MANAGER-3-32QM46.P4` — window-age guard
- [x] `UNIT-TEST-STATE-MANAGER-3-32QM46.P5` — self skip
- [x] `UNIT-TEST-STATE-MANAGER-3-32QM46.P6` — forced claim on commitment-without-accepted-block
- [ ] `UNIT-TEST-STATE-MANAGER-3-32QM46.P7` — non-participant skip

## UNIT-TEST-STATE-MANAGER-4-ECGP8V

Custom RPC disposal ordering

- Setup: Dispose a live state manager with a normal and a rejecting custom RPC root
- Oracle: Root disposal runs while P2P dependencies are available; teardown always completes; root rejection surfaces after cleanup

- [x] `UNIT-TEST-STATE-MANAGER-4-ECGP8V.P1` — custom RPC root disposes before P2P teardown
- [x] `UNIT-TEST-STATE-MANAGER-4-ECGP8V.P2` — root rejection surfaces after runtime teardown

## UNIT-TEST-STATE-MANAGER-5-D8GDWH

On-chain join eligibility adapter

- Setup: Read the threshold after a current snapshot participant is slashed on-chain
- Oracle: Returned addresses exactly match the contract threshold; the slashed participant is absent

- [x] `UNIT-TEST-STATE-MANAGER-5-D8GDWH.P1` — delegates the slash-excluding threshold set without SDK-side recomputation

## UNIT-TEST-STATE-MANAGER-6-EBJNRX

Internal channel staging

- Setup: Stage an external channel ID on unopened harness peers through the private lifecycle control
- Oracle: Every peer selects the exact ID while status stays `NOT_OPENED`; no lobby match, Holepunch topic, or peer connection starts

- [x] `UNIT-TEST-STATE-MANAGER-6-EBJNRX.P1` — external target staged without opening or discovery

## UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K

Active fork eligibility

- Setup: Query the current fork before and after disposal or a real reduction
- Oracle: Current live fork is accepted; disposed runtime and old fork are rejected

- [x] `UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P1` — current fork before and after disposal
- [x] `UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P2` — current and old forks after a real reduction

## UNIT-TEST-SM-STATE-MANAGER-1-WKTVE3

Transition pipeline atomicity

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-STATE-MANAGER-1-WKTVE3.P1` — Application result, persisted state, block result, outbound messages, queue state, and snapshot advance together on success
- [ ] `UNIT-TEST-SM-STATE-MANAGER-1-WKTVE3.P2` — none of them advance on rejection

## UNIT-TEST-SM-STATE-MANAGER-2-WWPB98

State lifecycle

- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-STATE-MANAGER-2-WWPB98.P1` — Store/restore preserves the correct live state bytes
- [ ] `UNIT-TEST-SM-STATE-MANAGER-2-WWPB98.P2` — a fork switch preserves the correct live state bytes
- [ ] `UNIT-TEST-SM-STATE-MANAGER-2-WWPB98.P3` — temporary inspection preserves the correct live state bytes
- [ ] `UNIT-TEST-SM-STATE-MANAGER-2-WWPB98.P4` — replay isolation preserves the correct live state bytes
- [ ] `UNIT-TEST-SM-STATE-MANAGER-2-WWPB98.P5` — malformed state preserves the correct live state bytes
- [ ] `UNIT-TEST-SM-STATE-MANAGER-2-WWPB98.P6` — retry preserves the correct live state bytes

## UNIT-TEST-SM-STATE-MANAGER-3-NXEV5W

Author scheduling

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1)

- [ ] `UNIT-TEST-SM-STATE-MANAGER-3-NXEV5W.P1` — The selector is queried against the actual pre-state and a correct author follows the active validation strategy before execution
- [ ] `UNIT-TEST-SM-STATE-MANAGER-3-NXEV5W.P2` — a wrong author follows the active validation strategy before execution

## UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N

Inbound inclusion

- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1)

- [ ] `UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N.P1` — A join message updates membership, balances, cursor, state, and snapshot exactly once
- [ ] `UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N.P2` — a top-up message updates them exactly once
- [ ] `UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N.P3` — a custom message updates them exactly once
- [ ] `UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N.P4` — duplicate delivery updates them exactly once
- [ ] `UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N.P5` — retry updates them exactly once
- [ ] `UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N.P6` — a race updates them exactly once
- [ ] `UNIT-TEST-SM-STATE-MANAGER-4-JM9F0N.P7` — a failure path leaves no partial update

## UNIT-TEST-SM-STATE-MANAGER-5-MRDPNN

Balance accounting

- Specification: [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`REQ-BAL-3-P7Q83F.T1`](../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)

- [ ] `UNIT-TEST-SM-STATE-MANAGER-5-MRDPNN.P1` — Application totals, inbound deposits, outbound exits, and snapshot aggregates remain equal at boundaries
- [ ] `UNIT-TEST-SM-STATE-MANAGER-5-MRDPNN.P2` — overflow rejects atomically

## UNIT-TEST-SM-STATE-MANAGER-6-R4FVC5

Interface consumption

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-STATE-MANAGER-6-R4FVC5.P1` — Every adapter capability used by the manager has an explicit success behavior
- [ ] `UNIT-TEST-SM-STATE-MANAGER-6-R4FVC5.P2` — an explicit no-op behavior
- [ ] `UNIT-TEST-SM-STATE-MANAGER-6-R4FVC5.P3` — an explicit failure behavior
- [ ] `UNIT-TEST-SM-STATE-MANAGER-6-R4FVC5.P4` — an explicit retry behavior
- [ ] `UNIT-TEST-SM-STATE-MANAGER-6-R4FVC5.P5` — an explicit teardown behavior

## UNIT-TEST-SM-STATE-MANAGER-7-GY2W8K

Concurrency

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d), [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1), [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-STATE-MANAGER-7-GY2W8K.P1` — Mutex/queue interleavings cannot expose half-applied state
- [ ] `UNIT-TEST-SM-STATE-MANAGER-7-GY2W8K.P2` — interleavings cannot expose stale selectors
- [ ] `UNIT-TEST-SM-STATE-MANAGER-7-GY2W8K.P3` — interleavings cannot expose duplicate inbound work
- [ ] `UNIT-TEST-SM-STATE-MANAGER-7-GY2W8K.P4` — replay work cannot mutate live state
