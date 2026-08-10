# Opening, admission, calldata fallback, and message streams

## Status and authority

This chapter defines how assets and participants enter a channel, how off-chain blocks become available through the chain, and how external effects are committed by inbound and outbound streams.

## 1. Purpose

Application state cannot directly observe L1 deposits, joins, or withdrawals during off-chain execution. The manager therefore turns external effects into ordered message blocks. Peers consume inbound blocks in the state machine and later prove outbound blocks to the manager. Calldata fallback gives a missing off-chain block a chain-ordered availability path without making every block an L1 write.

## 2. Design decisions and rationale

### 2.1 Admission is unanimous

Opening participants sign the exact `OpenChannel` bytes. A later join is signed by the joining participant and approved by every current or pending eligible participant. Admission changes the set whose unanimity defines finality, so a majority cannot impose a new participant on a minority.

### 2.2 A join first becomes an inbound message

A successful deposit does not immediately modify the adopted application snapshot. It appends a JOIN message to the inbound stream. The state machine applies the join in the next compatible off-chain transition or during dispute successor generation. This preserves one deterministic application transition path.

### 2.3 Top-up reuses JOIN encoding but has different membership checks

The same `JoinChannel` payload represents a deposit for a new participant and an additional deposit for an existing participant. The called entry point chooses the rule. `joinChannel` requires absence from snapshot plus pending members. `topUpBalance` requires presence.

### 2.4 Atomic and best-effort opening are explicit

An atomic open reverts if any consumer deposit fails. A best-effort open keeps successful deposits but still requires at least two successful participants. This choice is signed inside `OpenChannel`; a relayer cannot change it.

### 2.5 Calldata slots are author-owned and write-once

Only the signed block author can populate its slot. The manager does not fully validate the block when it is posted because that would make the fallback expensive. It binds the signed block to the L1 inclusion timestamp and lets objective fraud proofs punish junk.

## 3. Boundary and responsibilities

The manager validates channel, membership, signature, race, ordering, and cumulative balance rules. The consumer performs asset-specific deposit and withdrawal actions. The state machine applies inbound messages and produces application exits. The SDK decides when peer delivery has failed enough to use calldata fallback and reconstructs streams from events.

## 4. Data model and owned state

### 4.1 Opening payload

`OpenChannel` contains the caller-chosen `channelId`, participant array, parallel balance array, deposit deadline, atomicity flag, and application-specific opening data. `OpenChannelConfirmation` contains its ABI bytes plus signatures.

Participant and balance arrays must have the same length. Participant addresses must be nonzero and unique. The deadline uses chain time. At least two deposits must succeed.

### 4.2 Message blocks

A `MessageBlock` contains:

- `previousBlockHash`, which links to the prior head or zero at genesis;
- `blockHeight`, which increases by exactly one;
- ordered `messages`;
- cumulative `totalBalance` after those messages;
- chain `timestamp` at append time.

The block hash is `keccak256(abi.encode(messageBlock))`. The hash commits to message order, balances, and timestamp.

### 4.3 Message fields

A `Message` carries a type hash, affected participant, application `Balance`, and encoded type-specific data. For JOIN, data is the complete `JoinChannel`. For EXIT, data is `ExitChannel`, and its encoded balance must equal the outer message balance.

### 4.4 Stream heads

The adopted snapshot commits to inbound and outbound head hashes and heights. `ChannelBalance` also tracks the current on-chain inbound head and height plus cumulative deposits and withdrawals. The on-chain inbound head may be ahead of the adopted snapshot because deposits can wait for application consumption.

### 4.5 Calldata commitment

The key is `(channelId, blockAuthor, forkId, transactionCnt)`. The value is:

```text
keccak256(abi.encode(signedBlock, inclusionTimestamp))
```

The event carries the signed block and exact inclusion timestamp so peers and proof handlers can reproduce the commitment.

## 5. Inputs and preconditions

### 5.1 Open

`open` requires:

1. nonzero `channelId` with no existing adopted snapshot;
2. equal nonzero participant and balance array lengths;
3. unique nonzero participants;
4. deadline not earlier than the executing block timestamp;
5. one valid signature from every proposed participant over exact `encodedOpenChannel`;
6. consumer deposit success according to the signed atomicity rule;
7. at least two successful joins;
8. consumer-generated genesis participants equal the successful join set under the application’s documented ordering rule.

The final item is a required cross-check. The manager must not accept a consumer genesis that silently adds, removes, duplicates, or reorders participants in a way that changes threshold semantics.

### 5.2 Join and top-up

Both operations require:

- nonzero channel ID;
- `msg.sender` equals the joining or topping-up participant;
- unexpired deposit deadline;
- expected fork equals the adopted fork;
- expected snapshot hash equals `keccak256(abi.encode(currentSnapshot))`;
- a valid original signature by the participant;
- valid signatures by all current snapshot participants and all pending participants, without duplicates;
- successful atomic consumer deposit.

A new join also requires that the participant is absent from the combined set and that the expected fork has no dispute window. A top-up requires that the participant is already in the combined set. A top-up during a dispute needs an explicit policy; current code allows it when the snapshot expectations match.

### 5.3 Calldata post

`postBlockCalldata` requires:

- current chain timestamp is at most `maxTimestamp`;
- signed block decodes enough to read the header;
- `msg.sender` equals the header participant;
- the keyed commitment slot is zero.

The required production rule also checks nonzero channel and fork, supported encoded length, and a known or recoverable channel context. Full transaction or state-transition validity is deliberately deferred to fraud proofs.

## 6. Processing algorithm

### 6.1 Open

1. Decode the signed opening payload.
2. perform structural, uniqueness, deadline, and unused-channel checks;
3. verify all opening signatures against the proposed participant set;
4. initialize `ChannelBalance` with application zero balances and zero stream heads;
5. convert each participant and balance into an ordered `JoinChannel` deposit request;
6. call the consumer deposit for each request in signed order;
7. on atomic failure, revert all deposits; on best-effort failure, omit that participant;
8. require at least two successes;
9. build one genesis inbound block containing successful JOIN messages in the same order;
10. ask the consumer for encoded genesis application state and participant order;
11. validate the returned participant set against successful joins;
12. construct genesis `SnapshotData` with zero origin fork, state hash, participants, inbound head, zero outbound head, total deposits, and zero withdrawals;
13. set `forkId` to the hash of `SnapshotData`, `blockHeight` to zero, and timestamp to current chain time;
14. persist snapshot and balance heads;
15. emit `InboundMessagesProcessed` and `ChannelOpened` with enough data for mirror reconstruction.

### 6.2 Join or top-up

1. Decode and bind the request to `msg.sender`.
2. Revalidate deadline, expected fork, and expected snapshot.
3. Derive pending members by walking inbound JOIN blocks after the adopted inbound head.
4. Build the threshold set from adopted plus pending members, less on-chain slashes.
5. Apply the new-join or top-up membership rule.
6. Verify the participant signature and all threshold approvals.
7. Call the consumer deposit atomically.
8. Append one JOIN message block and update current inbound head, height, and total deposits.
9. Emit the inbound event. Do not modify the adopted snapshot participants yet.

### 6.3 Append inbound messages

1. Reject an empty batch.
2. Set `previousBlockHash` to the current on-chain inbound head.
3. Set height to current height plus one.
4. Add each message balance to cumulative deposits using application balance arithmetic.
5. Set timestamp to current chain time.
6. Hash and persist the block in the channel hash map. Reject an existing hash entry.
7. atomically update head, height, and cumulative deposits;
8. emit the complete block.

### 6.4 Post calldata

1. Reject a transaction executed after `maxTimestamp`.
2. Decode the block header and bind sender to author.
3. Resolve the slot from channel, sender, fork, and height.
4. Reject a nonzero slot.
5. hash signed block with current chain timestamp and store it;
6. emit the full signed block, timestamp, author, channel, and commitment.

### 6.5 Verify and apply outbound blocks

1. Prune any supplied prefix already covered by the current adopted outbound head.
2. Starting at the adopted head and height, require each block’s previous hash and next height.
3. Sum every message balance from adopted cumulative withdrawals.
4. Require resulting head, height, and total withdrawals equal the new snapshot commitments.
5. Process messages in block and message order. EXIT checks inner and outer balances and calls the consumer withdrawal.
6. After each effect, require cumulative withdrawals are less than or equal to deposits resolved at the new snapshot inbound head.
7. persist outbound height and cumulative withdrawals, then emit processing and withdrawal events.

## 7. Outputs and postconditions

Opening creates one adopted fork and one inbound head. Join and top-up create only inbound stream progress. Calldata posting creates one immutable commitment and event. Outbound application moves assets only as part of a successful snapshot update; any failed message or balance check reverts the snapshot update and all prior external calls in that transaction.

## 8. Invariants

- **MSG-INV-1:** participant and balance arrays are parallel and equal length.
- **MSG-INV-2:** opening and new-join participant sets contain no duplicate or zero address.
- **MSG-INV-3:** inbound and outbound heights increase by one along hash links.
- **MSG-INV-4:** an inbound hash maps to one immutable encoded block.
- **MSG-INV-5:** current inbound deposits equal application-sum of all appended inbound message balances.
- **MSG-INV-6:** adopted stream heads never skip an unverified segment.
- **MSG-INV-7:** an EXIT outer balance equals its encoded `ExitChannel.balance`.
- **MSG-INV-8:** total withdrawals never exceed deposits at the snapshot’s consumed inbound head.
- **MSG-INV-9:** a calldata slot can be written only once and only by the named author.
- **MSG-INV-10:** a pending join affects threshold membership before it affects adopted application participants.

## 9. Ordering, concurrency, and atomicity

Expected snapshot and fork arguments protect joins against deposits accepted on a state the participant did not approve. The deadline protects against a delayed transaction. Calldata `maxTimestamp` protects a timeout disputer from an author racing a late data post after seeing the dispute.

Two successful deposits in different transactions are ordered by chain inclusion and form consecutive inbound blocks. A later call must derive the threshold set from the new head. A duplicate calldata post reverts even if bytes are identical.

Consumer deposits and withdrawals are inside the manager transaction. A revert must undo both manager state and token movement. Tokens with callbacks require reentrancy protection at the manager or consumer boundary.

## 10. Trust and security assumptions

Opening data and consumer results are untrusted until checked. A block calldata event proves chain publication by the named sender at a timestamp; it does not prove the block is valid. Full signed blocks can be large and need an encoded-size cap.

All-participant admission assumes each signer understands the asset, deadline, application data, and exact participant ordering. Wallet UI and SDK typed-data support are security requirements even if current signatures use raw ABI bytes.

## 11. Failure behavior and recovery

An atomic deposit failure reverts the complete open or join. A best-effort open omits failed participants, but the resulting participant set must be visible before any application play begins. No best-effort rule applies to later joins.

A missing off-chain block is requested from peers first. If still missing, the author posts calldata. Peers listen for the event, verify the commitment, validate the block normally, and enqueue it through the same block pipeline. Invalid posted data becomes fraud-proof evidence.

If an outbound consumer call fails, snapshot adoption reverts. The caller can retry only after fixing transient external conditions; it cannot substitute a different outbound sequence for the same committed snapshot.

## 12. Current implementation

`StateChannelManagerProxy.open` implements opening, calls `depositAssetsComposable`, and asks the consumer for genesis. `JoinChannelFacet` implements join and top-up. `StateChannelCommon` owns stream append, verification, pending-participant derivation, and outbound processing. `StateSnapshotFacet` invokes outbound verification and effects. `postBlockCalldata` is on the proxy.

Current code checks duplicate opening participants but does not explicitly check participant/balance array length before indexing. It does not validate the consumer-returned genesis participant set against successful deposits. Pending participant derivation walks stored inbound blocks backward.

## 13. Difference from the intended design

| Classification     | Difference                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| bug                | opening lacks explicit parallel-array length and nonzero participant checks                                                          |
| missing            | consumer genesis participant set is not cross-checked against successful deposits                                                    |
| decision pending   | top-up policy while the adopted fork is disputed                                                                                     |
| missing            | calldata and message count/byte size limits                                                                                          |
| missing            | a documented reentrancy guard at consumer asset boundaries                                                                           |
| documentation debt | custom inbound and outbound message authorization and accounting rules are application-defined but not versioned in manager metadata |
| missing            | complete SDK recovery rule from calldata event through ordinary validation                                                           |

## 14. Dependencies and cross-layer effects

Opening and admission require SDK signature collection, exact ABI encoding, chain-time conversion, event replay, and state-machine JOIN support. Snapshot adoption depends on stream verification. Timeout fraud proofs depend on calldata commitment time. Operations must monitor failed consumer calls and pending inbound depth.

## 15. Verification

Tests must cover duplicate, zero, and mismatched opening arrays; every atomic and best-effort deposit combination; participant-set mismatch from a hostile consumer; join versus top-up membership; pending-member threshold approval; slash exclusion; exact deadline boundaries; competing deposits; duplicate calldata; wrong sender; timestamp commitment vectors; inbound ancestry and height gaps; outbound ancestry, balance mismatch, withdrawal failure, reentrancy, and full rollback.

Current coverage exercises opening, joins, calldata, and snapshot streams in `test/V1/DiamondProxy/` and related E2E suites. The hostile consumer, array-structure, resource-limit, and reentrancy cases remain required.

## 16. Future work

Typed structured signatures, batch deposits, and packed message metadata may reduce signer ambiguity and gas. They require a versioned encoding migration.
