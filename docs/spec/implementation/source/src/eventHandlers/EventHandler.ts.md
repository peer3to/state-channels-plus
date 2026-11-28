# EventHandler.ts

> **Source:** [src/eventHandlers/EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts)

## Requirements

- [`REQ-SDK-ARCH-1-7H14H6` (Explicit ownership)](../../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6)
- [`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)
- [`REQ-DISPUTE-PIPE-14-5C2SXH` (Act only on a window the chain still holds)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-14-5c2sxh)
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)
- [`REQ-LIF-7-0XZBDM` (A committed dispute suspends off-chain execution on the disputed fork)](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
- [`REQ-LIF-12-TSXRBG` (Observers install the agreed genesis)](../../../../specification/settlement/lifecycle.md#req-lif-12-tsxrbg)

## UNIT-TEST-EVENT-HANDLER-1-RZ2C7W

Dispute-event branches

- Setup: Deliver committed/killed/slashed/reduced events across final/expired/auditable, relevant/irrelevant, duplicate, and race cases; a final dispute to a spectator that never received its latest block
- Oracle: Branches per the pipeline algorithm; replication precedes action; improvement rule uploads only outcome-changers; challenges fire on mismatched reductions; a non-participant that cannot back a final dispute aborts cleanly

- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P1` — final branch
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P2` — dedup
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P3` — relevance gate
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P4` — improvement uploads
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P5` — kill→replacement first-wins
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P6` — adopt matching reduction
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P7` — expired branch
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P8` — auditable branch
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P9` — non-improvement skips upload
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P10` — challenge mismatched reduction
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P11` — improvement upload skipped as already initiated: reduction still scheduled
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P12` — A disconnected spectator observes a committed dispute and successor fork without invoking the first local or chain audit predicate or storing a dispute counter, while a participant audits the same dispute
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P18` — A pending joiner whose uncertain join can still land handles a snapshot event that does not list it: it stays PENDING_PARTICIPANT and its join stays pending.
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P19` — a snapshot applied while the local diamond's pending set lists the signer answers the pending check without a chain read
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P20` — a snapshot applied while the local diamond misses the signer's JOIN reads the chain's pending set once
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P21` — a snapshot the local diamond drops as older than the mirrored one updates no membership
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P22` — a non-disputer auditing an invalid dispute builds its state proof once, during the audit, and its kill-and-dispute reuses it and lands
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P23` — the state proof built during the audit fails: the kill-and-dispute builds its own and lands
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P24` — a peer that already disputed audits an invalid dispute: no state proof is built and its kill goes out alone and lands
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P25` — a non-disputer auditing a valid dispute below its own view builds its state proof once, during the audit, and both the evidence comparison and its own upload reuse it
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P26` — a cut-off spectator observes a final dispute whose latest block it never received: it aborts cleanly and the participants reach the dispute's output fork
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P27` — a timed-out peer whose chain events were held through the disputes, the reduction and a same-fork snapshot update ignores the disputes whose window that update cleared: no event-pipeline failure, no `onDisputeStarted` or `onDisputeUpdate` for them, and it leaves the channel
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P28` — a double signer whose chain events were held through a threshold-final dispute, its reduction and a same-fork snapshot update ignores the final dispute whose window that update cleared: `completeWithGenesis` is never called, no event-pipeline failure, and it leaves the channel
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P29` — a synced spectator whose chain events were held through a dispute cycle and a same-fork snapshot update ignores the disputes whose window that update cleared: no dispute persisted, no reduction scheduled for the old fork, no event-pipeline failure, and its mirror holds the chain's snapshot
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P30` — a participant whose read node is behind the block of a fork's first dispute waits for that block instead of taking the missing window as cleared: then it requests the acknowledgment, fires `onDisputeStarted` once, audits the invalid dispute and its kill lands
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P31` — a participant disposed while its window read waits for a lagging read node: the runtime release ends the wait well before its deadline, no further read or wait follows, the dispute is not handled (no `onDisputeStarted`, no upload, no kill), and no runtime error is reported

## UNIT-TEST-EVENT-HANDLER-2-Q270TR

Genesis install on open

- Setup: Open on chain with participants and a non-participant observer, through the harness or a lobby negotiation; select the channel on a fresh runtime only after the open and deliver `ChannelOpened` through the real event pipeline; swallow the genesis join log handling of a non-participant, a negotiating participant or a participant that negotiated nothing; fail the local genesis hook execution outside the EVM on a participant or a non-participant, or make a participant's revert; open with unanimous terms carrying a hash no genesis derives from; open on a consumer whose genesis folds in the opening data
- Oracle: A negotiating participant installs the genesis it signed, checked against the chain's hash, without the genesis join block; any other runtime installs the matching rebuild with the chain's fork and state hash, from the event's opening data; a genesis join block the runtime never received is recovered from logs and stored before the install; a listed participant that cannot install the genesis (a reverting or failing hook execution, an unavailable join block, a different hash) aborts with no state set, no completed `onChannelOpened` and the event failed; a runtime outside the opened set stays running with no state set: it reports the open on a different hash, and fails the event on an unavailable join block or a failed execution, while the chain keeps the channel open

- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P1` — a non-participant observer installs the rebuilt genesis: its fork and state hash equal the chain snapshot's
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P2` — a runtime that selected the channel after the open recovers the genesis join block from logs, stores it and installs the genesis
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P3` — an opened hash no genesis derives from aborts each listed participant: `onAbort` once, no `onSetState`, no completed `onChannelOpened`, the handler's failure surfaces once per participant
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P4` — a participant whose local genesis hook execution reverts aborts: `onAbort` once, the runtime closes, no `onSetState`, no completed `onChannelOpened`, the event fails with "Opened genesis rejected: hook reverted", while the other participants install
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P5` — a runtime outside the opened participant set observes an opened hash no genesis derives from: no `onAbort`, no `onSetState`, `onChannelOpened` once, the runtime stays open and holds no fork
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P10` — a runtime outside the opened set whose genesis join log handling stores nothing fails the event with "genesis join block unavailable": no `onAbort`, no `onSetState`, no completed `onChannelOpened`, the runtime stays open, while the participants install
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P14` — on a consumer whose genesis folds in the opening data, a non-participant observer installs the genesis of the signed data `0x00` the opened event carries: its fork and state hash equal the chain snapshot's, and the empty data's genesis has another hash
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P16` — a participant whose local genesis hook execution fails outside the EVM (the executor) aborts: `onAbort` once, the runtime closes, no `onSetState`, no completed `onChannelOpened`, the event fails with that error, while the other participants install
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P17` — a runtime outside the opened set whose local genesis hook execution fails outside the EVM fails the event with that error: no `onAbort`, no `onSetState`, no completed `onChannelOpened`, the runtime stays open
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P18` — the lower address negotiating through the lobby, whose genesis join log handling stores nothing, installs the genesis it signed: both joins resolve with the opened channel, its fork and state hash equal the chain's, no `onAbort`, and the genesis join block is still not stored
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P19` — a participant that negotiated nothing and whose genesis join log handling stores nothing aborts: `onAbort` once, no `onSetState`, no completed `onChannelOpened`, the event fails with "genesis join block unavailable", while the other participants install
- [x] `UNIT-TEST-EVENT-HANDLER-2-Q270TR.P20` — the higher address negotiating through the lobby, whose genesis join log handling stores nothing, installs the genesis it signed: both joins resolve with the opened channel, its fork and state hash equal the chain's, no `onAbort`, and the genesis join block is still not stored

No test for a participant whose signed genesis differs from the chain's hash: unreachable, the open needs this runtime's signature over the held hash, and it signs only the hash of the genesis it holds.
