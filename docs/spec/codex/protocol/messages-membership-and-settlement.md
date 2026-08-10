# Cross-layer messages, membership, admission, and settlement

## Status and authority

This chapter defines cross-layer stream semantics once, then applies them to open, spectate, join, top-up, normal exit, forced exit, and close.

## 1. Purpose

The application state machine and base chain need a safe way to exchange ordered effects without executing in one shared transaction. Inbound and outbound message streams provide that bridge. Membership is built on inbound messages because a deposit acknowledged by the base chain must still be consumed by channel execution. Settlement is built on outbound messages because a channel exit must be finalized before the base chain releases assets.

## 2. Design decisions and rationale

### 2.1 One generic stream model in both directions

JOIN and EXIT are message consumers, not special transport systems. Every source appends hash-linked blocks. Every destination tracks its processed source tip, verifies the missing descendant range, applies it once, and advances its marker.

### 2.2 Source acknowledgment and destination application are separate

An L1 deposit can succeed before the channel consumes it. An off-chain exit can be produced before L1 processes it. This separation must be visible to users and storage. Calling either one “complete” too early creates loss and support risk.

### 2.3 Spectating is fail-closed and pre-commit

A prospective participant synchronizes and verifies the channel without depositing or acquiring obligations. Any failure lets it abort safely. Spectating must never create an on-chain commitment, reserve a seat, or enter the participant threshold.

### 2.4 Admission is unanimous

The joiner and every current or pending eligible participant sign exact admission bytes. This prevents current members from changing finality rules for a nonconsenting member and prevents a joiner from depositing into a different snapshot than it verified.

### 2.5 Settlement follows snapshot finality

Producing an outbound exit does not require the producing block to be final. L1 processing does. The caller advances a finalized snapshot and supplies the linked outbound difference from the chain’s already processed tip.

## 3. Boundary and responsibilities

The base-chain manager is source for inbound blocks and destination for outbound blocks. The channel state machine is destination for inbound messages and source for outbound messages. Peers store both streams and include ranges in blocks, disputes, and snapshot updates. The application defines custom message meaning and balance operations.

## 4. Data model and state

### 4.1 Stream state

Each direction has a source head hash, source height, destination processed head hash, and processed height. Blocks commit to prior hash, next height, ordered messages, cumulative balance, and source timestamp.

Zero head and zero height represent an empty stream before the first block. A nonzero head must have its actual height; zero hash with nonzero height is invalid.

### 4.2 Message identity and replay

The block hash identifies the ordered batch. A message has no independent global ID in current V1, so replay prevention comes from advancing the processed block head. A custom message that needs application-level idempotency must include its own nonce in encoded data.

### 4.3 Membership states

| State               | Meaning                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| outsider            | not spectating and not in any channel set                                                 |
| spectator           | synchronized locally, no funds or protocol duty                                           |
| admission proposed  | exact join bytes are being signed off chain                                               |
| pending participant | deposit is in the current on-chain inbound stream but not adopted by application snapshot |
| active participant  | present in adopted application snapshot and not slashed                                   |
| exiting             | valid outbound exit exists but is not processed on chain                                  |
| removed or slashed  | absent from successor application participants; exit consequence may be pending           |
| settled             | all entitled outbound value processed on chain                                            |

## 5. Inputs and preconditions

### 5.1 Stream range

A destination accepts a range only when the first block points to its processed head, each later block points to the prior supplied hash, heights increase by one, the last hash equals the new committed tip, and cumulative balance matches the new snapshot.

The caller may include already processed prefix blocks. The destination may prune them only after locating a supplied descendant whose parent equals its stored head. A supplied array with no connection to the stored head is invalid, not an empty difference.

### 5.2 Spectate

The spectator needs channel ID, manager and chain identity, adopted on-chain snapshot, participant list, current fork and dispute status, encoded application state, state proof to the requested latest state, relevant stream ranges, and peer identities. Every off-chain value must link to the chain or a valid final anchor.

### 5.3 Join

The join payload binds channel, participant, balance, deadline, expected fork, and expected snapshot. All current and pending eligible participants plus the joiner approve it. The joiner is the on-chain sender and asset owner under application rules.

## 6. Processing algorithm

### 6.1 Append at source

1. Collect one or more source-authorized messages in deterministic order.
2. Set parent to current source head and height to current height plus one.
3. update cumulative balance with every message balance;
4. set authoritative source timestamp;
5. hash and persist block atomically with head, height, and total;
6. publish it through the direction’s availability mechanism.

### 6.2 Verify a missing range

1. Start running hash and height at destination processed tip.
2. Locate the first unprocessed supplied block that directly extends running hash.
3. For each remaining block, require parent equality and next height.
4. Validate each message type, outer fields, and encoded inner data.
5. update running cumulative balance using application rules;
6. at end, require running hash, height, and balance equal the new snapshot commitments.

Verification is pure. Applying messages happens only after the complete requested range validates, unless a defined batch API commits partial progress with its own finality proof.

### 6.3 Apply at destination

1. Recheck stored processed tip has not changed since verification.
2. Apply each message in block and message order.
3. If any message fails, roll back the entire destination transaction or local state operation.
4. persist new processed head, height, cumulative balance, and per-message effects atomically;
5. emit or gossip the new progress marker.

### 6.4 Spectate-before-join

1. Read canonical manager snapshot and dispute state.
2. Connect to at least one participant, then try the configured participant mesh.
3. Request latest snapshot, encoded state, state proof, blocks, confirmations, and missing message ranges.
4. Verify chain identity, channel and fork, snapshot hash, state hash, proof finality, block ancestry, membership, stream ranges, and balance invariant.
5. Store replicated material under a spectator namespace that grants no signing or authoring permission.
6. Keep syncing until the local view is current enough for the user’s admission decision.
7. On any unavailable, invalid, stale, or disputed state that policy does not support, delete or mark the partial spectator session and abort with no on-chain action.
8. Only after success, construct an admission proposal bound to the exact verified snapshot and fork.

### 6.5 Admission and deposit

1. The joiner signs the proposal.
2. Current and pending eligible participants verify the spectator proof or current state and sign exact bytes.
3. The joiner submits deposit before deadline with expected snapshot and fork.
4. The manager rechecks signatures and race expectations, escrows assets, and appends a JOIN inbound message.
5. Peers learn the new inbound head from the canonical event and treat the joiner as pending for threshold recovery.
6. The deterministic author includes the next inbound range in a block.
7. State-machine replay applies JOIN and resulting snapshot includes the joiner.
8. A final milestone or dispute successor makes that membership change safe for on-chain snapshot adoption.

### 6.6 Forced join inclusion

If peers do not consume the deposit, the pending joiner can open a dispute whose inbound head is newer than the latest application snapshot. Reduction uses the eligible inbound cutoff and applies missing JOIN messages before slash or removal operations. The successor then includes the joiner if application join succeeds.

The missing design is an exact refund path if force inclusion cannot complete. A pending deposit must not become permanently locked because every active participant disappeared.

### 6.7 Normal exit

1. An ordinary valid application transaction decides to remove or pay a participant and emits an EXIT outbound message.
2. The block may continue through normal non-final execution.
3. Direct or virtual votes finalize a snapshot committing to the outbound tip, or dispute resolution carries it into a successor.
4. A caller submits the finalized snapshot proof and the outbound range after the manager’s processed tip.
5. The manager verifies ancestry and cumulative balance, calls consumer withdrawal, and advances its processed tip.
6. The participant is settled when every entitled exit message is processed on chain.

### 6.8 Forced exit and slash exit

Self-removal, timeout removal, and slash are dispute inputs. Successor generation calls the application removal or slash method, which may emit EXIT messages. Those messages enter the same outbound stream and require successor snapshot adoption before L1 payment.

### 6.9 Incremental catch-up

A long outbound range may be processed in batches only at snapshot boundaries that each have valid finality proof and descendant tips. A caller cannot split one snapshot’s unproved range into partial asset effects unless the contract commits an intermediate processed hash and can prove it is an ancestor of the finalized upper tip.

Current implementation processes the supplied difference atomically in one snapshot call. Production size bounds must ensure that supported ranges fit, or add the safe intermediate mechanism.

## 7. Outputs and postconditions

Inbound source acknowledgment creates pending work but no immediate application membership. Outbound source creation creates a claim but no immediate L1 payment. Destination application advances the processed marker exactly once.

Spectate success creates verified local state only. Join success creates escrow plus pending inbound message. Settlement success creates the asset transfer and advances cumulative withdrawals.

## 8. Invariants

- **STR-INV-1:** source blocks form one append-only hash chain per direction and channel.
- **STR-INV-2:** destination processed tip advances only to a proved descendant.
- **STR-INV-3:** no message block is applied twice or skipped.
- **STR-INV-4:** cumulative balance at each tip equals prior total plus ordered message balances.
- **STR-INV-5:** a spectator has no funds or channel duty.
- **STR-INV-6:** admission binds to exact snapshot and fork approved by all required signers.
- **STR-INV-7:** pending join affects recovery membership before adopted application membership.
- **STR-INV-8:** every L1 withdrawal is backed by a finalized snapshot and unprocessed outbound range.
- **STR-INV-9:** normal, timeout, self-removal, and slash exits share one outbound processing rule.
- **STR-INV-10:** total deposits equal withdrawals plus application-controlled balance.

## 9. Ordering, concurrency, and atomicity

The source order is chain order for inbound messages and accepted application execution order for outbound messages. Two deposits included in consecutive L1 transactions cannot be reordered by peers. Two outbound messages in one state transition keep application emission order.

Admission signatures can become stale before deposit inclusion. Expected fork, snapshot, and deadline reject the transaction. Concurrent snapshot adoption and deposit are safe because the join checks the current adopted snapshot while inbound append follows chain order.

## 10. Trust and security assumptions

Consumer escrow and asset calls are trusted application code. The balance model must account for every supported asset and transfer behavior. Fee-on-transfer, rebasing, callback, and multi-asset tokens need explicit adapters; scalar `amount` assumptions do not cover them.

Spectators do not trust a serving peer. They require cryptographic links to chain state and finality. Availability failure is a safe abort, not evidence to slash a peer.

## 11. Failure behavior and recovery

Broken stream ancestry, height gap, unsupported message type, balance mismatch, or destination effect failure rejects the range without advancing its tip. Missing data uses peer RPC then chain-backed recovery where available.

A join deposit acknowledged but not included uses forced inbound dispute. A produced exit not yet finalized waits for finality or enters dispute. A finalized exit whose consumer transfer fails remains retryable from the same adopted snapshot and unprocessed tip.

## 12. Current implementation

Contracts implement generic `Message` and `MessageBlock`, but JOIN and EXIT are the main concrete types. SDK stores inbound and outbound blocks in message-block storage and uses spectate and join RPC services. E2E tests cover spectating, join races, force join, participant lifecycle, snapshots, and malicious updates.

Current spectator persistence and storage are in-memory. The exact refund path for a pending join that cannot be forced into a successor is absent. Contract outbound updates are atomic and may hit gas limits for long ranges.

## 13. Difference from the intended design

| Classification     | Difference                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- |
| missing            | durable spectator namespace and cleanup transaction                                           |
| missing            | complete force-join refund or escape path                                                     |
| missing            | generic custom message authorization, idempotency, and accounting contract                    |
| decision pending   | safe bounded batching of a large finalized outbound range                                     |
| missing            | explicit support policy for fee-on-transfer, rebasing, and multi-asset balances               |
| documentation debt | current code and names still treat some generic stream operations as join/exit-specific       |
| missing            | user-visible status model separating deposit, application inclusion, finality, and settlement |

## 14. Dependencies and cross-layer effects

Contract stream algorithms are in [admission and messages](../contracts/admission-calldata-and-messages.md). State proof membership hops are in [contract finality](../contracts/state-proofs-and-finality.md). SDK spectate, join, event sync, storage, and snapshot services implement the client side.

## 15. Verification

Tests must cover arbitrary valid message types, source append, missing range, duplicate block, non-descendant tip, gap, incorrect height, cumulative balance mismatch, destination rollback, restart, long-range catch-up, spectate success and every abort, stale join signatures, pending threshold, force join, refund once designed, normal exit before and after finality, dispute exits, repeated settlement, and hostile consumer behavior.

## 16. Future work

Alternative data-availability layers and message batching may reduce cost. Every proposal must state new trust, censorship, and replay assumptions.
