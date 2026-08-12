# State Machines

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral state machines behavior, assumptions, constraints, security properties, and black-box test plan.
> **Related:** [history-and-commitments.md](./history-and-commitments.md) (what a block commits
> to), [../protocol/time.md](../protocol/time.md) (where `_tx.header.timestamp` comes from),
> [../protocol/fraud-proofs.md](../protocol/fraud-proofs.md) (why determinism is load-bearing).

## Contents

- [Purpose and observable model](#1-purpose-and-observable-model)
- [State-machine interface](#state-machine-interface)
- [Execution context: allowed and prohibited](#2-execution-context-allowed-and-prohibited)
- [Canonical serialization: `getState` / `_setState`](#3-canonical-serialization-getstate--_setstate)
- [Participants and balances are separate concerns](#4-participants-and-balances-are-separate-concerns)
- [Turn-taking: `getNextToWrite` selects the next block author](#5-turn-taking-getnexttowrite-selects-the-next-block-author)
- [Participant lifecycle hooks](#6-participant-lifecycle-hooks)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose and observable model

**Purpose & observable contract.** A state machine is a deterministic program that conforms to the
[state-machine interface](#state-machine-interface). Two ideas define it:

- **Its storage variables are the channel state.**
- **Its functions are the allowed transitions.**

A transition is applied through the base contract's `stateTransition(Transaction)`, which injects
the transaction header into the `_tx` storage variable and executes the transaction's calldata
against the contract itself under a fixed `gasLimit`:

```solidity
_clearOutboundMessages();
_tx.header = transaction.header;
(bool success, bytes memory result) = address(this).call{gas: gasLimit}(transaction.body.data);
```

The same contract runs in two places:

1. **Off-chain**, inside each participant's off-chain participant instance, behind the
   `local state-machine adapter` boundary
   (`stateTransition`, `runView`, `getParticipants`, `getNextToWrite`, `peekNextToWrite`,
   `getState`/`setState`, the balance operations, `processInboundMessage`).
2. **On-chain**, when a dispute or fraud proof re-executes a transition
   (`executeStateTransition` on the manager).

<a id="inv-sm-1"></a>

- **INV-SM-1** — Transitions MUST be deterministic: identical prior state (as restored by
  `_setState`) plus identical transaction MUST yield an identical resulting state and identical
  outbound messages, both off-chain and under on-chain replay.

Determinism is not a convenience. It is what lets any participant, or the chain, re-execute a
transition and prove that a claimed result was invalid
(see [../protocol/fraud-proofs.md](../protocol/fraud-proofs.md)).

**Assumptions & dependencies.** The state machine's correctness claims hold only over the state
that `getState()` serializes. Logic that reads anything else (other contracts, ambient EVM
context) is outside the model and breaks INV-SM-1.

## State-machine interface

The **state-machine interface** is the complete logical boundary between the protocol and an
application-defined state machine. It specifies capabilities and observable behavior, not a
programming language, ABI, class hierarchy, or source layout. An implementation MAY name or group
the operations differently, but it MUST expose behavior equivalent to every required operation
below.

| Capability                        | Logical input                                                        | Observable output and required behavior                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Apply transition                  | Serialized current state, transaction, and fixed execution budget    | Deterministic success or rejection, the resulting serialized state, and the ordered outbound messages produced by that transition. Rejection MUST NOT expose partial state or messages.    |
| Execute read-only query           | Serialized current state and application-defined query               | Deterministic encoded result or rejection, with no state or outbound-message mutation.                                                                                                     |
| Serialize state                   | Current logical application state                                    | One canonical byte representation containing every value transition logic can observe.                                                                                                     |
| Restore state                     | Canonical serialized state                                           | Exact restoration of the encoded logical state, or rejection without partial mutation.                                                                                                     |
| Enumerate participants            | Current logical application state                                    | The complete, deterministically ordered participant identities used by authorization and threshold rules.                                                                                  |
| Select next author                | Current state, or supplied serialized state for a non-mutating query | The single identity authorized to author the next block, without mutating live state when a supplied state is inspected.                                                                   |
| Evaluate balances                 | Two balances, or the current logical state for aggregation           | Deterministic addition, subtraction, equality, ordering, zero value, and total-state balance according to the algebra in §4.2.                                                             |
| Process inbound message           | One canonical inbound message                                        | Deterministic success or rejection and the resulting state change; standard membership messages and supported application-defined messages follow the same atomicity rules as transitions. |
| Apply membership lifecycle action | Join/top-up request, soft-removal identity, or slashing identity     | Deterministic success or rejection, the resulting membership/balance state, and any canonical exit message required by §6.                                                                 |

<a id="req-sm-9"></a>

`REQ-SM-9` — A conforming state machine MUST provide the complete interface above. Every operation
MUST use the same canonical state, identity, balance, message, and transaction meanings defined by
this specification. An unsupported required operation, a hidden mutable input, or a different
result between equivalent execution environments is non-conforming.

This interface does not require ordinary callers to invoke every capability directly. The
protocol may mediate access, perform a non-mutating query against a temporary restored state, or
combine several capabilities into one call, provided the externally observable semantics remain
identical.

## 2. Execution context: allowed and prohibited

**Purpose.** Because a transition is executed by whoever replays it (a peer's local EVM, or the
manager contract during a dispute), the ambient EVM context differs on every execution. The
protocol therefore injects the context a state machine is allowed to read, and everything else is
prohibited.

### 2.1 Allowed context (the complete API)

| Value                                                                    | Source                                                                        | Meaning                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `_tx.header.participant`                                                 | injected by `stateTransition`                                                 | The logical author of this transition. The **only** valid author identity.      |
| `_tx.header.timestamp`                                                   | injected; protocol-validated (see [../protocol/time.md](../protocol/time.md)) | The protocol time of this transition. The **only** valid time source.           |
| `_tx.header.channelId`, `_tx.header.forkId`, `_tx.header.transactionCnt` | injected                                                                      | Channel, fork, and block-height coordinates of the transition.                  |
| Function arguments                                                       | `transaction.body.data` (the dispatched calldata)                             | The transition's input data, supplied by the protocol and replayed identically. |
| Contract storage                                                         | restored via `_setState` before replay                                        | The channel state itself.                                                       |
| `gasLimit`                                                               | deployment configuration argument                                             | The fixed gas budget every execution uses.                                      |

### 2.2 Prohibited ambient context

A state machine MUST NOT read ambient EVM values whose content depends on _where_ or _when_ the
transition executes rather than on the injected transaction and restored state. In particular:

| Prohibited                                                                                                             | Why it breaks replay                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `msg.sender`, `tx.origin`                                                                                              | Inside the self-call, `msg.sender` is the state-machine address itself; at the outer level it is whichever runner invoked `stateTransition` (off-chain participant-local account off-chain, the manager on-chain). It never identifies the author. Use `_tx.header.participant`. |
| `block.timestamp`, `block.number`, `blockhash`, `block.prevrandao`, `block.coinbase`, `block.basefee`, `block.chainid` | These come from the executing EVM (a local in-process chain off-chain, the real chain during replay) and differ across executions. Use `_tx.header.timestamp` for time.                                                                                                          |
| `msg.data` at the `stateTransition` level                                                                              | It is the wrapper's calldata, not the transition input. Use the function arguments dispatched from `transaction.body.data`.                                                                                                                                                      |
| `msg.value`, `address(this).balance`, external calls to other contracts, precompile-dependent randomness               | State outside `getState()` cannot be restored for replay.                                                                                                                                                                                                                        |
| `gasleft()`                                                                                                            | Differs between execution environments even under the same `gasLimit`.                                                                                                                                                                                                           |

<a id="req-sm-1"></a>

- **REQ-SM-1** — Author identity MUST be read from `_tx.header.participant` and time from
  `_tx.header.timestamp`; any use of the prohibited ambient context in transition logic is a
  correctness and fraud-proof vulnerability, and MUST be treated as a defect, not a style issue.

Why "vulnerability" and not "bug": a state machine that branches on ambient context can produce
one result off-chain and a different result during on-chain replay. That lets an attacker either
(a) get an honest participant slashed for a transition that was valid when they executed it, or
(b) escape a fraud proof for a transition that was invalid.

**Illustrative turn-enforcement rule:**

```solidity
modifier onlyCurrentPlayer() {
    require(_tx.header.participant == state.currentPlayer, "Not your turn");
    _;
}
```

The same file also shows a harmless-looking violation: `emit MoveMade(msg.sender, ...)` logs
`msg.sender` instead of `_tx.header.participant`. Events do not feed the state hash, so this does
not break replay today, but it is exactly the pattern a static check should flag.

## 3. Canonical serialization: `getState` / `_setState`

**Purpose & observable contract.** The protocol snapshots and restores the entire state to fork,
dispute, sync a late joiner, and re-execute history:

```solidity
function getState() public view virtual returns (bytes memory);   // serialize
function _setState(bytes memory encodedState) internal virtual;    // restore
```

<a id="inv-sm-2"></a>

- **INV-SM-2** — `getState`/`_setState` MUST be exact inverses: `_setState(getState())` leaves
  the state unchanged, and `getState()` after `_setState(b)` returns bytes whose decoded logical
  state equals the state encoded in `b`.
  <a id="req-sm-2"></a>

- **REQ-SM-2** — Serialization MUST be deterministic and lossless: one logical state maps to one
  canonical byte encoding, and every field that transition logic can read is included. Equivalent
  logical states MUST serialize to identical bytes, because the protocol compares state by hash
  (`keccak256(getState())` becomes `SnapshotData.stateMachineStateHash`; see
  [history-and-commitments.md](./history-and-commitments.md)).
  <a id="req-sm-3"></a>

- **REQ-SM-3** — contract runtime `mapping`s MAY be used only when the state also maintains a complete,
  deterministic key enumeration, the serialization walks that enumeration in a defined order, and
  `_setState` restores both the mapping and its enumeration consistently. State that cannot be
  enumerated deterministically MUST NOT be part of channel state.
  <a id="req-sm-4"></a>

- **REQ-SM-4** — The integrator MUST define ordering (field and collection order), encoding
  (`abi.encode` of a single state struct is the reference pattern), and round-trip behavior
  explicitly. The state machine and its state encoding are **immutable for the lifetime of a
  channel**: upgrades to state-machine logic, if any, apply only to newly opened channels. No
  state-encoding version marker is therefore required, and an existing channel MUST NOT change
  its encoding. _(Decided 2026-08-10, resolving the versioning half of
  [OQ-21](../open-questions.md#oq-21--_txbody-population-and-state-encoding-versioning).)_

The illustrative encoding is a single ABI encode/decode of one state struct:

```solidity
function getState() public view override returns (bytes memory) { return abi.encode(state); }
function _setState(bytes memory encodedState) internal override { state = abi.decode(encodedState, (TicTacToeState)); }
```

**Failure behavior.** A serialization divergence is indistinguishable from an invalid transition:
peers computing different bytes for the same logical state will disagree on
`stateMachineStateHash`, blocks will fail validation, and the disagreement escalates to a dispute
neither side can win honestly.

## 4. Participants and balances are separate concerns

**Purpose.** Membership and value are distinct concepts and MUST NOT be conflated.

### 4.1 Membership

`getParticipants()` returns the channel's current participant **identities**, as addresses.
Membership answers "who may act and who must sign"; it says nothing about value. The off-chain participant reads it
after every transition to detect joins and removals
(the corresponding participant-state operation), and the
snapshot commits to it (`SnapshotData.participants`).

### 4.2 The abstract Balance

Value is represented by an abstract balance type:

```solidity
struct Balance {
    uint256 amount; // the common simple-amount representation
    bytes data;     // application-defined extension
}
```

The shape is intentionally more general than a raw integer. `amount` keeps the common
single-currency case trivial; `data` carries application-defined structure so one channel
protocol supports single currencies, multiple or composite assets, fungible tokens, and NFTs
without restricting the protocol to one asset type. `data` is opaque to the protocol; only the
state machine's balance operations interpret it. Serialization is ABI encoding of the struct;
`data`'s internal encoding is application-defined and MUST itself be canonical (REQ-SM-2 applies).

The state machine defines the balance **algebra** by implementing:

| Operation                     | Required semantics                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `addBalance(b1, b2)`          | Associative and commutative over valid balances; MUST reject overflow rather than wrap (**REQ-BAL-3**). |
| `subtractBalance(b1, b2)`     | Partial function: MUST revert when `b2` is not covered by `b1` (**REQ-BAL-1**, underflow rejection).    |
| `areBalancesEqual(b1, b2)`    | Equivalence over logical value (not raw bytes).                                                         |
| `isBalanceLesserThan(b1, b2)` | The order used by protocol comparisons.                                                                 |
| `getTotalStateBalance()`      | Sum of all value the current state accounts for.                                                        |
| `getZeroBalance()`            | Identity element of `addBalance`.                                                                       |

<a id="req-bal-1"></a>

- **REQ-BAL-1** — `subtractBalance` MUST reject underflow: a participant cannot spend or exit
  more than they hold. This operation is the local enforcement point of the channel's
  value-conservation invariant; the aggregate form (deposits vs. withdrawals vs.
  `getTotalStateBalance`) is specified in
  [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md) (channel-balance
  invariant).
  <a id="req-bal-2"></a>

- **REQ-BAL-2** — All balance operations MUST be pure/deterministic functions of their inputs
  (they are declared `pure`/`view` in the base and are called during replay).
  <a id="req-bal-3"></a>

- **REQ-BAL-3** — `addBalance` and every balance aggregation (`getTotalStateBalance`, join
  top-ups, deposit/withdrawal totals) MUST reject overflow rather than wrap: wrapped addition
  silently mints or destroys value, breaking the same value-conservation invariant that
  underflow rejection (REQ-BAL-1) protects on the spending side. Rejection MUST be
  deterministic — an operation that overflows fails identically in off-chain execution and
  on-chain replay, so the offending transition is simply invalid. Implementations using unchecked
  arithmetic, custom `data` encodings, or arithmetic outside the protocol's numeric domain MUST
  preserve the rejection behavior themselves. _(Added 2026-08-10 on engineer
  review.)_

**Association model.** The protocol does not dictate how balances attach to participants. The
state machine owns the association (typically a parallel array or enumerable mapping keyed by
participant, inside the serialized state). The protocol only sees balances at the boundary:
`JoinChannel.balance` in, `ExitChannel.balance` out, and the aggregate totals in the snapshot.

**Integer example** (single currency):

```solidity
function subtractBalance(Balance memory b1, Balance memory b2) public pure override returns (Balance memory diff) {
    require(b1.amount >= b2.amount, "balance1 < balance2");
    diff.amount = b1.amount - b2.amount;
}
```

**Composite / NFT sketch** (illustrative, not implemented in a concrete implementation):

```solidity
// data = abi.encode(uint256[] tokenIds) sorted ascending, canonical (no duplicates)
function addBalance(Balance memory b1, Balance memory b2) public pure override returns (Balance memory sum) {
    sum.amount = b1.amount + b2.amount;                    // fungible part
    sum.data = _mergeSortedIds(b1.data, b2.data);          // set union; revert on duplicate id
}
function subtractBalance(Balance memory b1, Balance memory b2) public pure override returns (Balance memory diff) {
    require(b1.amount >= b2.amount, "underflow");
    diff.amount = b1.amount - b2.amount;
    diff.data = _removeIds(b1.data, b2.data);              // revert if any id of b2 not present in b1
}
```

The sketch shows the two rules every custom algebra must keep: a canonical `data` encoding
(sorted, deduplicated) so equal values hash equal, and a `subtractBalance` that rejects removing
what is not held.

## 5. Turn-taking: `getNextToWrite` selects the next block author

```solidity
function getNextToWrite() public view virtual returns (address);
```

<a id="req-sm-5"></a>

- **REQ-SM-5** — `getNextToWrite()` returns the address authorized to author the next **block**.
  The authorization rule is block-level: it constrains who may produce and sign the next block on
  the fork, not who may author an individual transaction inside it.

The state machine itself defines the schedule as a function of channel state; the protocol trusts
it. The recommended policy is round-robin
(see [../protocol/finality.md](../protocol/finality.md); safety of the dispute carry-forward
argument depends on it). A participant uses `getNextToWrite` to decide whether a received
block came from the legitimate author and whether it is this instance's turn
(the corresponding participant-state operation); `peekNextToWrite(serializedState)`
answers the same question against a supplied state without mutating the live one.

<a id="req-sm-6"></a>

- **REQ-SM-6** — Turn authorization is a protocol-layer responsibility, enforced generically for
  every state machine: the validation pipeline checks `block.author == getNextToWrite()` on the
  pre-state before any execution
  (block-validation service leader check — a
  wrong-author block never reaches `stateTransition`), and dispute replay repositions the machine
  and applies the same check. State machines MAY additionally reject wrong-turn authors
  in-contract as defense in depth, but the protocol MUST NOT depend on in-contract checks.
  _(Corrected 2026-08-10 on engineer review; this requirement previously mandated in-contract
  rejection.)_ For this protocol version: the on-chain `BlockInvalidStateTransition` handler re-executes and
  compares snapshots without an author check of its own, so on-chain wrong-turn slashing today
  succeeds only against machines that do guard in-contract — see
  [OQ-26](../open-questions.md).

## 6. Participant lifecycle hooks

**Purpose.** Membership changes are state transitions with protocol-defined entry points. Each
hook is `internal virtual` (the integrator implements it) with a reentrancy-guarded external
wrapper the protocol calls during replay.

```mermaid
stateDiagram-v2
    [*] --> Active: _joinChannel (admission, with balance)
    Active --> Active: _joinChannel (top-up, existing participant)
    Active --> Removed: _removeParticipant (soft, timeout)
    Active --> Slashed: _slashParticipant (punitive, proven fraud)
    Removed --> [*]: ExitChannel processed on-chain
    Slashed --> [*]: ExitChannel processed on-chain
```

### 6.1 `_joinChannel(JoinChannel)` — admission and top-up

<a id="req-sm-7"></a>

- **REQ-SM-7** — `_joinChannel` MUST handle both cases:
    - **New address:** incorporate the participant and its initial balance into state.
    - **Existing participant:** increase that participant's balance without changing membership
      (a top-up on a repeated join).

Joins arrive as inbound messages. The state machine dispatches the standard join message to the
join operation and MAY dispatch other message types to application-defined handlers.

### 6.2 `_removeParticipant(address)` — soft removal

The non-punitive exit is triggered by a validated **timeout** (unavailability). The
participant leaves with their balance; they are not treated as a fraudster. Returns
`(bool success, ExitChannel)`.

### 6.3 `_slashParticipant(address)` — punitive removal

The punitive exit for objectively proven fraud. The state machine decides how the penalty is
applied to the offender's balance. Returns `(bool success, ExitChannel)`.

### 6.4 Exits are outbound messages

An `ExitChannel` (participant + resulting balance) does not leave the channel by itself. The base
contract wraps it into a `MESSAGE_TYPE_EXIT` outbound message (`_addExitChannel`), outbound
messages accumulate during the transition, `stateTransition` returns them, and the off-chain participant batches
them into the hash-linked outbound message-block stream committed by the next snapshot
(see [history-and-commitments.md](./history-and-commitments.md) §5 and
[../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)). A normal transition
MAY also produce an exit; exits are not limited to removal and slashing.

<a id="req-sm-8"></a>

- **REQ-SM-8** — `slashParticipant` and `removeParticipant` MUST record their resulting
  `ExitChannel` identically: both produce the `MESSAGE_TYPE_EXIT` outbound message through the
  same path (`_addExitChannel`). The only permitted difference between the two is balance
  semantics inside the hooks: `_removeParticipant` is the soft path and MAY return the
  participant's full held balance, while `_slashParticipant` applies the application-defined
  penalty. _(Decided 2026-08-10, resolving [OQ-18](../open-questions.md).)_

## Assumptions and constraints

- All behavior that affects transition results is contained in the serialized state, injected transaction,
  function arguments, and fixed gas budget. External contract state and ambient EVM context are outside the
  deterministic model.
- `getState()` is a complete, canonical representation of every storage value transition logic can observe;
  `_setState` can restore that representation exactly.
- State-machine bytecode and state encoding remain fixed for the lifetime of a channel. A different version
  opens a different channel rather than upgrading an existing one in place.
- Balance arithmetic and custom `Balance.data` encodings are deterministic, bounded by the EVM execution/gas
  model, and reject invalid arithmetic or malformed encodings identically off-chain and on-chain.
- Participant identity is an address and author/time authority comes only from `_tx.header`. The protocol's
  generic leader check runs before transition execution.
- The current model has one transaction per block. Requirements phrased in terms of block authorship remain
  binding if block contents later expand.

If any assumption is false, deterministic replay and therefore fraud-proof soundness are not guaranteed. Such
an integration is non-conforming rather than a weaker supported mode.

## Security considerations

**Protected assets and properties:** channel funds, canonical state, participant authorization, replay
equivalence, balance conservation, and correct removal/slashing outcomes.

**Trust boundaries:** integrator-written state-machine code crosses from application policy into protocol
consensus; serialized bytes cross between local execution, peers, persistence, and on-chain replay; transaction
headers supply the only trusted author and time context.

**Primary threats and required defenses:**

- Ambient-context reads can make honest off-chain execution disagree with on-chain replay. REQ-SM-1 prohibits
  them and implementations must treat detection as a security failure.
- Incomplete or non-canonical serialization can hide state or create different hashes for equivalent states.
  INV-SM-2 and REQ-SM-2 through REQ-SM-4 require exact, stable round trips.
- Arithmetic overflow/underflow or ambiguous custom balance encodings can mint, destroy, duplicate, or trap
  value. REQ-BAL-1 through REQ-BAL-3 require deterministic rejection and canonical value semantics.
- Incorrect turn or membership handling can authorize the wrong participant, duplicate members, or produce an
  invalid exit. REQ-SM-5 through REQ-SM-8 define the protocol and hook boundaries.
- Unbounded transition work can exhaust the fixed gas budget and make otherwise valid history unreplayable.
  Integrators must define bounded state and collection sizes compatible with the configured gas limit.

**Residual gaps:** there is no generic static ambient-context checker, replay-equivalence harness, integrator
serialization property suite, top-up test, generic on-chain wrong-turn proof, or slash/remove symmetry test.
Until those gaps close, engineer review of an integrator contract remains a security-critical control.

## Requirements and invariants

This table is the normative requirement index. Detailed rules and rationale are defined in the sections above.

| Requirement / invariant | Statement                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `INV-SM-1`              | Transitions deterministic; identical state + transaction ⇒ identical result and outbound messages, off-chain and on-chain             |
| `REQ-SM-1`              | Author = `_tx.header.participant`, time = `_tx.header.timestamp`; ambient EVM context prohibited                                      |
| `INV-SM-2`              | `getState`/`_setState` exact inverses                                                                                                 |
| `REQ-SM-2`              | Canonical, deterministic, lossless serialization; equal states ⇒ equal bytes                                                          |
| `REQ-SM-3`              | Mappings only with complete deterministic key enumeration                                                                             |
| `REQ-SM-4`              | Ordering/encoding/round-trip defined explicitly; state machine and encoding immutable per channel (upgrades affect new channels only) |
| `REQ-BAL-1`             | `subtractBalance` rejects underflow                                                                                                   |
| `REQ-BAL-2`             | Balance operations pure/deterministic                                                                                                 |
| `REQ-BAL-3`             | `addBalance` and aggregations reject overflow (no wrapping)                                                                           |
| `REQ-SM-5`              | `getNextToWrite` authorizes the next block author (block-level rule)                                                                  |
| `REQ-SM-6`              | Turn authorization enforced generically at the protocol layer (pre-execution leader check); in-contract checks optional               |
| `REQ-SM-7`              | `_joinChannel` handles admission and top-up                                                                                           |
| `REQ-SM-8`              | Slash and remove record their `ExitChannel` identically via `_addExitChannel`; hooks differ only in balance semantics                 |
| `REQ-SM-9`              | Complete logical state-machine interface is exposed with canonical inputs, outputs, atomic failure, and cross-runtime equivalence     |

## Verification and test plan

The required tests treat an integrator state machine as a black box and repeat observable behavior across
local and on-chain execution where the requirement crosses that boundary. Passing one representative
transition is insufficient: every row below states its setup, observable result, and required permutations.
Implementation documents may add component-specific unit tests, and verification documents may add shared
cross-system methods, but neither creates a second hierarchy of specification tests.

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item                                                | Requirements / invariants | Setup and stimulus                                                                                                                                                                                           | Expected result                                                                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-sm-1.t1"></a>[`INV-SM-1.T1`](#inv-sm-1.t1)    | [`INV-SM-1`](#inv-sm-1)   | Restore the same serialized pre-state in independent local runners and the on-chain replay path, then submit the identical transition and gas limit.                                                         | Success/revert classification, resulting state bytes, and ordered outbound messages are identical in every runtime.                                  | <a id="inv-sm-1.t1.p1"></a>[`INV-SM-1.T1.P1`](#inv-sm-1.t1.p1) — Every public transition<br><a id="inv-sm-1.t1.p2"></a>[`INV-SM-1.T1.P2`](#inv-sm-1.t1.p2) — success and revert<br><a id="inv-sm-1.t1.p3"></a>[`INV-SM-1.T1.P3`](#inv-sm-1.t1.p3) — empty/minimum/typical/maximum supported state<br><a id="inv-sm-1.t1.p4"></a>[`INV-SM-1.T1.P4`](#inv-sm-1.t1.p4) — no outbound message, one, and many<br><a id="inv-sm-1.t1.p5"></a>[`INV-SM-1.T1.P5`](#inv-sm-1.t1.p5) — repeated execution.                                                                                                         |
| <a id="req-sm-1.t1"></a>[`REQ-SM-1.T1`](#req-sm-1.t1)    | [`REQ-SM-1`](#req-sm-1)   | Hold the injected header fixed while varying ambient sender, timestamp, block data, chain ID, balance, and gas context; then vary only the header.                                                           | Ambient changes cannot affect the result; changing the injected participant or timestamp affects only behavior that explicitly uses it.              | <a id="req-sm-1.t1.p1"></a>[`REQ-SM-1.T1.P1`](#req-sm-1.t1.p1) — Each prohibited value from §2.2 independently and in representative combinations<br><a id="req-sm-1.t1.p2"></a>[`REQ-SM-1.T1.P2`](#req-sm-1.t1.p2) — valid/wrong participant<br><a id="req-sm-1.t1.p3"></a>[`REQ-SM-1.T1.P3`](#req-sm-1.t1.p3) — timestamps before/at/after each application boundary.                                                                                                                                                                                                                                  |
| <a id="inv-sm-2.t1"></a>[`INV-SM-2.T1`](#inv-sm-2.t1)    | [`INV-SM-2`](#inv-sm-2)   | Serialize state, restore those bytes into a fresh instance, serialize again, and execute the same next transition on original and restored instances.                                                        | Bytes and logical state round-trip exactly, and both instances produce the same next result.                                                         | <a id="inv-sm-2.t1.p1"></a>[`INV-SM-2.T1.P1`](#inv-sm-2.t1.p1) — Empty/minimum/typical/maximum state<br><a id="inv-sm-2.t1.p2"></a>[`INV-SM-2.T1.P2`](#inv-sm-2.t1.p2) — every collection shape<br><a id="inv-sm-2.t1.p3"></a>[`INV-SM-2.T1.P3`](#inv-sm-2.t1.p3) — repeated round trips<br><a id="inv-sm-2.t1.p4"></a>[`INV-SM-2.T1.P4`](#inv-sm-2.t1.p4) — malformed bytes reject without partial mutation.                                                                                                                                                                                            |
| <a id="req-sm-2.t1"></a>[`REQ-SM-2.T1`](#req-sm-2.t1)    | [`REQ-SM-2`](#req-sm-2)   | Construct logically equal states through different valid operation orders and compare their encodings and hashes.                                                                                            | Equal logical states produce identical canonical bytes; every transition-readable field survives encode/decode.                                      | <a id="req-sm-2.t1.p1"></a>[`REQ-SM-2.T1.P1`](#req-sm-2.t1.p1) — Reordered construction and insertion<br><a id="req-sm-2.t1.p2"></a>[`REQ-SM-2.T1.P2`](#req-sm-2.t1.p2) — zero/default fields<br><a id="req-sm-2.t1.p3"></a>[`REQ-SM-2.T1.P3`](#req-sm-2.t1.p3) — every collection ordering<br><a id="req-sm-2.t1.p4"></a>[`REQ-SM-2.T1.P4`](#req-sm-2.t1.p4) — minimum/maximum values<br><a id="req-sm-2.t1.p5"></a>[`REQ-SM-2.T1.P5`](#req-sm-2.t1.p5) — omitted, duplicate, and malformed encodings reject.                                                                                           |
| <a id="req-sm-3.t1"></a>[`REQ-SM-3.T1`](#req-sm-3.t1)    | [`REQ-SM-3`](#req-sm-3)   | Populate every mapping-backed state shape, serialize and restore it, then enumerate and compare all keys and values.                                                                                         | Enumeration is complete, uniquely ordered, deterministic, and restores the exact mapping.                                                            | <a id="req-sm-3.t1.p1"></a>[`REQ-SM-3.T1.P1`](#req-sm-3.t1.p1) — Empty, one, and many keys<br><a id="req-sm-3.t1.p2"></a>[`REQ-SM-3.T1.P2`](#req-sm-3.t1.p2) — different insertion orders<br><a id="req-sm-3.t1.p3"></a>[`REQ-SM-3.T1.P3`](#req-sm-3.t1.p3) — duplicate and removed keys<br><a id="req-sm-3.t1.p4"></a>[`REQ-SM-3.T1.P4`](#req-sm-3.t1.p4) — minimum/maximum key and value<br><a id="req-sm-3.t1.p5"></a>[`REQ-SM-3.T1.P5`](#req-sm-3.t1.p5) — missing/stale enumeration entry.                                                                                                          |
| <a id="req-sm-4.t1"></a>[`REQ-SM-4.T1`](#req-sm-4.t1)    | [`REQ-SM-4`](#req-sm-4)   | Open a channel with one encoding, then attempt to replay its history with changed field order, encoding, or state-machine logic.                                                                             | The original encoding remains stable for that channel; incompatible changes cannot silently reinterpret existing state.                              | <a id="req-sm-4.t1.p1"></a>[`REQ-SM-4.T1.P1`](#req-sm-4.t1.p1) — Unchanged implementation<br><a id="req-sm-4.t1.p2"></a>[`REQ-SM-4.T1.P2`](#req-sm-4.t1.p2) — field reorder/add/remove/type change<br><a id="req-sm-4.t1.p3"></a>[`REQ-SM-4.T1.P3`](#req-sm-4.t1.p3) — logic-only change<br><a id="req-sm-4.t1.p4"></a>[`REQ-SM-4.T1.P4`](#req-sm-4.t1.p4) — old and newly opened channels.                                                                                                                                                                                                              |
| <a id="req-bal-1.t1"></a>[`REQ-BAL-1.T1`](#req-bal-1.t1) | [`REQ-BAL-1`](#req-bal-1) | Subtract through the public balance boundary and observe the returned balance or deterministic rejection.                                                                                                    | Amounts up to the held value subtract exactly; any uncovered fungible or custom value rejects without mutation.                                      | <a id="req-bal-1.t1.p1"></a>[`REQ-BAL-1.T1.P1`](#req-bal-1.t1.p1) — Zero from zero/nonzero<br><a id="req-bal-1.t1.p2"></a>[`REQ-BAL-1.T1.P2`](#req-bal-1.t1.p2) — less than, equal to, and one over held value<br><a id="req-bal-1.t1.p3"></a>[`REQ-BAL-1.T1.P3`](#req-bal-1.t1.p3) — maximum value<br><a id="req-bal-1.t1.p4"></a>[`REQ-BAL-1.T1.P4`](#req-bal-1.t1.p4) — missing/duplicate custom asset<br><a id="req-bal-1.t1.p5"></a>[`REQ-BAL-1.T1.P5`](#req-bal-1.t1.p5) — repeated failure and retry.                                                                                             |
| <a id="req-bal-2.t1"></a>[`REQ-BAL-2.T1`](#req-bal-2.t1) | [`REQ-BAL-2`](#req-bal-2) | Run each balance operation repeatedly with identical encoded inputs in independent instances and replay contexts.                                                                                            | Each operation returns or reverts identically and has no hidden state or ambient-context dependency.                                                 | <a id="req-bal-2.t1.p1"></a>[`REQ-BAL-2.T1.P1`](#req-bal-2.t1.p1) — Every balance operation<br><a id="req-bal-2.t1.p2"></a>[`REQ-BAL-2.T1.P2`](#req-bal-2.t1.p2) — zero/minimum/typical/maximum values<br><a id="req-bal-2.t1.p3"></a>[`REQ-BAL-2.T1.P3`](#req-bal-2.t1.p3) — canonical custom data<br><a id="req-bal-2.t1.p4"></a>[`REQ-BAL-2.T1.P4`](#req-bal-2.t1.p4) — success and rejection<br><a id="req-bal-2.t1.p5"></a>[`REQ-BAL-2.T1.P5`](#req-bal-2.t1.p5) — changed ambient context.                                                                                                         |
| <a id="req-bal-3.t1"></a>[`REQ-BAL-3.T1`](#req-bal-3.t1) | [`REQ-BAL-3`](#req-bal-3) | Add balances directly and through every aggregate path at and around the numeric and application-defined limits.                                                                                             | Valid sums are exact; overflow or duplicate custom value rejects rather than wrapping or partially updating state.                                   | <a id="req-bal-3.t1.p1"></a>[`REQ-BAL-3.T1.P1`](#req-bal-3.t1.p1) — Zero<br><a id="req-bal-3.t1.p2"></a>[`REQ-BAL-3.T1.P2`](#req-bal-3.t1.p2) — maximum minus one plus one<br><a id="req-bal-3.t1.p3"></a>[`REQ-BAL-3.T1.P3`](#req-bal-3.t1.p3) — maximum plus one<br><a id="req-bal-3.t1.p4"></a>[`REQ-BAL-3.T1.P4`](#req-bal-3.t1.p4) — multi-term aggregation where only the final term overflows<br><a id="req-bal-3.t1.p5"></a>[`REQ-BAL-3.T1.P5`](#req-bal-3.t1.p5) — duplicate NFT/custom asset<br><a id="req-bal-3.t1.p6"></a>[`REQ-BAL-3.T1.P6`](#req-bal-3.t1.p6) — retry after rejection.     |
| <a id="req-sm-5.t1"></a>[`REQ-SM-5.T1`](#req-sm-5.t1)    | [`REQ-SM-5`](#req-sm-5)   | Query the next writer from each reachable state, then attempt to author the next block as every participant and a non-participant.                                                                           | Exactly the returned address is authorized to author the next block.                                                                                 | <a id="req-sm-5.t1.p1"></a>[`REQ-SM-5.T1.P1`](#req-sm-5.t1.p1) — Every participant position<br><a id="req-sm-5.t1.p2"></a>[`REQ-SM-5.T1.P2`](#req-sm-5.t1.p2) — one and many participants<br><a id="req-sm-5.t1.p3"></a>[`REQ-SM-5.T1.P3`](#req-sm-5.t1.p3) — membership before/after join/removal<br><a id="req-sm-5.t1.p4"></a>[`REQ-SM-5.T1.P4`](#req-sm-5.t1.p4) — correct, wrong, missing, duplicate, and non-member author.                                                                                                                                                                        |
| <a id="req-sm-6.t1"></a>[`REQ-SM-6.T1`](#req-sm-6.t1)    | [`REQ-SM-6`](#req-sm-6)   | Submit correct- and wrong-author blocks through local validation and the on-chain dispute replay path using a state machine with no in-contract guard.                                                       | Correct blocks proceed; wrong-author blocks are rejected before execution in every required protocol path.                                           | <a id="req-sm-6.t1.p1"></a>[`REQ-SM-6.T1.P1`](#req-sm-6.t1.p1) — Live receipt, stored-block merge, spectating, calldata dispute, and non-calldata dispute<br><a id="req-sm-6.t1.p2"></a>[`REQ-SM-6.T1.P2`](#req-sm-6.t1.p2) — every participant position<br><a id="req-sm-6.t1.p3"></a>[`REQ-SM-6.T1.P3`](#req-sm-6.t1.p3) — forged and duplicate signatures.                                                                                                                                                                                                                                            |
| <a id="req-sm-7.t1"></a>[`REQ-SM-7.T1`](#req-sm-7.t1)    | [`REQ-SM-7`](#req-sm-7)   | Deliver a join through the public inbound-message path for a new participant and again for the same participant.                                                                                             | First delivery adds membership and value once; subsequent valid delivery tops up value without duplicating membership.                               | <a id="req-sm-7.t1.p1"></a>[`REQ-SM-7.T1.P1`](#req-sm-7.t1.p1) — New/existing/removed/slashed participant<br><a id="req-sm-7.t1.p2"></a>[`REQ-SM-7.T1.P2`](#req-sm-7.t1.p2) — zero/nonzero balance<br><a id="req-sm-7.t1.p3"></a>[`REQ-SM-7.T1.P3`](#req-sm-7.t1.p3) — duplicate, reordered, concurrent, and retried delivery<br><a id="req-sm-7.t1.p4"></a>[`REQ-SM-7.T1.P4`](#req-sm-7.t1.p4) — hook rejection without partial state.                                                                                                                                                                  |
| <a id="req-sm-8.t1"></a>[`REQ-SM-8.T1`](#req-sm-8.t1)    | [`REQ-SM-8`](#req-sm-8)   | Execute successful and failing soft-removal and slashing paths for equivalent participant states, then inspect state and outbound messages.                                                                  | Successful paths emit the same canonical exit shape; only penalty balance differs; failures leave no partial state or message.                       | <a id="req-sm-8.t1.p1"></a>[`REQ-SM-8.T1.P1`](#req-sm-8.t1.p1) — Zero/nonzero/maximum balance<br><a id="req-sm-8.t1.p2"></a>[`REQ-SM-8.T1.P2`](#req-sm-8.t1.p2) — existing/removed/slashed/non-member participant<br><a id="req-sm-8.t1.p3"></a>[`REQ-SM-8.T1.P3`](#req-sm-8.t1.p3) — hook success/failure<br><a id="req-sm-8.t1.p4"></a>[`REQ-SM-8.T1.P4`](#req-sm-8.t1.p4) — duplicate/retry<br><a id="req-sm-8.t1.p5"></a>[`REQ-SM-8.T1.P5`](#req-sm-8.t1.p5) — concurrent membership change<br><a id="req-sm-8.t1.p6"></a>[`REQ-SM-8.T1.P6`](#req-sm-8.t1.p6) — outbound processing success/failure. |
| <a id="req-sm-9.t1"></a>[`REQ-SM-9.T1`](#req-sm-9.t1)    | [`REQ-SM-9`](#req-sm-9)   | Exercise every interface capability through the public protocol boundary, snapshot state and outbound messages before and after, and repeat equivalent operations in every applicable execution environment. | Every required capability is reachable and has the specified canonical result; read-only and rejected operations leave state and messages unchanged. | <a id="req-sm-9.t1.p1"></a>[`REQ-SM-9.T1.P1`](#req-sm-9.t1.p1) — every interface capability<br><a id="req-sm-9.t1.p2"></a>[`REQ-SM-9.T1.P2`](#req-sm-9.t1.p2) — valid, boundary, malformed, and unsupported input<br><a id="req-sm-9.t1.p3"></a>[`REQ-SM-9.T1.P3`](#req-sm-9.t1.p3) — local and on-chain execution where applicable<br><a id="req-sm-9.t1.p4"></a>[`REQ-SM-9.T1.P4`](#req-sm-9.t1.p4) — read-only non-mutation<br><a id="req-sm-9.t1.p5"></a>[`REQ-SM-9.T1.P5`](#req-sm-9.t1.p5) — rejection without partial state or outbound messages.                                                 |

## Future Work

_Non-normative._

- Reduce on-chain replay storage cost: explore stateless/transient verification where the proof
  supplies prior state and input, execution computes the result in memory, and only the
  commitment is compared. Not a current defect; any design must preserve deterministic replay and
  ordinary state-machine ergonomics.
