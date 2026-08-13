# Cross-Layer Message Streams

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral cross-layer message streams behavior, assumptions, constraints, security properties, and black-box test plan.

Related documents: [concepts/history-and-commitments.md](../protocol-model/history-and-commitments.md)
(snapshot commitment hierarchy), [protocol/disputes.md](../disputes/disputes.md) (forced inbound inclusion
as a dispute input; successor forks), [protocol/finality.md](../protocol-model/finality.md) (milestone finality
required by snapshot advance), [protocol/fraud-proofs.md](../disputes/fraud-proofs.md)
(`ForgedInboundMessageBlock`, `DisputeInvalidBalanceInvariant`),
[security/trust-model.md](../security/trust-model.md).

---

## Contents

- [Purpose and shared stream infrastructure](#1-purpose-and-shared-stream-infrastructure)
- [Withdrawal: incremental outbound processing during snapshot advance](#2-withdrawal-incremental-outbound-processing-during-snapshot-advance)
- [Spectate-before-join](#3-spectate-before-join)
- [Join and admission (inbound-stream consumer)](#4-join-and-admission-inbound-stream-consumer)
- [Exit, removal, and slashing (outbound-stream consumers)](#5-exit-removal-and-slashing-outbound-stream-consumers)
- [The channel-balance invariant](#6-the-channel-balance-invariant)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose and shared stream infrastructure

### 1.1 Purpose & observable contract

The channel and the base layer communicate exclusively through two **mirror-image,
general-purpose, ordered message streams**. They are _not_ join- and exit-specific special cases;
joins, top-ups, exits, withdrawals, removals, and slashes are consumers of the same machinery
(§§4–7).

- **Inbound stream (L1 → L2).** The base layer appends; the channel consumes. Carries `JOIN`
  messages today and is dispatched by type, so it can carry any base-layer-to-channel
  instruction (`the corresponding state-machine operation`
  routes unknown types to the integrator hook `_processCustomInboundMessage`).
- **Outbound stream (L2 → L1).** The channel appends; the base layer consumes. Carries `EXIT`
  messages today and is likewise dispatched by type
  (`the corresponding common adjudication operation`).

Each stream is a hash-linked chain of **message blocks**. In either direction, the destination
tracks its **processed source-stream tip**, verifies a supplied linked range from that tip to a
newer committed tip, applies the range in order, and advances its marker. The committed tips make
it possible to prove ordering, prevent replay and omission, and catch up incrementally.

**Message format:**

| Struct         | Fields                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Message`      | `messageType`, `participant`, `balance`, `data`                               | `messageType` is a canonical hashed type identifier; standard join and exit identifiers derive from `JOIN_CHANNEL_MESSAGE` and `EXIT_CHANNEL_MESSAGE`. `data` is the canonical encoded payload (`JoinChannel` / `ExitChannel`). `balance` MUST equal the payload's balance.                                                                                                                      |
| `MessageBlock` | `previousBlockHash`, `blockHeight`, `messages[]`, `totalBalance`, `timestamp` | Block identity is `keccak256(abi.encode(messageBlock))`. `previousBlockHash` links to the parent (`bytes32(0)` at stream genesis). `blockHeight` increments by exactly 1 per block. `totalBalance` is the **running cumulative sum** of every message balance from stream genesis through this block — cumulative deposits on the inbound stream, cumulative withdrawals on the outbound stream. |

**Commitments.** A channel block commits to the inbound blocks it consumes by embedding them
(`Block.messageBlocks`). A state snapshot commits to both stream tips:
`SnapshotData.latestInboundMessageBlockHash/Height`, `latestOutboundMessageBlockHash/Height`,
plus the cumulative `totalDeposits` and `totalWithdrawals`. Dispute reduction outputs commit to
the same fields in the successor-fork genesis snapshot
(`the corresponding dispute-verification operation`).
The chain's own progress markers live in
`ChannelBalance` (`StateChannelManagerStorage`):
`latestInboundMessageBlockHash/Height`, `latestOutboundMessageBlockHeight`, `totalDeposits`,
`totalWithdrawals`.

### 1.4 Incremental catch-up and batching

The recursive hash linkage permits incremental catch-up. If the base layer has processed outbound
tip _A_ and receives proof of a finalized snapshot committing to descendant tip _B_, it processes
the linked _A → B_ difference and advances its marker to _B_.

- **REQ-MSG-5 (batchability).** Catch-up MUST be splittable into smaller ranges without changing
  the result: processing _A → M_ then _M → B_ (via any intermediate committed snapshot _M_) MUST
  leave the same marker, totals, and consumer effects as processing _A → B_ at once.
  **For this protocol version:** supported operationally — `updateStateSnapshotSameFork` accepts any newer proven
  milestone snapshot as the upper bound and can be called repeatedly; `_pruneOutboundMessageBlocks`
  skips the already-processed prefix, so overlapping submissions are safe. There is no on-chain
  check that _forces_ full catch-up in one transaction; the snapshot chosen as upper bound defines
  the batch. No test exercises split-batch equivalence explicitly (required downstream coverage in traceability).
- **Atomicity.** A snapshot advance is atomic: any failure in range verification or message
  processing reverts the whole update (no partial marker progress within one transaction).
  Partial progress across transactions exists only at snapshot granularity (REQ-MSG-5).
- **Ancestry proof.** Ordering/ancestry is proven by the hash-linked range itself, anchored at the
  chain's stored tip; the _authority_ of the upper tip comes from the snapshot's own proof path
  (milestone finality or finalized reduction, §2). A tip that is not a descendant of the processed
  tip cannot produce a verifying range (`ErrorOutboundMessageBlocksInvalid`).
- **Failure behavior.** Invalid ranges revert with `ErrorOutboundMessageBlocksInvalid` (outbound)
  or the structured `ErrorDisputeInboundMessageBlocksInvalid` diagnostics (inbound, in
  reduction). Reverts leave both markers untouched.

**Note (inbound height check).** `_verifyInboundMessageBlocks` checks height contiguity only
_between_ supplied blocks; the first supplied block's height is not checked against the lower
tip's height. Hash linkage makes the height redundant for ancestry, and the on-chain append
assigns heights canonically, so this is not exploitable on inbound data the chain itself
persisted. **Open question:** should the first-block height be bound to the lower snapshot for
defense in depth?

### 1.5 Assumptions, constraints & dependencies

- The state machine's `Balance` algebra (`addBalance`, `areBalancesEqual`,
  `isBalanceLesserThan`) is deterministic and total for all balances that enter either stream
  (see [concepts/state-machines.md](../protocol-model/state-machines.md)).
- Outbound-range processing depends on snapshot validity being established _before_
  `_updateStateSnapshot` runs (finality proof or finalized reduction — §2). The stream layer does
  not re-verify signatures.
- Inbound-block authenticity depends on the chain being the sole author (append happens only via
  `onlySelf`-guarded deposit paths).
- Consumer `withdraw` is integrator code; a reverting or `false`-returning withdraw blocks the
  entire snapshot advance (`ErrorWithdrawalFailed`). **Open question:** a malicious or broken
  consumer asset (e.g. a token that reverts on transfer to a specific address) can wedge the
  outbound stream for everyone; is per-message skip/quarantine needed?

### 1.6 Invariants

- **INV-MSG-1 (ordered, linked streams).** Each stream is a single hash-linked chain per channel
  with heights increasing by exactly 1; a message block's identity is
  `keccak256(abi.encode(block))`.
- **INV-MSG-2 (no replay, no omission).** The destination processes each message block exactly
  once and in order: already-processed blocks are skipped (inbound: persistence guard; outbound:
  prefix pruning), and a range that omits or reorders blocks cannot verify against the committed
  tips.
- **INV-MSG-3 (cumulative totals).** `totalBalance` of the stream tip equals the balance-algebra
  sum of all message balances since stream genesis; on-chain `totalDeposits` /
  `totalWithdrawals` equal the tip totals of the processed prefixes.
- **INV-MSG-4 (withdrawals capped by deposits).** At every point of outbound processing,
  `totalWithdrawals ≤ totalDeposits` (`CantWithdrawMoreThanDeposits`).
- **INV-MSG-5 (marker monotonicity).** Processed tips only advance to descendants of the current
  tip; snapshot advance requires strictly newer snapshots (`isSnapshotNewer` /
  `RaceConditionBlockHeightTooOld`).

### 1.7 Verification

---

## 2. Withdrawal: incremental outbound processing during snapshot advance

### 2.1 Purpose & observable contract

An `ExitChannel` is **not** submitted standalone. It is an outbound message inside the ordered
L2 → L1 stream, and it is _processed_ — funds released — only when the on-chain snapshot advances
past the outbound block that contains it. Producing an exit off-chain requires no finality;
finality (or a finalized dispute reduction) is required at the moment a snapshot is submitted
on-chain.

Two snapshot-advance paths exist:

1. **Same-fork update.** Prove the finality of a newer snapshot
   on the canonical fork: milestone proofs are verified against the current on-chain snapshot's
   threshold context, the new snapshot must be strictly newer, and its inbound tip must equal the
   chain's inbound head: a same-fork advance is blocked until the channel has consumed every
   pending inbound message.
2. **Successor-fork update.** After a dispute reduces and its
   reduction challenge period expires, adopt the successor fork's genesis snapshot: the contract
   walks the reduced-result chain from the current on-chain fork, requiring each hop's challenge
   period to be expired, until it reaches the target fork; the submitted snapshot must be the
   genesis-shaped snapshot of that fork with the recorded genesis timestamp.

In **either** path, snapshot advancement compares the chain's processed outbound tip (current
snapshot) with the new snapshot's committed tip, prunes the already-processed prefix, verifies the
linked difference, processes only the new blocks (`EXIT` → consumer `withdraw`), advances the
marker and withdrawal totals, and stores the new snapshot.

### 2.2 Snapshot-advance sequence

```mermaid
sequenceDiagram
    participant off-chain participant as Submitter (off-chain participant / anyone with the proof)
    participant SSF as StateSnapshotFacet (L1)
    participant SPF as state-proof verifier / DisputeWindows
    participant CF as ConsumerFacet

    Note over off-chain participant: holds newer snapshot S_new committing outbound tip B,<br/>plus the linked outbound range and the proof path
    off-chain participant->>SSF: updateStateSnapshotSameFork(milestoneProofs, snapshots, range)<br/>or updateStateSnapshotFork(S_new, range)
    alt same-fork path
        SSF->>SPF: verifyMilestones(fork, proofs, snapshots, S_current)
        SSF->>SSF: require S_new newer + inbound tip == chain inbound head
    else successor-fork path
        SSF->>SPF: walk reducedResult chain; require each<br/>reduce-challenge period expired; S_new is fork genesis
    end
    SSF->>SSF: prune range prefix already processed<br/>(old tip A = S_current.outbound tip)
    SSF->>SSF: verify linked range A -> B<br/>(hash links, heights, running totals)
    loop each new outbound message
        SSF->>CF: withdraw(ExitChannel) via withdrawAssetsComposable
        CF-->>SSF: assets released to participant
        SSF->>SSF: totalWithdrawals += balance;<br/>require totalWithdrawals <= totalDeposits
    end
    SSF->>SSF: store S_new; advance outbound marker to B;<br/>emit StateSnapshotUpdated, WithdrawalsUpdated
```

### 2.4 Verification

---

## 3. Spectate-before-join

### 3.1 Purpose & observable contract

Spectating is a **pre-commit synchronization mode, not an on-chain transaction**. A prospective
participant (or any observer) queries chain data, connects to channel peers, obtains the channel's
history proof, verifies it against the on-chain source of truth, verifies internal finality, and
replicates state — all without committing funds or incurring any channel obligation.

Spectating is **fail-closed**: there is exactly one successful synchronization outcome, and _any_
data-availability, validation, finality, transport, or peer-behavior failure lets the
spectator abort with nothing at risk. Aborting is a safe, expected outcome — it is not evidence
that a dispute is needed. No step of the sync sends an on-chain transaction: all contract
verification is read-only against the spectator's execution environment and chain provider.

**Requester flow.** A spectator sends a synchronization request identifying the channel and,
optionally, a pinned fork and height. A responder returns the reduced dispute-window chain from the on-chain
snapshot's fork to the tip fork (with the disputes, latest states, and inbound blocks needed to
re-run each reduction), the tip fork's genesis snapshot + encoded state, a `StateProof`
(milestones + trailing signed blocks), milestone snapshots, the latest finalized encoded state,
and the outbound message-block ranges covering on-chain tip → fork genesis → latest finalized
snapshot. The requester verifies everything locally, simulates the on-chain advance, persists the
accepted state, and replays unfinalized blocks through the ordinary validation rules.

### 3.3 Verification

---

## 4. Join and admission (inbound-stream consumer)

### 4.1 Purpose & observable contract

Joining expands the on-chain participant set and requires **unanimous authorization**: the joiner
signs the `JoinChannel`, and the full current threshold set — snapshot participants ∪ pending
participants, minus on-chain-slashed — must countersign
(`JoinChannelFacet._processJoinChannel`
via `verifyThresholdSigned`). The flow:

1. **Sync first (§3).** The joiner spectates to the latest proven state before committing funds.
2. **Collect signatures (off-chain).**
   `JoinChannelService.collectJoinChannelConfirmation`
   pins the expected on-chain snapshot hash and fork, signs the `JoinChannel`
   (`channelId`, `participant`, `deadlineTimestamp`, `balance`), and requests a signature from
   every threshold participant. Peers validate in `signJoinRequest`: requester's transport
   identity == joiner == signer of the join, channel matches, deadline not passed, pinned
   snapshot/fork match the chain, and the local signer is in the threshold set. The per-request
   timeout is `min(agreementTime, deadline − chainTime)`.
3. **Submit + deposit (on-chain).** The joiner submits
   `joinChannel(confirmation, expectedSnapshotHash, expectedForkId)`; `msg.sender` must be the
   joiner. the adjudicator checks the deadline, the pinned snapshot/fork (race guards), that the joiner
   is not already in the threshold set, that the fork is not disputed, the joiner's signature,
   and the threshold signatures; then `depositAssetsComposable` pulls the deposit through the
   application boundary and appends a `JOIN` message block to the **inbound stream** (§1.2). Deposit
   acknowledgment on the base layer _is_ the production of the inbound message.
4. **Off-chain inclusion.** A block author packages the pending inbound block(s) into its next
   channel block; applying them runs `_joinChannel` on the state machine, which admits the member
   and credits the balance. From that block's snapshot on, the joiner is a snapshot participant.
5. **Forced inclusion (fallback).** If prompt inclusion fails, the joiner forces it through the
   dispute game — forced inbound-message inclusion is one of the four dispute inputs
   (cross-ref [protocol/disputes.md](../disputes/disputes.md)). **For this protocol version:** on submitting the join, the
   off-chain participant records the local block height
   (`the corresponding participant-state operation`,
   `ForceJoinStorage`); if `N = |participants| + 1`
   further blocks pass without the joiner becoming a participant, it fires a dispute
   (`maybeInitiateForceJoinDispute`). Reduction selects as the successor fork's inbound tip the
   chain's inbound head as of the dispute-window expiry (walking back past newer blocks) and
   applies the pending inbound blocks — including the join — to the output state
   (`the corresponding dispute-verification operation` / `reduceOutputToSnapshotData`).
   The successor-fork genesis therefore contains the joiner as a participant; from then on the
   joiner is covered by leader election and receives its authoring slot.

**Pending participants matter before inclusion.** `getPendingParticipants` derives joiners from
`JOIN` messages in the persisted inbound chain; pending participants are already part of the
on-chain threshold set for later joins and disputes (`getOnChainThresholdSet`,
`canParticipateInDisputes`) even before any channel block includes them.

**Top-up.** `topUpBalance` runs the same pipeline with `isTopUp = true`: the participant must
already exist, the disputed-fork check is skipped, and the resulting inbound `JOIN` message is
applied by `_joinChannel`, which — per its contract
(`the corresponding state-machine operation`) — adds a new
participant _or_ credits an existing participant's balance without changing membership.

### 4.3 Verification

---

## 5. Exit, removal, and slashing (outbound-stream consumers)

A normal state transition **may, but need not**, produce an outbound exit: application logic calls
`the corresponding state-machine operation` (or
`_addOutboundMessage` for other types), and the author packages the transition's outbound
messages into the block's outbound message block (§1.3). Producing the message requires no
finality; the exit becomes withdrawable when a snapshot committing to (or past) its outbound
block is adopted on-chain (§2).

Dispute-derived exits use the same stream: reduction applies slashes (`_slashParticipant`),
removals/timeouts and self-removals (`_removeParticipant`) to the output state and packages the
resulting `ExitChannel`s into one deterministic outbound block committed by the successor-fork
genesis snapshot (`generateDisputeOutputState`). Normal exits, dispute-derived exits, and any
future outbound instruction are processed by the identical incremental mechanism — there is no
separate withdrawal transaction type.

Removal and slashing MUST record exits through the same observable outbound-message path. Removal
differs from slashing only in balance semantics: it may preserve the participant's full held
balance, while slashing applies the protocol-defined penalty (REQ-SM-8).

---

## 6. The channel-balance invariant

### 6.1 Purpose

Channels grow, and a late joiner synchronizes from a finalized snapshot instead of replaying
history from genesis. Existing participants have verified every transition, so an inflated
balance could never get past an honest validator — but a _unanimous colluding_ participant set
can finalize any state it likes. Agreement alone does not prove economic soundness. Before
joining, depositing, or relying on a synced state, anyone must be able to verify that the
channel's **aggregate** claimed balance is backed by deposits minus withdrawals under the
application's balance algebra. The invariant is about aggregate accounting, not distribution:
it does not care whether Bob has 4 and Alice 6 or Bob 8 and Alice 2 — only that the total is 10.

**The attack it prevents:** colluding participants finalize a snapshot whose in-channel balances
sum to more than the channel controls, induce a newcomer to deposit, withdraw the real collateral
through valid-looking exits, and leave the newcomer holding an unpayable in-channel balance.

### 6.4 Verification

---

## Assumptions and constraints

Both streams assume canonical message encoding and hashing, persistent monotonic cursors, available message
pre-images, deterministic ordered processing, and a live base chain for forced inclusion and settlement. A
consumer may batch consecutive messages but may not skip, duplicate, reorder, or reinterpret them. Stream and
message sizes, participant counts, gas, storage, and catch-up latency are bounded by deployment limits that must
be made explicit. Retries and reconnects must resume from committed cursors without repeating effects.

## Security considerations

The streams cross the chain/channel trust boundary and carry value-affecting joins, top-ups, exits, removals,
slashes, and withdrawals. Threats include forged messages, commitment/pre-image mismatch, omission,
duplication, reordering, replay across channels/forks, stale cursors, partial batch failure, unavailable data,
and balance-invariant bypass. Verification must prove atomic cursor/effect updates, idempotent recovery where
specified, exact authorization and type dispatch, failure without partial value movement, and conservation
across concurrent inbound/outbound activity.

## Requirements and invariants

This table is the normative requirement index. Detailed rules and rationale are defined in the sections above.

| Requirement / invariant             | Statement                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-msg-1"></a>`INV-MSG-1`   | Each stream is one hash-linked chain per channel; heights +1; identity = `keccak256(abi.encode(block))`                       |
| <a id="inv-msg-2"></a>`INV-MSG-2`   | No replay, no omission: each block processed exactly once, in order                                                           |
| <a id="inv-msg-3"></a>`INV-MSG-3`   | Tip `totalBalance` = cumulative sum of message balances; chain totals match processed prefixes                                |
| <a id="inv-msg-4"></a>`INV-MSG-4`   | `totalWithdrawals ≤ totalDeposits` at every outbound processing step                                                          |
| <a id="inv-msg-5"></a>`INV-MSG-5`   | Processed tips advance only to strictly newer descendants                                                                     |
| <a id="inv-msg-6"></a>`INV-MSG-6`   | Balance invariant: `totalDeposits == totalWithdrawals + getTotalStateBalance(state)` with chain-anchored deposits/withdrawals |
| <a id="req-msg-1"></a>`REQ-MSG-1`   | Snapshots MUST commit both stream tips + totals; dispute outputs likewise                                                     |
| <a id="req-msg-2"></a>`REQ-MSG-2`   | A dispute's claimed inbound tip MUST be an ancestor of the chain tip with matching height                                     |
| <a id="req-msg-3"></a>`REQ-MSG-3`   | Packaged inbound blocks MUST chain from the previous snapshot tip and exist on-chain; fabrication is provable fraud           |
| <a id="req-msg-4"></a>`REQ-MSG-4`   | Outbound processing MUST verify the linked range and skip the processed prefix before consuming                               |
| <a id="req-msg-5"></a>`REQ-MSG-5`   | Catch-up MUST be batchable into smaller ranges with identical results                                                         |
| <a id="req-msg-6"></a>`REQ-MSG-6`   | Snapshot advance MUST require finality (same-fork) or finalized reduction + expired challenge period (successor fork)         |
| <a id="req-msg-7"></a>`REQ-MSG-7`   | Same-fork advance MUST consume all pending inbound messages                                                                   |
| <a id="req-msg-8"></a>`REQ-MSG-8`   | Exits MUST be withdrawable only through snapshot advance (no standalone submission)                                           |
| <a id="req-msg-9"></a>`REQ-MSG-9`   | Spectating MUST be fail-closed: any failure aborts with no funds or obligations at risk                                       |
| <a id="req-msg-10"></a>`REQ-MSG-10` | Joining MUST carry the joiner's signature plus the full threshold set's signatures, pinned to an expected snapshot/fork       |
| <a id="req-msg-11"></a>`REQ-MSG-11` | A deposited-but-unincluded joiner MUST be able to force inclusion via the dispute game and then be covered by leader election |
| <a id="req-msg-12"></a>`REQ-MSG-12` | Anyone MUST be able to verify the balance invariant trustlessly for a claimed snapshot                                        |

## Verification and test plan

The per-mechanism verification paragraphs above define required behavior. The complete plan additionally needs
black-box cases for empty/single/maximum batches, duplicate and missing indices, out-of-order delivery,
reconnect/retry after every durable boundary, malformed/unknown message types, concurrent join/withdrawal,
forced inclusion, snapshot advancement, partial failure, and one-above-limit rejection. Each case must assert
the ordered message commitment, cursor, state-machine effect, balance conservation, emitted chain effect, and
absence of duplicate effects. Existing tests must be mapped to those cases; every unmapped permutation remains
required downstream coverage in the verification layer.

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item       | Requirements / invariants | Setup and stimulus                                                                                                                                    | Expected result                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INV-MSG-1.T1`  | `INV-MSG-1`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Each stream is one hash-linked chain per channel; heights +1; identity = `keccak256(abi.encode(block))`                       | <a id="inv-msg-1.t1.p1"></a>`INV-MSG-1.T1.P1` — valid case<br><a id="inv-msg-1.t1.p4"></a>`INV-MSG-1.T1.P4` — direct invalid/opposite case<br><a id="inv-msg-1.t1.p2"></a>`INV-MSG-1.T1.P2` — matching commitment<br><a id="inv-msg-1.t1.p5"></a>`INV-MSG-1.T1.P5` — mismatched commitment<br><a id="inv-msg-1.t1.p6"></a>`INV-MSG-1.T1.P6` — predecessor snapshot<br><a id="inv-msg-1.t1.p7"></a>`INV-MSG-1.T1.P7` — genesis snapshot<br><a id="inv-msg-1.t1.p8"></a>`INV-MSG-1.T1.P8` — stale fork<br><a id="inv-msg-1.t1.p9"></a>`INV-MSG-1.T1.P9` — foreign fork<br><a id="inv-msg-1.t1.p3"></a>`INV-MSG-1.T1.P3` — correct identity/signature<br><a id="inv-msg-1.t1.p10"></a>`INV-MSG-1.T1.P10` — wrong identity/signature<br><a id="inv-msg-1.t1.p11"></a>`INV-MSG-1.T1.P11` — missing identity/signature<br><a id="inv-msg-1.t1.p12"></a>`INV-MSG-1.T1.P12` — duplicate identity/signature<br><a id="inv-msg-1.t1.p13"></a>`INV-MSG-1.T1.P13` — forged identity/signature<br><a id="inv-msg-1.t1.p14"></a>`INV-MSG-1.T1.P14` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `INV-MSG-2.T1`  | `INV-MSG-2`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | No replay, no omission: each block processed exactly once, in order                                                           | <a id="inv-msg-2.t1.p1"></a>`INV-MSG-2.T1.P1` — valid case<br><a id="inv-msg-2.t1.p3"></a>`INV-MSG-2.T1.P3` — direct invalid/opposite case<br><a id="inv-msg-2.t1.p2"></a>`INV-MSG-2.T1.P2` — duplicate delivery<br><a id="inv-msg-2.t1.p4"></a>`INV-MSG-2.T1.P4` — replay of processed block<br><a id="inv-msg-2.t1.p5"></a>`INV-MSG-2.T1.P5` — omitted block<br><a id="inv-msg-2.t1.p6"></a>`INV-MSG-2.T1.P6` — reordered blocks<br><a id="inv-msg-2.t1.p7"></a>`INV-MSG-2.T1.P7` — concurrent delivery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `INV-MSG-3.T1`  | `INV-MSG-3`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Tip `totalBalance` = cumulative sum of message balances; chain totals match processed prefixes                                | <a id="inv-msg-3.t1.p1"></a>`INV-MSG-3.T1.P1` — valid case<br><a id="inv-msg-3.t1.p3"></a>`INV-MSG-3.T1.P3` — direct invalid/opposite case<br><a id="inv-msg-3.t1.p2"></a>`INV-MSG-3.T1.P2` — zero balance<br><a id="inv-msg-3.t1.p4"></a>`INV-MSG-3.T1.P4` — exact balance boundary<br><a id="inv-msg-3.t1.p5"></a>`INV-MSG-3.T1.P5` — one beyond boundary<br><a id="inv-msg-3.t1.p6"></a>`INV-MSG-3.T1.P6` — maximum value<br><a id="inv-msg-3.t1.p7"></a>`INV-MSG-3.T1.P7` — conservation check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `INV-MSG-4.T1`  | `INV-MSG-4`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | `totalWithdrawals ≤ totalDeposits` at every outbound processing step                                                          | <a id="inv-msg-4.t1.p1"></a>`INV-MSG-4.T1.P1` — valid case<br><a id="inv-msg-4.t1.p3"></a>`INV-MSG-4.T1.P3` — direct invalid/opposite case<br><a id="inv-msg-4.t1.p2"></a>`INV-MSG-4.T1.P2` — zero balance<br><a id="inv-msg-4.t1.p4"></a>`INV-MSG-4.T1.P4` — exact balance boundary<br><a id="inv-msg-4.t1.p5"></a>`INV-MSG-4.T1.P5` — one beyond boundary<br><a id="inv-msg-4.t1.p6"></a>`INV-MSG-4.T1.P6` — maximum value<br><a id="inv-msg-4.t1.p7"></a>`INV-MSG-4.T1.P7` — conservation check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `INV-MSG-5.T1`  | `INV-MSG-5`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Processed tips advance only to strictly newer descendants                                                                     | <a id="inv-msg-5.t1.p1"></a>`INV-MSG-5.T1.P1` — valid case<br><a id="inv-msg-5.t1.p3"></a>`INV-MSG-5.T1.P3` — direct invalid/opposite case<br><a id="inv-msg-5.t1.p2"></a>`INV-MSG-5.T1.P2` — matching commitment<br><a id="inv-msg-5.t1.p4"></a>`INV-MSG-5.T1.P4` — mismatched commitment<br><a id="inv-msg-5.t1.p5"></a>`INV-MSG-5.T1.P5` — predecessor snapshot<br><a id="inv-msg-5.t1.p6"></a>`INV-MSG-5.T1.P6` — genesis snapshot<br><a id="inv-msg-5.t1.p7"></a>`INV-MSG-5.T1.P7` — stale fork<br><a id="inv-msg-5.t1.p8"></a>`INV-MSG-5.T1.P8` — foreign fork                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `INV-MSG-6.T1`  | `INV-MSG-6`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Balance invariant: `totalDeposits == totalWithdrawals + getTotalStateBalance(state)` with chain-anchored deposits/withdrawals | <a id="inv-msg-6.t1.p1"></a>`INV-MSG-6.T1.P1` — valid case<br><a id="inv-msg-6.t1.p3"></a>`INV-MSG-6.T1.P3` — direct invalid/opposite case<br><a id="inv-msg-6.t1.p2"></a>`INV-MSG-6.T1.P2` — zero balance<br><a id="inv-msg-6.t1.p4"></a>`INV-MSG-6.T1.P4` — exact balance boundary<br><a id="inv-msg-6.t1.p5"></a>`INV-MSG-6.T1.P5` — one beyond boundary<br><a id="inv-msg-6.t1.p6"></a>`INV-MSG-6.T1.P6` — maximum value<br><a id="inv-msg-6.t1.p7"></a>`INV-MSG-6.T1.P7` — conservation check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `REQ-MSG-1.T1`  | `REQ-MSG-1`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Snapshots MUST commit both stream tips + totals; dispute outputs likewise                                                     | <a id="req-msg-1.t1.p1"></a>`REQ-MSG-1.T1.P1` — valid case<br><a id="req-msg-1.t1.p4"></a>`REQ-MSG-1.T1.P4` — direct invalid/opposite case<br><a id="req-msg-1.t1.p2"></a>`REQ-MSG-1.T1.P2` — matching commitment<br><a id="req-msg-1.t1.p5"></a>`REQ-MSG-1.T1.P5` — mismatched commitment<br><a id="req-msg-1.t1.p6"></a>`REQ-MSG-1.T1.P6` — predecessor snapshot<br><a id="req-msg-1.t1.p7"></a>`REQ-MSG-1.T1.P7` — genesis snapshot<br><a id="req-msg-1.t1.p8"></a>`REQ-MSG-1.T1.P8` — stale fork<br><a id="req-msg-1.t1.p9"></a>`REQ-MSG-1.T1.P9` — foreign fork<br><a id="req-msg-1.t1.p3"></a>`REQ-MSG-1.T1.P3` — malformed input<br><a id="req-msg-1.t1.p10"></a>`REQ-MSG-1.T1.P10` — adversarial input<br><a id="req-msg-1.t1.p11"></a>`REQ-MSG-1.T1.P11` — partial failure<br><a id="req-msg-1.t1.p12"></a>`REQ-MSG-1.T1.P12` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `REQ-MSG-2.T1`  | `REQ-MSG-2`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | A dispute's claimed inbound tip MUST be an ancestor of the chain tip with matching height                                     | <a id="req-msg-2.t1.p1"></a>`REQ-MSG-2.T1.P1` — valid case<br><a id="req-msg-2.t1.p4"></a>`REQ-MSG-2.T1.P4` — direct invalid/opposite case<br><a id="req-msg-2.t1.p2"></a>`REQ-MSG-2.T1.P2` — matching commitment<br><a id="req-msg-2.t1.p5"></a>`REQ-MSG-2.T1.P5` — mismatched commitment<br><a id="req-msg-2.t1.p6"></a>`REQ-MSG-2.T1.P6` — predecessor snapshot<br><a id="req-msg-2.t1.p7"></a>`REQ-MSG-2.T1.P7` — genesis snapshot<br><a id="req-msg-2.t1.p8"></a>`REQ-MSG-2.T1.P8` — stale fork<br><a id="req-msg-2.t1.p9"></a>`REQ-MSG-2.T1.P9` — foreign fork<br><a id="req-msg-2.t1.p3"></a>`REQ-MSG-2.T1.P3` — malformed input<br><a id="req-msg-2.t1.p10"></a>`REQ-MSG-2.T1.P10` — adversarial input<br><a id="req-msg-2.t1.p11"></a>`REQ-MSG-2.T1.P11` — partial failure<br><a id="req-msg-2.t1.p12"></a>`REQ-MSG-2.T1.P12` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `REQ-MSG-3.T1`  | `REQ-MSG-3`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Packaged inbound blocks MUST chain from the previous snapshot tip and exist on-chain; fabrication is provable fraud           | <a id="req-msg-3.t1.p1"></a>`REQ-MSG-3.T1.P1` — valid case<br><a id="req-msg-3.t1.p4"></a>`REQ-MSG-3.T1.P4` — direct invalid/opposite case<br><a id="req-msg-3.t1.p2"></a>`REQ-MSG-3.T1.P2` — matching commitment<br><a id="req-msg-3.t1.p5"></a>`REQ-MSG-3.T1.P5` — mismatched commitment<br><a id="req-msg-3.t1.p6"></a>`REQ-MSG-3.T1.P6` — predecessor snapshot<br><a id="req-msg-3.t1.p7"></a>`REQ-MSG-3.T1.P7` — genesis snapshot<br><a id="req-msg-3.t1.p8"></a>`REQ-MSG-3.T1.P8` — stale fork<br><a id="req-msg-3.t1.p9"></a>`REQ-MSG-3.T1.P9` — foreign fork<br><a id="req-msg-3.t1.p3"></a>`REQ-MSG-3.T1.P3` — malformed input<br><a id="req-msg-3.t1.p10"></a>`REQ-MSG-3.T1.P10` — adversarial input<br><a id="req-msg-3.t1.p11"></a>`REQ-MSG-3.T1.P11` — partial failure<br><a id="req-msg-3.t1.p12"></a>`REQ-MSG-3.T1.P12` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `REQ-MSG-4.T1`  | `REQ-MSG-4`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Outbound processing MUST verify the linked range and skip the processed prefix before consuming                               | <a id="req-msg-4.t1.p1"></a>`REQ-MSG-4.T1.P1` — valid case<br><a id="req-msg-4.t1.p3"></a>`REQ-MSG-4.T1.P3` — direct invalid/opposite case<br><a id="req-msg-4.t1.p2"></a>`REQ-MSG-4.T1.P2` — matching commitment<br><a id="req-msg-4.t1.p4"></a>`REQ-MSG-4.T1.P4` — mismatched commitment<br><a id="req-msg-4.t1.p5"></a>`REQ-MSG-4.T1.P5` — predecessor snapshot<br><a id="req-msg-4.t1.p6"></a>`REQ-MSG-4.T1.P6` — genesis snapshot<br><a id="req-msg-4.t1.p7"></a>`REQ-MSG-4.T1.P7` — stale fork<br><a id="req-msg-4.t1.p8"></a>`REQ-MSG-4.T1.P8` — foreign fork                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `REQ-MSG-5.T1`  | `REQ-MSG-5`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Catch-up MUST be batchable into smaller ranges with identical results                                                         | <a id="req-msg-5.t1.p1"></a>`REQ-MSG-5.T1.P1` — valid case<br><a id="req-msg-5.t1.p3"></a>`REQ-MSG-5.T1.P3` — direct invalid/opposite case<br><a id="req-msg-5.t1.p2"></a>`REQ-MSG-5.T1.P2` — zero/empty/no-op case<br><a id="req-msg-5.t1.p4"></a>`REQ-MSG-5.T1.P4` — exact boundary<br><a id="req-msg-5.t1.p5"></a>`REQ-MSG-5.T1.P5` — failure and recovery<br><a id="req-msg-5.t1.p6"></a>`REQ-MSG-5.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `REQ-MSG-6.T1`  | `REQ-MSG-6`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Snapshot advance MUST require finality (same-fork) or finalized reduction + expired challenge period (successor fork)         | <a id="req-msg-6.t1.p1"></a>`REQ-MSG-6.T1.P1` — valid case<br><a id="req-msg-6.t1.p4"></a>`REQ-MSG-6.T1.P4` — direct invalid/opposite case<br><a id="req-msg-6.t1.p2"></a>`REQ-MSG-6.T1.P2` — matching commitment<br><a id="req-msg-6.t1.p5"></a>`REQ-MSG-6.T1.P5` — mismatched commitment<br><a id="req-msg-6.t1.p6"></a>`REQ-MSG-6.T1.P6` — predecessor snapshot<br><a id="req-msg-6.t1.p7"></a>`REQ-MSG-6.T1.P7` — genesis snapshot<br><a id="req-msg-6.t1.p8"></a>`REQ-MSG-6.T1.P8` — stale fork<br><a id="req-msg-6.t1.p9"></a>`REQ-MSG-6.T1.P9` — foreign fork<br><a id="req-msg-6.t1.p3"></a>`REQ-MSG-6.T1.P3` — before deadline<br><a id="req-msg-6.t1.p10"></a>`REQ-MSG-6.T1.P10` — at deadline<br><a id="req-msg-6.t1.p11"></a>`REQ-MSG-6.T1.P11` — after deadline<br><a id="req-msg-6.t1.p12"></a>`REQ-MSG-6.T1.P12` — maximum honest skew                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `REQ-MSG-7.T1`  | `REQ-MSG-7`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Same-fork advance MUST consume all pending inbound messages                                                                   | <a id="req-msg-7.t1.p1"></a>`REQ-MSG-7.T1.P1` — valid case<br><a id="req-msg-7.t1.p3"></a>`REQ-MSG-7.T1.P3` — direct invalid/opposite case<br><a id="req-msg-7.t1.p2"></a>`REQ-MSG-7.T1.P2` — matching commitment<br><a id="req-msg-7.t1.p4"></a>`REQ-MSG-7.T1.P4` — mismatched commitment<br><a id="req-msg-7.t1.p5"></a>`REQ-MSG-7.T1.P5` — predecessor snapshot<br><a id="req-msg-7.t1.p6"></a>`REQ-MSG-7.T1.P6` — genesis snapshot<br><a id="req-msg-7.t1.p7"></a>`REQ-MSG-7.T1.P7` — stale fork<br><a id="req-msg-7.t1.p8"></a>`REQ-MSG-7.T1.P8` — foreign fork                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `REQ-MSG-8.T1`  | `REQ-MSG-8`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Exits MUST be withdrawable only through snapshot advance (no standalone submission)                                           | <a id="req-msg-8.t1.p1"></a>`REQ-MSG-8.T1.P1` — valid case<br><a id="req-msg-8.t1.p4"></a>`REQ-MSG-8.T1.P4` — direct invalid/opposite case<br><a id="req-msg-8.t1.p2"></a>`REQ-MSG-8.T1.P2` — matching commitment<br><a id="req-msg-8.t1.p5"></a>`REQ-MSG-8.T1.P5` — mismatched commitment<br><a id="req-msg-8.t1.p6"></a>`REQ-MSG-8.T1.P6` — predecessor snapshot<br><a id="req-msg-8.t1.p7"></a>`REQ-MSG-8.T1.P7` — genesis snapshot<br><a id="req-msg-8.t1.p8"></a>`REQ-MSG-8.T1.P8` — stale fork<br><a id="req-msg-8.t1.p9"></a>`REQ-MSG-8.T1.P9` — foreign fork<br><a id="req-msg-8.t1.p3"></a>`REQ-MSG-8.T1.P3` — zero balance<br><a id="req-msg-8.t1.p10"></a>`REQ-MSG-8.T1.P10` — exact balance boundary<br><a id="req-msg-8.t1.p11"></a>`REQ-MSG-8.T1.P11` — one beyond boundary<br><a id="req-msg-8.t1.p12"></a>`REQ-MSG-8.T1.P12` — maximum value<br><a id="req-msg-8.t1.p13"></a>`REQ-MSG-8.T1.P13` — conservation check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `REQ-MSG-9.T1`  | `REQ-MSG-9`               | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Spectating MUST be fail-closed: any failure aborts with no funds or obligations at risk                                       | <a id="req-msg-9.t1.p1"></a>`REQ-MSG-9.T1.P1` — valid case<br><a id="req-msg-9.t1.p3"></a>`REQ-MSG-9.T1.P3` — direct invalid/opposite case<br><a id="req-msg-9.t1.p2"></a>`REQ-MSG-9.T1.P2` — malformed input<br><a id="req-msg-9.t1.p4"></a>`REQ-MSG-9.T1.P4` — adversarial input<br><a id="req-msg-9.t1.p5"></a>`REQ-MSG-9.T1.P5` — partial failure<br><a id="req-msg-9.t1.p6"></a>`REQ-MSG-9.T1.P6` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `REQ-MSG-10.T1` | `REQ-MSG-10`              | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Joining MUST carry the joiner's signature plus the full threshold set's signatures, pinned to an expected snapshot/fork       | <a id="req-msg-10.t1.p1"></a>`REQ-MSG-10.T1.P1` — valid case<br><a id="req-msg-10.t1.p5"></a>`REQ-MSG-10.T1.P5` — direct invalid/opposite case<br><a id="req-msg-10.t1.p2"></a>`REQ-MSG-10.T1.P2` — matching commitment<br><a id="req-msg-10.t1.p6"></a>`REQ-MSG-10.T1.P6` — mismatched commitment<br><a id="req-msg-10.t1.p7"></a>`REQ-MSG-10.T1.P7` — predecessor snapshot<br><a id="req-msg-10.t1.p8"></a>`REQ-MSG-10.T1.P8` — genesis snapshot<br><a id="req-msg-10.t1.p9"></a>`REQ-MSG-10.T1.P9` — stale fork<br><a id="req-msg-10.t1.p10"></a>`REQ-MSG-10.T1.P10` — foreign fork<br><a id="req-msg-10.t1.p3"></a>`REQ-MSG-10.T1.P3` — correct identity/signature<br><a id="req-msg-10.t1.p11"></a>`REQ-MSG-10.T1.P11` — wrong identity/signature<br><a id="req-msg-10.t1.p12"></a>`REQ-MSG-10.T1.P12` — missing identity/signature<br><a id="req-msg-10.t1.p13"></a>`REQ-MSG-10.T1.P13` — duplicate identity/signature<br><a id="req-msg-10.t1.p14"></a>`REQ-MSG-10.T1.P14` — forged identity/signature<br><a id="req-msg-10.t1.p15"></a>`REQ-MSG-10.T1.P15` — membership boundary<br><a id="req-msg-10.t1.p4"></a>`REQ-MSG-10.T1.P4` — new participant<br><a id="req-msg-10.t1.p16"></a>`REQ-MSG-10.T1.P16` — existing participant<br><a id="req-msg-10.t1.p17"></a>`REQ-MSG-10.T1.P17` — removed participant<br><a id="req-msg-10.t1.p18"></a>`REQ-MSG-10.T1.P18` — slashed participant<br><a id="req-msg-10.t1.p19"></a>`REQ-MSG-10.T1.P19` — concurrent membership change |
| `REQ-MSG-11.T1` | `REQ-MSG-11`              | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | A deposited-but-unincluded joiner MUST be able to force inclusion via the dispute game and then be covered by leader election | <a id="req-msg-11.t1.p1"></a>`REQ-MSG-11.T1.P1` — valid case<br><a id="req-msg-11.t1.p5"></a>`REQ-MSG-11.T1.P5` — direct invalid/opposite case<br><a id="req-msg-11.t1.p2"></a>`REQ-MSG-11.T1.P2` — zero balance<br><a id="req-msg-11.t1.p6"></a>`REQ-MSG-11.T1.P6` — exact balance boundary<br><a id="req-msg-11.t1.p7"></a>`REQ-MSG-11.T1.P7` — one beyond boundary<br><a id="req-msg-11.t1.p8"></a>`REQ-MSG-11.T1.P8` — maximum value<br><a id="req-msg-11.t1.p9"></a>`REQ-MSG-11.T1.P9` — conservation check<br><a id="req-msg-11.t1.p3"></a>`REQ-MSG-11.T1.P3` — new participant<br><a id="req-msg-11.t1.p10"></a>`REQ-MSG-11.T1.P10` — existing participant<br><a id="req-msg-11.t1.p11"></a>`REQ-MSG-11.T1.P11` — removed participant<br><a id="req-msg-11.t1.p12"></a>`REQ-MSG-11.T1.P12` — slashed participant<br><a id="req-msg-11.t1.p13"></a>`REQ-MSG-11.T1.P13` — concurrent membership change<br><a id="req-msg-11.t1.p4"></a>`REQ-MSG-11.T1.P4` — malformed input<br><a id="req-msg-11.t1.p14"></a>`REQ-MSG-11.T1.P14` — adversarial input<br><a id="req-msg-11.t1.p15"></a>`REQ-MSG-11.T1.P15` — partial failure<br><a id="req-msg-11.t1.p16"></a>`REQ-MSG-11.T1.P16` — retry and recovery                                                                                                                                                                                                                                                                          |
| `REQ-MSG-12.T1` | `REQ-MSG-12`              | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Anyone MUST be able to verify the balance invariant trustlessly for a claimed snapshot                                        | <a id="req-msg-12.t1.p1"></a>`REQ-MSG-12.T1.P1` — valid case<br><a id="req-msg-12.t1.p4"></a>`REQ-MSG-12.T1.P4` — direct invalid/opposite case<br><a id="req-msg-12.t1.p2"></a>`REQ-MSG-12.T1.P2` — matching commitment<br><a id="req-msg-12.t1.p5"></a>`REQ-MSG-12.T1.P5` — mismatched commitment<br><a id="req-msg-12.t1.p6"></a>`REQ-MSG-12.T1.P6` — predecessor snapshot<br><a id="req-msg-12.t1.p7"></a>`REQ-MSG-12.T1.P7` — genesis snapshot<br><a id="req-msg-12.t1.p8"></a>`REQ-MSG-12.T1.P8` — stale fork<br><a id="req-msg-12.t1.p9"></a>`REQ-MSG-12.T1.P9` — foreign fork<br><a id="req-msg-12.t1.p3"></a>`REQ-MSG-12.T1.P3` — zero balance<br><a id="req-msg-12.t1.p10"></a>`REQ-MSG-12.T1.P10` — exact balance boundary<br><a id="req-msg-12.t1.p11"></a>`REQ-MSG-12.T1.P11` — one beyond boundary<br><a id="req-msg-12.t1.p12"></a>`REQ-MSG-12.T1.P12` — maximum value<br><a id="req-msg-12.t1.p13"></a>`REQ-MSG-12.T1.P13` — conservation check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Future Work

_Non-normative._

- **General-purpose outbound consumers.** Define the application hook for custom outbound message
  types symmetrically with the custom inbound-message boundary.
- **Per-message failure isolation.** Explore skip/quarantine semantics so one wedged consumer
  `withdraw` cannot block the whole outbound stream (§1.5).
- **Admission policy.** The configurable admission filter and snapshot-scoped consent for
  `signJoinRequest`; possibly protocol-visible declines (§4.2).
- **Refund path for stranded deposits.** A first-class refund for acknowledged-but-never-included
  joins, instead of relying on force-join disputes (§4.2).
- **Batched joins.** `depositAssetsComposable` already accepts arrays and `JoinChannelBlock`
  exists in the types; specifying multi-join batching could amortize inbound-stream costs.
- **Spectate simulation stubs.** Dummy consumer contracts so spectators can simulate snapshot
  advances whose withdrawals touch external assets (§3.2).
- **Invariant on snapshot update.** Implement the declared intent to run the balance-invariant
  check as the last step of every snapshot update (§2.3, §6.3).
- **Marker consolidation.** Mirror the outbound tip hash into `ChannelBalance` (§1.1).

---
