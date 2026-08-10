# Application state-machine and consumer integration contract

## Status and authority

This chapter defines what an integrator must implement for peer execution, fraud replay, dispute successor generation, accounting, and asset settlement to agree. Application code is trusted deployment code but still must satisfy these testable requirements.

## 1. Purpose

The protocol is application-neutral. It cannot know poker rules, participant balances, turn order, or punishment. The state machine supplies deterministic application behavior. The consumer supplies chain asset deposit and withdrawal behavior. Their outputs become protocol commitments, so any nondeterminism or accounting mismatch can split peers or strand funds.

## 2. Design decisions and rationale

### 2.1 State is explicit serialized bytes

Before each replay, the manager loads encoded state into the application contract. After execution, it reads encoded state back and hashes it. This lets peers and contracts replay without storing every application variable in manager storage.

### 2.2 Transaction author context is in the transaction

Application authorization reads the committed transaction header, not EVM `msg.sender`, because execution may occur through different peer, local contract, or fraud-proof callers. `msg.sender` identifies the executor, not the off-chain participant.

### 2.3 Balance algebra is application-defined but manager-enforced

`Balance` has amount and custom data. The application defines zero, add, subtract, equality, less-than, and total in-state balance. The manager uses these to enforce conservation across deposits, withdrawals, joins, exits, slashes, and custom assets.

### 2.4 Slash and removal are different operations

Slash may punish and remove. Removal exits without Byzantine punishment. Both return an `ExitChannel` when successful. Timeout and self-removal use removal; objective on-chain slash uses slash.

### 2.5 Outbound messages are transition output

The application emits ordered messages during one transition. The runtime reads and clears them per call. They are committed into an outbound message block by protocol code, not sent directly to the consumer off chain.

## 3. Boundary and responsibilities

The state machine owns application state, participant order, next author, transaction logic, inbound application, balance algebra, slash, removal, and outbound message creation. It does not decide block ancestry, signatures, fork adoption, proof validity, chain deadlines, or stream settlement.

The consumer owns actual asset deposit, withdrawal, genesis construction, and custom L1 message effects. It does not decide application transition validity or recovery winner.

## 4. Interface and state

### 4.1 State serialization

`_setState(bytes)` decodes the complete application state. `getState()` returns one canonical encoding. `getParticipants()` and all other views after `setState` must derive only from that decoded state.

Canonical means equal semantic state produces identical bytes across every runtime. Mapping iteration, object key order, padding ambiguity, compiler-dependent memory, and omitted default fields are not allowed.

### 4.2 Author selection

`getNextToWrite()` returns exactly one active participant for a nonterminal state, or a documented zero/terminal representation. V1 recommended policy is round-robin based on participant order and application progress. It must not depend on local wall time, caller, network, or random source outside committed state.

### 4.3 Transaction execution

`stateTransition(transaction)` clears prior outbound messages, stores transaction header as application author context, and invokes encoded application function with fixed gas. It returns success and ordered outbound messages. Revert reason is preserved for deterministic fraud replay.

### 4.4 Inbound processing

`processInboundMessage` handles JOIN or delegates a versioned custom type. JOIN decodes exact `JoinChannel` and calls application join. A repeated JOIN for an existing participant is a top-up under application rules. Unsupported messages return false or a typed deterministic revert.

### 4.5 Membership changes

`_joinChannel` adds new participant or balance to existing participant. `_removeParticipant` removes without penalty. `_slashParticipant` applies application punishment and normally removes. Resulting `getParticipants()` defines later author and finality context.

Participant order must be deterministic. Joining at different array positions changes leader schedule and state hash. The application must define insertion and removal order.

### 4.6 Exit result

Successful slash or removal returns participant and `Balance`. Protocol wrapper turns it into EXIT message whose outer balance equals encoded inner balance. Returning success with zero/incorrect participant or balance is invalid integration behavior.

### 4.7 Consumer

`openChannelGenesis(successfulJoins, openingData)` returns encoded genesis and participants. `deposit(join)` transfers or locks assets and returns success. `withdraw(exit)` releases assets and returns success. Application-specific custom outbound types need explicit consumer entry points and accounting.

### 4.8 Allowed execution context

Application logic may read only context that the manager can inject and reproduce during peer and contract replay:

| Needed value             | Allowed source                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| logical author           | `_tx.header.participant`                                                                              |
| protocol timestamp       | `_tx.header.timestamp`                                                                                |
| channel and fork         | `_tx.header.channelId` and `_tx.header.forkId`                                                        |
| transaction position     | `_tx.header.transactionCnt`                                                                           |
| application arguments    | typed arguments decoded by the selected call from committed `TransactionBody.data`                    |
| application metadata     | committed `TransactionBody.encodedData`, after the integration defines its relation to call arguments |
| prior application state  | state restored from canonical bytes whose hash is in the predecessor snapshot                         |
| eligible inbound effects | ordered messages supplied and verified by the manager                                                 |

Application code must not use native `msg.sender` as participant, raw `msg.data` as an unstated second payload, `block.timestamp`, `block.number`, `blockhash`, `tx.origin`, `tx.gasprice`, `gasleft` as a semantic branch, EVM balance queries, external mutable contract reads, or an uncommitted random source. `msg.sender` is the execution wrapper. Native block values differ between local and enforcement execution.

The current base exposes `_tx.header` but does not provide a complete versioned context object or an explicit accessor for `TransactionBody.encodedData`. A production integration API should expose one read-only context struct and make unsupported native use part of review and static analysis.

### 4.9 Balance examples

The repository's math example implements a scalar balance:

```text
Balance.amount = fungible units
Balance.data   = empty bytes
add/subtract   = uint256 arithmetic with underflow rejection
less-than      = numeric comparison
state total    = sum of participant amounts
```

A composite example could represent two fungible assets as canonical ABI data:

```text
Balance.amount = asset-A units
Balance.data   = abi.encode(asset-B units)
add/subtract   = component-wise arithmetic
equal          = both components equal
less-than      = both components <= and at least one <
state total    = component-wise participant sum
```

A nonfungible example cannot use numeric addition as ownership. It could encode a sorted list of `(collection, tokenId)` pairs in `data`, require unique pairs, define addition as disjoint set union, subtraction as proved subset removal, equality as byte-identical canonical sets, and state total as the union of all owned pairs. `amount` must have one fixed meaning, such as item count, and must equal the decoded set length.

These examples show the required algebra contract; they do not declare multi-asset or nonfungible support complete. Each consumer must prove that escrowed assets and encoded components correspond exactly. Current tests cover the scalar example only.

## 5. Preconditions

Before any state-machine call, caller must set exact state whose hash matches the relevant snapshot. Transaction header channel/fork/author/count/time and inbound range are already protocol-validated or are being tested by fraud replay.

Integrator requires:

- every state and message decoder rejects trailing or malformed data consistently;
- participant addresses are unique and nonzero;
- state contains enough data to derive next author and total balance;
- all arithmetic is overflow-safe and rejects underflow;
- gas limit covers maximum supported state and transition;
- custom balance data has canonical encoding and comparison meaning.

Consumer requires trusted manager caller, exact asset and channel context, allowance or value, reentrancy protection, and replay-safe withdrawal identity through manager outbound tip.

## 6. Processing algorithms

### 6.1 Ordinary transition

1. Decode and validate complete prior state.
2. Clear outbound buffer.
3. Set committed transaction header context.
4. Require header participant equals `getNextToWrite` inside application as defense in depth.
5. Decode application call selector and arguments from transaction body.
6. Execute deterministic application rules under gas bound.
7. update state and append outbound messages in defined order;
8. validate internal state invariants;
9. return success and a copy of outbound messages;
10. caller serializes state and constructs snapshot.

The same call order and gas semantics must be used in peer execution and contract invalid-transition proof.

### 6.2 Join or top-up

1. Verify message type and inner/outer participant and balance equality.
2. For new participant, require not already present and insert at defined position.
3. For top-up, require present and add balance.
4. update any application turn, seat, or status data deterministically;
5. require total application balance increases by message balance;
6. return true.

### 6.3 Slash

1. Require target is an active application participant unless idempotent no-op is explicitly accepted.
2. Compute penalty and recoverable exit balance under documented application policy.
3. remove target and update turn/order safely;
4. add EXIT message for recoverable balance when any;
5. ensure application total plus exit change preserves conservation;
6. return success and exact exit.

Penalty destination, burning, redistribution, or treasury effect must be explicit and included in balance algebra. It cannot disappear from accounting.

### 6.4 Removal

1. Require target present.
2. compute full nonpenalized exit balance;
3. remove target and update turn/order;
4. return exit and preserve conservation.

### 6.5 Genesis

1. Receive successful deposits in signed opening order.
2. validate application opening data and supported participant count;
3. construct state with exactly successful unique participants and deposited balances;
4. set deterministic first author and application phase;
5. return canonical encoded state and same participant ordering;
6. manager verifies state hash, participant set, and total balance against deposits.

### 6.6 Consumer asset effect

Deposit and withdrawal follow checks-effects-interactions or a reentrancy guard. A failed transfer returns false or reverts in a documented way. Success means the exact balance representation is backed or released. Token callbacks cannot reenter another manager operation against partial state.

## 7. Outputs and postconditions

After a successful call, `getState`, participants, next author, total balance, and outbound messages are mutually consistent. Failure leaves prior serialized state recoverable; caller may run in isolated EVM or reset it.

Consumer success corresponds to actual asset movement under adapter rules. Manager transaction revert must undo the movement.

## 8. Invariants

- **SM-INV-1:** state serialization is canonical and round-trips exactly.
- **SM-INV-2:** public views after `setState` depend only on encoded state and fixed code/config.
- **SM-INV-3:** next author is one deterministic active participant.
- **SM-INV-4:** application checks transaction header author, not executor `msg.sender`.
- **SM-INV-5:** outbound buffer is empty at transition start and contains only current transition output.
- **SM-INV-6:** participant array has unique nonzero addresses and deterministic order.
- **SM-INV-7:** deposit, top-up, exit, slash, and removal preserve application-defined balance conservation.
- **SM-INV-8:** balance equality and ordering are consistent with add/subtract and every supported asset component.
- **SM-INV-9:** peer and contract replay return identical state and messages under the same gas limit.
- **SM-INV-10:** consumer callbacks cannot observe or exploit partial manager state.

## 9. Ordering, concurrency, and atomicity

One state-machine contract instance is mutable scratch state. Calls for different channels cannot safely interleave on the same instance unless execution is isolated or serialized. Worker pools need one instance per operation or explicit snapshot restoration.

Outbound message order is application call order. Slash and removal batch order affects serialized state unless operations commute; protocol reduction therefore requires canonical address order or an integrator proof of commutativity.

## 10. Trust and security assumptions

Integrator code can mint internal balance, hide participants, select wrong author, or move consumer assets. Deployment treats it as trusted code and audits it like the manager. The manager’s balance checks limit but do not fully repair a malicious adapter that lies consistently.

Application call data may be adversarial. Every public application method reachable through `transaction.body.data` needs authorization through stored transaction header and resource bounds.

Private application state shared with peers or spectators is not confidential by protocol. Integrator must define privacy separately.

## 11. Failure behavior and recovery

Decode, authorization, invariant, or gas failure rejects transition and can support invalid-transition proof if prior commitments are linked. A local runtime error that cannot be reproduced by contract is not proof.

A failed join, slash, or removal during successor generation makes proposed successor invalid and prevents reduction finalization. A failed withdrawal leaves finalized snapshot retryable and unprocessed outbound tip unchanged.

## 12. Current implementation

`contracts/V1/AStateMachine.sol` provides state, participant, next-author, balance, inbound, join, slash, removal, outbound, and state-transition hooks with a simple reentrancy flag and fixed call gas. `contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol` provides genesis, deposit, and withdrawal hooks. `StateChannelManagerProxy.executeStateTransition` sets state and calls state transition. SDK `src/ADiamondStateMachine.ts` and `src/evm/EvmDiamondStateMachine.ts` wrap local execution.

Current base contract comments require wrong-turn rejection, but manager and application enforcement is not one formal shared integration test. State-machine scratch instance sharing and consumer reentrancy need full audit.

## 13. Difference from the intended design

| Classification     | Difference                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------ |
| missing            | canonical serialization specification per integrator and cross-runtime vectors             |
| missing            | explicit participant insertion/removal order and terminal next-author representation       |
| missing            | canonical reduction batch order or commutativity declaration                               |
| missing            | consumer reentrancy and hostile token test suite                                           |
| missing            | multi-asset balance law and supported asset behavior declaration                           |
| documentation debt | exact inbound-versus-transaction order needs one accepted rule across SDK and fraud replay |
| missing            | protocol/application version binding in snapshots or channel metadata                      |

## 14. Dependencies and cross-layer effects

Any serialization, participant, author, balance, message, slash, or removal change affects block hashes, finality, state proofs, fraud proofs, reduction, admission, settlement, storage, and tests. It is a protocol version change unless proved byte-compatible.

## 15. Verification

Integrator conformance suite must test state round-trip and canonical vectors, same transition across peer and contract runtime, every application selector, wrong author, malformed data, gas boundary, outbound order and reset, join/top-up, slash/removal, participant order, every balance law, conservation under random histories, hostile token callbacks, consumer rollback, and canonical batch order.

## 16. Future work

Stateless application proof systems may reduce replay cost. They must preserve current author, membership, balance, and message commitments or introduce an explicit protocol version.
