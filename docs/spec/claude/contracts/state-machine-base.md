# `AStateMachine`: The State-Machine Integration Contract

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** The binding integration contract for application state machines:
> [`AStateMachine`](../../../../contracts/V1/AStateMachine.sol) (every hook, entry point, and
> invariant) and the integrator's consumer contract
> [`AConsumerFacet`](../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol).
> **Siblings:** [architecture.md](./architecture.md) (how the manager reaches this contract),
> [manager-and-facets.md](./manager-and-facets.md) (the manager ABI). The conceptual model —
> why determinism and serialization matter — is in
> [../concepts/state-machines.md](../concepts/state-machines.md); this document is the binding
> integration contract.

## 1. Purpose & observable contract

An application state machine is an EVM contract extending `AStateMachine`. Its storage variables
are the channel state; its functions are the allowed transitions. The **same bytecode** executes in
two places:

1. **Off-chain**, inside every participant's SDK EVM, on every proposed block.
2. **On-chain**, inside the manager's dispute and fraud-proof re-execution
   (`executeStateTransition`, `generateDisputeOutputState`, milestone/state-proof checks).

Both executions MUST produce identical results from identical inputs. Everything in this document
serves that one property: the fraud-proof system works only because a claimed transition can be
replayed bit-for-bit by someone else, later, in a different environment.

The base contract provides: the transition executor (`stateTransition`), inbound-message dispatch
(`processInboundMessage`), outbound-message accumulation, reentrancy-guarded wrappers used by the
manager during re-execution, and the abstract hooks the integrator implements.

### Assumptions, constraints & dependencies

- The state machine is deployed as a standalone contract whose address the manager stores as
  `stateMachineImplementation`. All channels currently share one instance; its storage is
  scratch space that the manager overwrites via `setState` before every use.
- `gasLimit` (constructor argument) bounds each transition's execution. It must be identical in the
  off-chain and on-chain deployments, or a transition could succeed in one and run out of gas in
  the other. The manager's own default for dispute execution is 3,000,000
  (see [manager-and-facets.md §3](./manager-and-facets.md#3-timing--execution-configuration)).
- The `external` entry points are guarded by a simple `_nonReentrant` flag, not by caller
  authorization. Anyone can call `setState`/`stateTransition`/`joinChannel`/`slashParticipant`/
  `removeParticipant` on the deployed implementation. This is safe only because the instance's
  storage is treated as scratch — no funds or authority derive from it. Integrators MUST NOT
  attach value or trust to the implementation instance's own storage between manager calls.
- Observed fact: the field `_stateChannelManager` is declared but never assigned or read in
  `AStateMachine`. It is dead weight in the current base contract.

## 2. Virtual hooks (what the integrator implements)

Reference example used below:
[`MathStateMachine`](../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol).

| Hook                                                                          | Signature (verified)                                                                       | Contract                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_setState`                                                                   | `function _setState(bytes memory encodedState) internal virtual`                           | Restore the full contract state from its canonical encoding.                                                                                                                                   |
| `getState`                                                                    | `function getState() public view virtual returns (bytes memory)`                           | Serialize the full contract state to its canonical encoding.                                                                                                                                   |
| `getParticipants`                                                             | `function getParticipants() public view virtual returns (address[] memory)`                | The channel's current **participant identities** (addresses). Membership only — a participant may have an associated balance, but membership and balance representation are separate concerns. |
| `getNextToWrite`                                                              | `function getNextToWrite() public view virtual returns (address)`                          | The address authorized to author the next **block** (see below).                                                                                                                               |
| `_joinChannel`                                                                | `function _joinChannel(JoinChannel memory) internal virtual returns (bool)`                | Admission **and** top-up (see below).                                                                                                                                                          |
| `_slashParticipant`                                                           | `function _slashParticipant(address) internal virtual returns (bool, ExitChannel memory)`  | Punitive removal for provable fraud. Defines how the penalty is applied; returns the resulting `ExitChannel`.                                                                                  |
| `_removeParticipant`                                                          | `function _removeParticipant(address) internal virtual returns (bool, ExitChannel memory)` | Soft removal (timeout, self-removal). No punishment implied; returns the resulting `ExitChannel`.                                                                                              |
| `addBalance` / `subtractBalance` / `areBalancesEqual` / `isBalanceLesserThan` | `pure virtual`, over `Balance {uint256 amount; bytes data;}`                               | The application-defined balance algebra.                                                                                                                                                       |
| `getTotalStateBalance`                                                        | `function getTotalStateBalance() public view virtual returns (Balance memory)`             | Total value accounted inside the current state (feeds the channel-balance invariant — [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)).                             |
| `getZeroBalance`                                                              | `function getZeroBalance() public pure virtual returns (Balance memory)`                   | The algebra's zero element.                                                                                                                                                                    |
| `_processCustomInboundMessage`                                                | `function _processCustomInboundMessage(Message calldata) internal virtual returns (bool)`  | Optional: handle inbound message types beyond `JOIN`. Default returns `false` (message rejected).                                                                                              |

### 2.1 `_setState` / `getState` are exact inverses

**INV-CON-5.** `_setState(getState())` MUST leave the state unchanged, and
`getState()` after `_setState(b)` MUST return an encoding equivalent to `b` for all state reachable
by the protocol. Round-trip loss breaks agreement (peers compute different state hashes) and breaks
dispute re-execution (the chain restores a different state than the prover intended).
Serialization requirements are in §5.

### 2.2 `getNextToWrite` authorizes the next block author

`getNextToWrite()` returns the participant authorized to author the next **block** — not the next
transaction. The protocol's authorization rule is block-level.

`Current:` the implementation places exactly one transaction in each block, so block-author and
transaction-author selection look equivalent, and the reference implementations check it per
transaction (`MathStateMachine.add` requires `_tx.header.participant == getNextToWrite()`).
`Intended:` the normative rule is block-level and MUST remain so if block contents evolve to hold
multiple transactions; do not encode a per-transaction assumption into new integrations or new
protocol code. See [../protocol/finality.md](../protocol/finality.md) for the leader schedule
built on this hook.

**REQ-CON-7.** Turn authorization is enforced by the protocol layer, not by the state machine:
the SDK validation pipeline rejects a block whose author (`_tx.header.participant`) is not
`getNextToWrite()` for the pre-state before executing it, generically for every state machine
([`ValidationService`](../../../../src/stateManager/ValidationService.ts) leader check). The base
contract does not enforce it either — `stateTransition` executes whatever calldata it is given.
In-contract wrong-turn `require`s (as in the examples) are optional defense in depth, never a
soundness requirement. _(Corrected 2026-08-10 on engineer review; previously stated as a
mandatory in-contract check.)_

Current: the source comment above `stateTransition`
([`AStateMachine.sol`](../../../../contracts/V1/AStateMachine.sol)) still claims wrong-turn
fraud-proof soundness depends on the implementation's check, and the on-chain
`BlockInvalidStateTransition` handler indeed performs no author check of its own — the comment
matches today's on-chain behavior but contradicts the decided design. See
[OQ-26](../open-questions.md) for the resolution options (generic on-chain author check vs.
confirming no on-chain wrong-turn proof is needed).

### 2.3 `_joinChannel` handles both admission and top-up

**REQ-CON-10.** `_joinChannel(JoinChannel)` MUST implement two cases:

- **New participant:** incorporate the address into the participant set with its initial balance.
- **Existing participant:** increase that participant's balance; membership is unchanged.

Verified in code: the base contract documents it ("Adds a new participant, or tops up an existing
participant on a repeated join") and `MathStateMachine._joinChannel` implements exactly this
branch (existing → `balances[i] += amount`, else push). The manager-side entry points are split
(`joinChannel` vs `topUpBalance` on the proxy,
[manager-and-facets.md §4.1](./manager-and-facets.md#41-joinchannelfacet)), but both funnel to the
same inbound `JOIN` message and therefore to this one hook.

### 2.4 Balance algebra

The `Balance {uint256 amount; bytes data;}` type is deliberately more general than an integer:
`amount` covers the common case, `data` carries application-defined structure (multi-asset,
NFTs, composite claims). The state machine owns the semantics through the four algebra hooks.

**REQ-CON-8.** `subtractBalance(a, b)` MUST revert when `b` exceeds `a` under the application's
ordering (underflow rejection). The signature's contract is stated in the base
("return the balance1 - balance2 OR throw an error if balance1 < balance2") and
`MathStateMachine.subtractBalance` implements the `require`. This is what makes value conservation
enforceable: the manager's deposit/withdrawal accounting (`_appendInboundMessages`,
`_applyOutboundMessageBlocks`, `verifyBalanceInvariantCheckSnapshot`) is built from `addBalance` /
comparisons and relies on the algebra never fabricating value. The algebra hooks MUST be
deterministic and MUST be `pure` (they are declared `pure`; an implementation cannot read ambient
state).

## 3. System entry points (provided by the base)

Exact semantics from source:

### 3.1 `stateTransition(Transaction calldata) external _nonReentrant returns (bool, Message[] memory)`

1. `_clearOutboundMessages()` — deletes the accumulated outbound messages of the previous run.
2. `_tx.header = transaction.header` — injects the execution context (§4). Only the header is
   stored; `_tx.body` is never assigned.
3. `address(this).call{gas: gasLimit}(transaction.body.data)` — executes the transaction body as a
   self-call, so the target is one of the state machine's own public functions.
4. On failure: bubbles the inner revert data verbatim; if the inner call returned no data, reverts
   with `"AStateMachine - Call failed - result length 0"`.
5. On success: returns `(true, copy of _outboundMessages)` — every message the transition recorded
   via `_addOutboundMessage` / `_addExitChannel`.

Consequences: a transition either succeeds fully or reverts fully (no partial outbound state
observable to the caller); outbound messages produced by a failed transition are lost with the
revert; and messages accumulate only within a single transition, never across transitions.

### 3.2 `processInboundMessage(Message calldata) external _nonReentrant returns (bool)`

Dispatch: `messageType == MESSAGE_TYPE_JOIN` (`keccak256("JOIN_CHANNEL_MESSAGE")`,
[MessageTypeHashes.sol](../../../../contracts/V1/types/MessageTypeHashes.sol)) → decode
`JoinChannel` → `_joinChannel`. Anything else → `_processCustomInboundMessage` (default `false`).
The manager calls this during dispute output generation (`_applyInboundMessages`) and requires
success — a `false` return reverts the manager with
`ErrorDisputeStateMachineInboundProcessingFailed`.

### 3.3 Guarded wrappers used during on-chain re-execution

| Wrapper                                                                                 | Behavior (verified)                                                                                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `setState(bytes) external _nonReentrant`                                                | Calls `_setState`. The manager's precursor to every re-execution.                                                      |
| `joinChannel(JoinChannel) external _nonReentrant returns (bool)`                        | Calls `_joinChannel` directly (used by `applyJoinChannelToStateMachine`).                                              |
| `slashParticipant(address) external _nonReentrant returns (bool, ExitChannel)`          | Calls `_slashParticipant`; on success **also** appends the `ExitChannel` to `_outboundMessages` via `_addExitChannel`. |
| `removeParticipant(address) external virtual _nonReentrant returns (bool, ExitChannel)` | Calls `_removeParticipant`; does **not** append to `_outboundMessages`.                                                |

Observed fact: the slash and remove wrappers are asymmetric — `slashParticipant`
([AStateMachine.sol:116](../../../../contracts/V1/AStateMachine.sol#L116)) pushes the exit into
the machine's outbound buffer via `_addExitChannel`, `removeParticipant`
([AStateMachine.sol:124](../../../../contracts/V1/AStateMachine.sol#L124)) does not. The
manager's dispute pipeline ignores the buffer in both cases (it builds the outbound message
block from the returned `ExitChannel`s in
[`DisputeVerificationFacet._applySlashesToStateMachine` / `_removeParticipantsFromStateMachine`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol)),
so the pushed message is currently inert leftover state on the shared implementation instance.

**Decided (2026-08-10, [OQ-18](../open-questions.md)):** the wrappers MUST be symmetric — both
record the exit through `_addExitChannel`. The only intended difference between removal and
slashing is hook-level balance semantics: removal is the less aggressive path and may return the
participant's full held balance; slashing applies the application's penalty. `removeParticipant`
is to be brought in line (REQ-SM-8 in
[../concepts/state-machines.md](../concepts/state-machines.md)); the table above documents
current behavior until then.

### 3.4 `getOutboundMessages() public view returns (Message[] memory)`

Returns the messages recorded by the last (successful, un-cleared) transition — e.g. `EXIT`
messages built by `_addExitChannel` (`MESSAGE_TYPE_EXIT`, message `data` = `abi.encode(ExitChannel)`,
`participant`/`balance` mirrored from the exit). Outbound messages are how a transition instructs
the chain; their journey to L1 is specified in
[../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md).

## 4. Deterministic execution context

**REQ-CON-6.** During a transition, a state machine MUST derive its behavior only from:

| Allowed context                            | Meaning                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| its own storage (the deserialized state)   | The pre-state of the transition.                                                                                |
| `transaction.body.data` calldata arguments | The transition's input, as decoded function arguments.                                                          |
| `_tx.header.participant`                   | The logical author of the transaction — the protocol's caller identity.                                         |
| `_tx.header.timestamp`                     | The protocol's logical time for this transition (chain-time model: [../protocol/time.md](../protocol/time.md)). |
| `_tx.header.channelId`                     | The channel this transition belongs to.                                                                         |
| `_tx.header.forkId`                        | The fork this transition belongs to.                                                                            |
| `_tx.header.transactionCnt`                | The transition's height/sequence number.                                                                        |
| `gasLimit` (constant after construction)   | Fixed execution bound, identical across environments.                                                           |

This is the complete injected API: `stateTransition` sets `_tx.header` and nothing else
(`_tx.body` is never populated — do not read it).

Prohibited: any ambient EVM context that cannot be replayed identically on-chain. In particular
`msg.sender` (during replay the caller is the manager or the machine itself, never the author),
`block.timestamp`, `block.number`, `blockhash`, `block.prevrandao`/`difficulty`, `block.coinbase`,
`block.basefee`, `msg.data` (the outer calldata differs between direct execution and replay paths),
`msg.value`, `tx.origin`, `tx.gasprice`, `gasleft()`, `address(this).balance`, and the machine's
own address (`address(this)` differs per deployment). Any use of prohibited context is a
**correctness and fraud-proof vulnerability**: the honest re-execution can diverge from the
author's execution, which either lets an invalid state stand or lets an honest author be slashed
via `BlockInvalidStateTransition`.

Reference pattern (verified): `MathStateMachine` gates turns with
`_tx.header.participant == getNextToWrite()` and never touches `msg.sender`.

Emitting events is permitted (events do not affect the state hash), but event arguments must not
feed back into state. Observed fact: `MathStateMachine.leaveChannel` calls `console.log` — dev-only
tooling that MUST NOT appear in a production state machine (external staticcall precompile
interaction; see also the size concerns in [architecture.md §3](./architecture.md#3-deployment-size-constraint)).

There is currently no static check for prohibited context — review guidance only
(**none — gap**; see Future Work).

## 5. Serialization requirements

**REQ-CON-9.** The `getState`/`_setState` encoding MUST be canonical, lossless, and deterministic:

- **Canonical:** one logical state has exactly one encoding. Two honest peers holding the same
  logical state MUST produce byte-identical `getState()` output, because the protocol compares
  states by `keccak256(getState())`. Equivalent-but-different encodings would break agreement.
- **Lossless:** the encoding carries everything execution and proof verification need.
  `_setState(getState())` reconstructs the same logical state (INV-CON-5).
- **Deterministic:** ordering, encoding, and any versioning are fixed rules, not iteration
  artifacts.
- **Mappings** are permitted only when the state also maintains a complete, deterministic key
  enumeration and serialization scheme, and `_setState` restores both the mapping and its
  enumeration consistently. A bare `mapping` is unserializable in Solidity (keys are not
  enumerable), so states that use one without a parallel key registry cannot satisfy this
  requirement. The reference implementation avoids the problem with parallel arrays
  (`participants[]` / `balances[]`).

### 5.1 What commits to the serialized state

The commitment is **indirect, via the snapshot hierarchy**. A block does not commit to the
serialized state directly:

```text
Block.stateSnapshotHash  =  keccak256(abi.encode(StateSnapshot))
StateSnapshot.snapshotData.stateMachineStateHash  =  keccak256(getState())
```

So: a block commits to a `StateSnapshot`; the snapshot's `SnapshotData` contains — among its other
required fields (participants, inbound/outbound stream tips and heights, deposit and withdrawal
totals) — the hash of the encoded state-machine state. The serialized state is therefore committed
through `block → stateSnapshotHash → snapshotData.stateMachineStateHash`. Agreement and dispute
verification operate at the snapshot level and descend to the state hash only when the full state
is supplied (types: [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol); full hierarchy:
[../concepts/history-and-commitments.md](../concepts/history-and-commitments.md)).

## 6. Invariants (summary)

- **INV-CON-5** — `_setState`/`getState` are exact inverses (§2.1).
- **REQ-CON-6** — transitions read only the allowed execution context (§4).
- **REQ-CON-7** — turn authorization is protocol-enforced; in-contract checks optional (§2.2).
- **REQ-CON-8** — `subtractBalance` rejects underflow; the algebra conserves value (§2.4).
- **REQ-CON-9** — serialization is canonical, lossless, deterministic; mappings only with
  deterministic key enumeration (§5).
- **REQ-CON-10** — `_joinChannel` covers admission and top-up (§2.3).
- Determinism corollary: identical prior state + identical transaction ⇒ identical `(success,
post-state, outbound messages)` in every environment.

## 7. `AConsumerFacet`: the integrator consumer contract

[`AConsumerFacet`](../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol) is the
integrator-provided facet reached through the proxy's fallback
([architecture.md §2](./architecture.md#2-current-topology)). It defines how the channel touches
world state (tokens, external contracts). Reference:
[`MathConsumerFacet`](../../../../contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol).

| Function             | Signature (verified)                                                                                                                                                                                         | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openChannelGenesis` | `function openChannelGenesis(JoinChannel[] memory successfulJoinChannels, bytes memory optionalOpeningData) external pure virtual returns (bytes memory encodedGenesisState, address[] memory participants)` | Build the channel's initial serialized state and participant list from the joins that deposited successfully. MUST be pure: genesis is derived only from its inputs, so every peer recomputes the same genesis. The returned state MUST satisfy the balance invariant (`totalDeposits == totalWithdrawals + getTotalStateBalance()` over the genesis state) — `MathConsumerFacet` seeds its state to the deposit sum for exactly this reason. |
| `deposit`            | `function deposit(JoinChannel memory) external virtual returns (bool)`                                                                                                                                       | Pull/secure the committed assets for one join. Called (via delegatecall, in proxy storage context) from `depositAssetsComposable` during `open`, `joinChannel`, and `topUpBalance`. Return `false` to signal a failed deposit; under `isAtomic` opening a failure reverts the whole open.                                                                                                                                                     |
| `withdraw`           | `function withdraw(ExitChannel memory) external virtual returns (bool)`                                                                                                                                      | Release settled assets for one exit. Called from `withdrawAssetsComposable` when the on-chain snapshot advances and the outbound stream is processed ([../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)).                                                                                                                                                                                                            |

Because the consumer facet runs as a delegatecall target of the proxy, it inherits
`StateChannelManagerStorage` and executes against the manager's storage.

**Inferred concern / Open question (reachability):** the proxy fallback forwards **every**
unmatched selector to the consumer facet, so `deposit` and `withdraw` are directly callable by any
external account at the proxy address — the `onlySelf` guard sits on `depositAssetsComposable` /
`withdrawAssetsComposable`, not on the consumer functions they delegate to. A consumer facet whose
`withdraw` transfers assets based solely on its `ExitChannel` argument would be drainable by a
direct call. The reference implementation is a no-op so it is not exposed, but the base contract
neither guards these entry points nor documents that integrators must. Resolution needed: either
the framework restricts the fallback / guards consumer entry points, or the integration contract
normatively requires consumer facets to verify `msg.sender == address(this)` themselves. Until
resolved, integrators SHOULD add a self-call check in `deposit`/`withdraw`.

## 8. Verification

- **Round trip (INV-CON-5) and hook behavior:** exercised continuously by every e2e suite (all SDK
  execution replays through `getState`/`_setState`), but there is no dedicated
  property/round-trip unit test for the reference machines — gap.
- **Wrong-turn rejection (REQ-CON-7):** on-chain side covered by
  `test_blockInvalidStateTransition_wrongTurnWithCorrectSnapshot_slashesSigner` in
  [FraudProofFacet.t.sol](../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol);
  end-to-end fraud path in
  [E2E-FraudProofsBlockConfirmation.test.ts](../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts).
- **Transition execution & lifecycle:**
  [E2E-StateTransition.test.ts](../../../../test/e2e/E2E-StateTransition.test.ts),
  [E2E-ParticipantLifecycle.test.ts](../../../../test/e2e/E2E-ParticipantLifecycle.test.ts)
  (join/remove/slash/exit through the real pipeline).
- **Determinism across environments (REQ-CON-6):** verified implicitly wherever off-chain execution
  and on-chain replay must agree (dispute-validation suites under
  [test/e2e/disputeValidation](../../../../test/e2e/disputeValidation)); no targeted
  same-input/same-output differential test — gap.
- **What a new integration must test locally:** state round trips (including every reachable shape
  of the state struct), the balance algebra (underflow rejection, commutativity/associativity of
  `addBalance` as used, zero element), wrong-author rejection for every public transition,
  `_joinChannel` in both admission and top-up cases, and genesis balance-invariant satisfaction.

## Future Work

_Non-normative._

- Static or lint-level detection of prohibited ambient context (`msg.sender`, `block.timestamp`,
  `msg.data`, …) in contracts extending `AStateMachine`; at minimum a review checklist.
- A differential test harness that runs the same transitions off-chain and via
  `executeStateTransition` and asserts byte-identical results.
- Implement the decided `removeParticipant` symmetry fix (§3.3, REQ-SM-8): both wrappers record
  the exit via `_addExitChannel`; hooks differ only in balance semantics.
- Resolve the consumer-facet reachability question (§7) — framework guard vs. documented
  integrator obligation.
- Remove the dead `_stateChannelManager` field, or wire it and define its purpose.
- A stateless/transient-state verification design that avoids persistent storage writes during
  on-chain replay (proof supplies prior state + input, execution compares the computed commitment)
  — a gas optimization to evaluate against developer ergonomics; not a current defect.
- Provide a composite/non-fungible `Balance` reference implementation alongside the integer
  example, with tests proving deterministic application-defined handling.
- Base-contract enforcement of REQ-CON-7 (author check in `stateTransition`) instead of relying on
  every integrator's modifier discipline — needs design (the base cannot know the pre-state's
  author without convention).

## Traceability

| ID         | Statement                                                                                                                                                                                                                   | Implementation                                                                                                                                                                                                                                      | Verification evidence                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-CON-5  | `_setState(getState())` leaves state unchanged; the pair is an exact inverse for all protocol-reachable state.                                                                                                              | [AStateMachine.sol](../../../../contracts/V1/AStateMachine.sol) (abstract pair); [MathStateMachine.sol](../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol) (`abi.encode`/`abi.decode` of one struct)                          | Implicit in all suites under [test/e2e](../../../../test/e2e); no dedicated round-trip property test — gap                                                                                                                                                                                                                                                                                            |
| REQ-CON-6  | Transitions use only the injected context (`_tx.header.*`, own state, calldata args, `gasLimit`); ambient EVM context (`msg.sender`, `block.timestamp`, `msg.data`, …) is prohibited.                                       | [AStateMachine.sol](../../../../contracts/V1/AStateMachine.sol) (`stateTransition` sets `_tx.header`); [MathStateMachine.sol](../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol) (author checks via `_tx.header.participant`) | Off-chain/on-chain agreement exercised by [test/e2e/disputeValidation](../../../../test/e2e/disputeValidation); no static check or differential test — gap                                                                                                                                                                                                                                            |
| REQ-CON-7  | Turn authorization is protocol-enforced (SDK pre-execution leader check); in-contract checks are optional defense in depth. Authorization is block-author-level (one tx per block today makes it look tx-level).            | [ValidationService.ts](../../../../src/stateManager/ValidationService.ts); optional in-contract guards: [MathStateMachine.sol](../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol) (`add`, `leaveChannel` requires)            | [test/unit/ValidationService.test.ts](../../../../test/unit/ValidationService.test.ts) (wrong-leader rejection); [FraudProofFacet.t.sol](../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol) `test_blockInvalidStateTransition_wrongTurnWithCorrectSnapshot_slashesSigner` covers only the in-contract-guard path; generic on-chain check: none — gap ([OQ-26](../open-questions.md)) |
| REQ-CON-8  | `subtractBalance` MUST revert on underflow; the balance algebra is deterministic and pure.                                                                                                                                  | [AStateMachine.sol](../../../../contracts/V1/AStateMachine.sol) (contract comment); [MathStateMachine.sol](../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol) (`require(balance1.amount >= balance2.amount)`)                 | Balance-invariant paths in [test/e2e/disputeValidation/balanceInvariant.test.ts](../../../../test/e2e/disputeValidation/balanceInvariant.test.ts); no direct algebra unit test — gap                                                                                                                                                                                                                  |
| REQ-CON-9  | State serialization is canonical, lossless, deterministic; mappings only with a complete deterministic key-enumeration scheme; commitment is indirect via `block → stateSnapshotHash → snapshotData.stateMachineStateHash`. | [AStateMachine.sol](../../../../contracts/V1/AStateMachine.sol); [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol) (`Block`, `StateSnapshot`, `SnapshotData`)                                                                           | Snapshot/commitment linkage exercised in [test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts](../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) and [test/models/StateSnapshot.test.ts](../../../../test/models/StateSnapshot.test.ts); canonicalization property tests — none — gap                                                          |
| REQ-CON-10 | `_joinChannel` admits a new participant with its initial balance, or tops up an existing participant's balance without changing membership.                                                                                 | [AStateMachine.sol](../../../../contracts/V1/AStateMachine.sol) (hook contract comment); [MathStateMachine.sol](../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol) (`_joinChannel` both branches)                             | [E2E-ParticipantLifecycle.test.ts](../../../../test/e2e/E2E-ParticipantLifecycle.test.ts), [E2E-JoinChannelRaceConditions.test.ts](../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts); direct top-up unit test — none — gap                                                                                                                                                                  |
