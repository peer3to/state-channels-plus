# Data types, encodings, and storage ownership

## Status and authority

This chapter is the field-level reference for the V1 wire and contract data model. The Solidity declarations remain the encoding authority until a versioned schema is introduced. This chapter defines the meaning, ownership, ordering, and validation rules that the declarations do not express.

When this chapter conflicts with current code, the relevant section says whether the code or the intended design must change. An unmarked conflict is a specification defect and must be resolved before release.

## 1. Shared representation rules

### 1.1 Canonical encoding

Contract-facing structures use Solidity ABI encoding with the field order and field types declared in `contracts/V1/types`. A hash written as `hash(value)` means `keccak256(abi.encode(value))` unless a type-specific section says otherwise.

SDK models may cache decoded values, but signed bytes and hash inputs must preserve the original canonical encoding. Decoding and re-encoding must produce byte-identical output before the SDK accepts the object as canonical.

The following are invalid:

- ABI data with missing or trailing fields;
- a value encoded under a different tuple layout;
- a noncanonical address or integer representation introduced by a transport codec;
- converting a `uint256` to a JavaScript number when it may exceed the safe integer range;
- sorting a protocol array unless its section explicitly defines set semantics;
- hashing JSON, object stringification, or a TypeScript model instead of ABI bytes.

### 1.2 Hash and signature ownership

A signature authenticates the exact bytes stored beside it. `SignedBlock.signature` authenticates `encodedBlock`; `SignedJoinChannel.signature` authenticates `encodedJoinChannel`; and `SignedDispute.signature` authenticates `encodedDispute`. A confirmation adds signatures over the same signed object. It does not create a second representation of the object.

Every verification path must recover the signer from the same byte sequence. Adding a new signature domain, prefix, chain identifier, or contract identifier is a wire-version change unless all existing signers already include it.

Current block and dispute signatures do not provide a general EIP-712 domain that binds every object to a deployment. The embedded `channelId` and `forkId` limit replay for objects that validate those headers. Types without equivalent embedded scope need an explicit domain before production.

### 1.3 Array meaning

Protocol arrays fall into three classes:

| Class                        | Examples                                      | Rule                                                                                           |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ordered chain                | `signedBlocks`, message blocks, milestones    | Order is part of validity and hashing.                                                         |
| Participant order            | snapshot participants, open participants      | Order affects leader selection and state hashes. It is not a set.                              |
| Logical set encoded as array | slash participants, self-removals, signatures | Duplicates are invalid. Canonical order must be defined where the array is hashed or compared. |

Current code does not apply one canonical ordering rule to every logical set. Producers must follow the current reducer order, and verifiers must reject duplicates. A future wire version should define address-ascending order for set-valued fields so independent implementations cannot diverge.

### 1.4 Zero and empty values

Zero is not a general-purpose `None` value. It is optional only where the field definition says so.

- zero `address` means an absent optional timeout participant or another explicitly optional participant;
- zero `bytes32` may be the root predecessor of a chain, but is invalid for an established channel or fork identifier;
- an empty byte string can be valid application data, but cannot stand in for a required encoded object;
- an empty array means no elements, not unknown elements;
- a zero balance is interpreted through the state machine's balance algebra, including custom balance data.

Decoders must not silently replace malformed values with these defaults.

## 2. Execution types

### 2.1 `TransactionHeader`

| Field            | Meaning and checks                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `channelId`      | Stable channel identifier. Must match the runtime and proof context.                                                                  |
| `participant`    | Claimed application author. Must equal the expected next author for the pre-state.                                                    |
| `forkId`         | Fork on which the transaction executes. Must match the block and current snapshot.                                                    |
| `transactionCnt` | Monotonic application transaction number within a fork. Exact increment rules belong to the application/runtime integration contract. |
| `timestamp`      | Protocol timestamp in seconds. Must satisfy ordering and drift rules. It is not local receipt time.                                   |

The application reads `participant` as author context because EVM `msg.sender` may be the local executor or an on-chain verifier.

### 2.2 `TransactionBody`

`encodedData` is application-owned committed data. `data` is EVM call data used to run the transition. Both fields are covered by the containing block hash. If they encode the same logical action, the application integration must specify and verify their relationship. The protocol must not assume they are interchangeable.

### 2.3 `Transaction`

`Transaction` is the ordered pair of header and body. The header supplies protocol context. The body supplies application input. A valid body with a mismatched header is still invalid.

### 2.4 `Block`

| Field               | Meaning and checks                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `transaction`       | The one application transition committed by this block.                                                 |
| `stateSnapshotHash` | Hash of the post-transition `StateSnapshot`. It binds state, membership, accounting, and message heads. |
| `previousBlockHash` | Hash of the prior encoded block on the same fork, or the fork's defined root predecessor.               |
| `messageBlocks`     | Inbound message segment applied before or as part of this transition, in chain order.                   |

The block hash is the hash of the canonical encoded `Block`. The block height is not stored directly. It is derived from the snapshot and chain position. This makes correct snapshot availability part of block verification.

`messageBlocks` must form one contiguous segment starting from the pre-state inbound head. It cannot skip, repeat, or reorder messages. A block that claims the correct final inbound head but supplies a different path is invalid.

### 2.5 `SignedBlock`

`encodedBlock` must decode to one canonical `Block`. `signature` must recover the block producer declared by `transaction.header.participant`. A relay may transport the object but cannot replace the producer signature.

### 2.6 `BlockConfirmation`

`signedBlock` is the producer-signed block. `signatures` contains peer confirmations of that same encoded block. A valid confirmation requires:

1. one valid producer signature;
2. no duplicate recovered signer;
3. each confirmer belongs to the participant set used for that confirmation round;
4. the required count or unanimity for the relevant proof position;
5. no signature over a different encoding that merely decodes to similar values.

Signature array order has no semantic meaning today, but duplicate handling and any hash of the full structure can make order observable. Producers should emit participant-order signatures until a canonical address order is versioned.

## 3. Balance and message types

### 3.1 `Balance`

`amount` is the base numeric component. `data` carries asset- or application-specific accounting data. The manager cannot safely use raw integer arithmetic alone. The state machine defines:

- zero balance;
- addition and subtraction;
- equality and less-than;
- conversion between exit data and manager totals;
- total balance still held in application state.

Every balance operation must be deterministic and must either return one canonical balance or revert. A nonzero `data` field cannot be discarded merely because `amount` is zero.

### 3.2 `Message`

| Field         | Meaning and checks                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `messageType` | `keccak256("JOIN_CHANNEL_MESSAGE")`, `keccak256("EXIT_CHANNEL_MESSAGE")`, or a versioned custom type. |
| `participant` | Participant affected by the transfer or custom action.                                                |
| `balance`     | Value transferred into or out of channel accounting.                                                  |
| `data`        | Encoded type-specific payload. JOIN and EXIT must agree with their decoded inner values.              |

The outer participant and balance are not hints. If `data` also contains them, both representations must match. The contract currently rejects unsupported outbound types. Custom types therefore require coordinated manager, consumer, SDK, and specification changes.

### 3.3 `MessageBlock`

| Field               | Meaning and checks                                                                    |
| ------------------- | ------------------------------------------------------------------------------------- |
| `previousBlockHash` | Prior head in this direction's message chain.                                         |
| `blockHeight`       | Monotonic height. It matters when choosing a dispute input and reconstructing ranges. |
| `messages`          | Ordered messages in the block.                                                        |
| `totalBalance`      | Balance-algebra sum of all message balances in this block.                            |
| `timestamp`         | Chain-observed creation or processing time in seconds.                                |

Inbound and outbound chains use the same structure but different storage domains. Their hashes must never be looked up in the wrong domain. `totalBalance` must be recomputed and checked; trusting the supplied value breaks the aggregate conservation invariant.

### 3.4 `ChannelBalance`

`ChannelBalance` is the on-chain accounting projection: latest inbound hash and height, latest outbound height, total deposits, and total withdrawals. It omits the outbound hash because the contract's settlement path indexes output differently. This omission must not be read as permission for the SDK to lose the outbound chain head from snapshots.

The core invariant is:

`totalDeposits = inStateBalance + totalWithdrawals`

where all operations use the state machine's `Balance` algebra. Pending inbound values are not in `totalDeposits` until included by the contract-defined processing point.

## 4. Opening and membership types

### 4.1 `OpenChannel`

| Field               | Meaning and checks                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `channelId`         | Proposed stable identifier. Must be unique for the deployment.                                    |
| `participants`      | Initial ordered participant list. Addresses must be unique and nonzero.                           |
| `balances`          | Parallel to participants. Length must match exactly.                                              |
| `deadlineTimestamp` | Last chain timestamp at which required deposits/confirmations can succeed.                        |
| `isAtomic`          | If true, all required deposits must succeed. If false, genesis contains only successful deposits. |
| `data`              | Application-specific opening input used by the consumer or state machine.                         |

The SDK must not infer participant order from network arrival order. The signed proposal fixes it. For non-atomic opening, the contract's successful deposit result fixes the genesis membership according to the documented filter rule.

### 4.2 `OpenChannelConfirmation`

`encodedOpenChannel` is the exact proposal. `signatures` proves acceptance by the required initial participants. Each recovered signer must be unique and must sign the same bytes. The proposal should be rejected if the participant list, balance list, deadline, or atomic mode differs from local policy.

### 4.3 `JoinChannel`

| Field               | Meaning and checks                                |
| ------------------- | ------------------------------------------------- |
| `channelId`         | Target channel.                                   |
| `participant`       | Depositor and proposed member.                    |
| `deadlineTimestamp` | Deposit validity deadline.                        |
| `balance`           | Proposed deposit under application balance rules. |

A join is first a chain deposit request, then an inbound message, then an off-chain state transition. Chain acceptance alone does not make the participant an active block producer. The participant becomes active only in the snapshot that processes the JOIN.

An existing participant may use JOIN as a top-up if the application supports it. That does not create a duplicate participant entry.

### 4.4 Join confirmation structures

`SignedJoinChannel` contains the participant-signed canonical join bytes. `JoinChannelConfirmation` adds peer signatures over that join. `JoinChannelBlock` links an ordered array of accepted joins to its predecessor.

Current manager storage and contract event flow use `MessageBlock` as the general inbound chain. Join-specific structures remain part of the generated ABI and negotiation flow. Code must document which form crosses each boundary instead of treating the two as interchangeable.

### 4.5 Exit structures

`ExitChannel` holds one participant and balance. It is produced by a state-machine removal or slash and encoded inside an EXIT message. `ExitChannelBlock` groups ordered exits and links to a predecessor.

An off-chain EXIT is not a direct transfer. It becomes an outbound message, is committed by snapshots, is processed on chain, and only then calls the consumer withdrawal path. Any direct consumer call from an off-chain peer bypasses consensus and is forbidden.

## 5. Snapshot and fork types

### 5.1 `SnapshotData`

| Field                              | Owner               | Meaning and checks                                                          |
| ---------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| `originForkId`                     | reduction           | Fork from which this fork was derived. Genesis uses its defined root value. |
| `stateMachineStateHash`            | application/runtime | Hash of canonical encoded application state.                                |
| `participants`                     | application/runtime | Ordered active membership after the transition.                             |
| `latestInboundMessageBlockHash`    | message pipeline    | Exact inbound head applied to this state.                                   |
| `latestInboundMessageBlockHeight`  | message pipeline    | Height corresponding to that hash.                                          |
| `latestOutboundMessageBlockHash`   | message pipeline    | Exact outbound head emitted by this state.                                  |
| `latestOutboundMessageBlockHeight` | message pipeline    | Height corresponding to that hash.                                          |
| `totalDeposits`                    | accounting          | Cumulative processed inbound balance.                                       |
| `totalWithdrawals`                 | accounting          | Cumulative processed outbound balance.                                      |

Every field is consensus-sensitive. A peer must compute the full object and compare its hash. Comparing only application state is insufficient because a peer could fork membership or accounting while preserving application bytes.

### 5.2 `StateSnapshot`

`snapshotData` is the state content. `forkId` identifies the fork containing it. `blockHeight` is the height of the block that committed it. `timestamp` is the protocol time committed for that snapshot.

The first snapshot of a fork is its genesis snapshot. The design treats the genesis snapshot data hash as the new fork identifier. Exact derivation must remain byte-stable across SDK and contract:

`forkId = keccak256(abi.encode(genesisSnapshotData))`

The origin link in the new data points back to the prior fork. A reducer must not copy the old `forkId` into the new snapshot merely because most state fields remain equal.

### 5.3 Snapshot availability

Hash commitments alone are insufficient for operation. Peers need the encoded state and snapshot to:

- verify a received block;
- construct a state proof;
- audit a dispute;
- serve a spectator;
- resume after a restart.

The durable design therefore stores snapshot metadata and encoded application state atomically under the snapshot hash. If either half is absent, the snapshot is not usable and must not be advertised.

## 6. Proof types

### 6.1 `MilestoneProof`

A milestone contains block confirmations that establish a final checkpoint. The exact signer threshold depends on the participant set at that checkpoint. Membership changes inside a proof therefore require a final anchor before the new membership becomes the verification set for later material.

Block confirmations inside a milestone are ordered. They must connect to the prior anchor and converge on one final snapshot. A milestone with individually valid but disconnected confirmations is invalid.

### 6.2 `StateProof`

`milestones` is an ordered sequence of final anchors. `signedBlocks` is the ordered nonfinal suffix after the last anchor. Intended V1 behavior permits both arrays to be nonempty. The proof means:

1. begin from fork genesis or the first known anchor;
2. verify each milestone and advance the final state;
3. apply the signed suffix in ancestry order;
4. return the latest valid state, which may be newer than the last final milestone.

Current `StateProofFacet.verifyStateProof` rejects a proof that contains both arrays. Current `AgreementManager.getStateProof` also drops the signed suffix once a milestone exists. These are implementation defects, not open design questions.

### 6.3 `FraudProof`

`proofType` selects one objective block-level verifier. `participant` is the accused address and must equal the address derived by decoding and verifying `encodedProof`. A caller cannot choose a different slash target.

V1 block fraud types are double-sign, invalid state transition, wrong genesis, invalid timestamp, and forged inbound message block. The numeric TypeScript enum is namespaced at 100 and converted modulo 100 for Solidity. This translation is an SDK convention, not a different on-chain enum.

### 6.4 `DisputeFraudProof`

This structure carries a dispute-specific proof type, accused participant, disputed object, and encoded evidence. The verifier must derive the responsible participant from the violated rule. Some types slash the disputer; timeout faults may identify another signer or timed-out participant. The outer address must match the derived result.

The TypeScript enum is namespaced at 200 and converted modulo 200 for Solidity. New values must be appended consistently on both sides. Inserting or reordering values changes the ABI meaning.

## 7. Dispute types

### 7.1 `DisputeInput`

| Field                           | Role                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `channelId`                     | Selects channel storage, state machine, and accounting.                                                  |
| `forkId`                        | Fork being challenged and reduction source.                                                              |
| `latestStateSnapshotHash`       | Disputer's claimed latest state anchor.                                                                  |
| `latestInboundMessageBlockHash` | Disputer's selected inbound head.                                                                        |
| `lastInboundMessageBlockHeight` | Height paired with that head.                                                                            |
| `stateProof`                    | Evidence for the claimed off-chain state.                                                                |
| `onChainSlashes`                | Slash set proposed for this successor. Current subset versus automatic inclusion behavior is unresolved. |
| `disputeAuditingDataHash`       | Commitment to optional full replay data.                                                                 |
| `disputer`                      | Economic owner and possible slash target. Must match signature/caller rules.                             |
| `timeout`                       | Optional timeout claim. Zero participant means absent.                                                   |
| `selfRemoval`                   | Requests nonpunitive removal of the disputer under allowed conditions.                                   |

These are four distinct successor inputs: latest state proof, latest inbound head, eligible chain slashes, and optional timeout/self-removal. Reduction must evaluate their precedence explicitly. It must not treat the object as only a state-proof wrapper.

### 7.2 `Dispute`

`input` is the committed proposal. `postedAuditingData` records whether full data was posted. `outputSnapshotDataHash` is populated by resolution and commits to the proposed successor. It must be recomputed from verified input; it cannot be accepted as self-authenticating output.

### 7.3 Signatures and confirmations

`SignedDispute` authenticates encoded dispute bytes. `DisputeConfirmation` adds participant signatures. A dispute window stores commitments to confirmed disputes. A commitment without retrievable, decodable dispute bytes cannot safely participate in off-chain auditing; this is a known current gap.

### 7.4 `Timeout`

| Field                                 | Meaning                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `participant`                         | Participant proposed for removal. Zero means no timeout.                                                                           |
| `blockHeight`                         | Height at which the participant failed to act.                                                                                     |
| `minTimeStamp`                        | Earliest valid protocol timestamp for the timeout.                                                                                 |
| `isForced`                            | Enables the documented race-condition exception for a predecessor not linked to latest state. It does not skip all timeout checks. |
| `previousBlockProducer`               | Optional producer context used by timeout fraud checks.                                                                            |
| `previousBlockProducerPostedCalldata` | Whether that producer disclosed required block data on chain.                                                                      |
| `participantSignatureOnPreviousBlock` | Evidence that links the participant to the preceding block when required.                                                          |

When multiple valid timeouts compete, the intended reducer selects the earliest timeout point. Slash consequences take precedence over a simultaneous nonpunitive removal for the same participant.

### 7.5 Window and reduction records

`DisputeWindowEvidence.creationTimestamp` starts the evidence window. `lastEvidenceSubmissionTimestamp` extends the close condition when new valid evidence arrives. `disputeCommitments` is the active ordered commitment collection. `hasPosted` prevents duplicate evidence posting by one address, although its current array representation is storage-heavy.

`DisputeWindowReducedResult` records successor fork, reduction timestamp, and reducer. A zero result means unreduced. Once nonzero, the same window must not yield a different successor.

`ReduceOutput` is the deterministic intermediate result: selected latest block, slashed participants, inbound head and height, selected timeout, and self-removals. Contract and SDK reducers must produce the same encoded result for the same chain state and disputes.

### 7.6 Audit data

`DisputeAuditingData` contains the old genesis data, claimed latest snapshot, intermediate milestone snapshots, latest finalized application state bytes, inbound message range, and outbound message range. It must be sufficient to replay the proof and compute the output without private peer storage.

The arrays must be bounded before production. Today the design can move replay cost and data availability burden onto the chain. Batching, commitments, or a stateless verification protocol may replace raw arrays, but that would be a proof-version change.

## 8. Storage ownership

### 8.1 On-chain storage

| Domain                    | Primary content                                               | Lifetime                                                |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Channel identity          | consumer, state machine, opening mode, genesis/current fork   | Channel lifetime.                                       |
| Accounting                | inbound head/height, outbound height, deposit/withdraw totals | Until final settlement and safe cleanup.                |
| Inbound data availability | message blocks and existence index                            | At least until every dependent proof window closes.     |
| Block calldata            | disclosed blocks or hashes used by fraud/timeout logic        | At least through all dependent windows.                 |
| Slashes                   | participant and timestamp                                     | Until every fork whose cutoff can include it is closed. |
| Dispute windows           | evidence, commitments, reduced result                         | Until successor is final and no proof can refer back.   |
| Snapshot anchors          | latest accepted output and fork relations                     | Channel lifetime or versioned archival policy.          |

Storage cleanup is not a gas-only decision. Removing slash, calldata, message, or dispute data before its last proof dependency expires can make valid verification impossible. Cleanup needs an explicit dependency calculation.

### 8.2 Current SDK storage

The `src/storage` classes divide data into blocks, block calldata, disputes, fraud proofs, message blocks, snapshots, application state, queues, timeout state, force join/exit state, membership changes, and event progress. Most are in-memory `Map`, `Set`, or array-backed stores.

These classes define useful ownership boundaries but not persistence. Process exit loses protocol state. There is no transaction that atomically advances a snapshot, application bytes, message heads, queue position, and event cursor.

### 8.3 Required durable storage

The production adapter must support:

- atomic write batches across the state domains changed by one block or chain event;
- compare-and-swap or a single-writer transaction per channel;
- canonical keys that include deployment, chain, channel, fork, and object hash where relevant;
- immutable storage for signed bytes and hash-addressed objects;
- an event journal with block hash, block number, transaction index, and log index;
- staged objects that are not visible as canonical until validation completes;
- schema and protocol version metadata;
- crash-safe promotion and idempotent replay;
- retention based on proof dependency, not only age;
- export sufficient for spectator sync and dispute auditing.

The SDK may expose an in-memory adapter for tests. Production startup must fail if configured with a nonpersistent adapter unless an explicit unsafe development flag is set.

### 8.4 Atomic commit groups

One accepted block changes at least these values as one logical commit:

1. canonical encoded block and confirmation;
2. post-state snapshot;
3. encoded application state addressed by its hash;
4. inbound and outbound message heads and blocks;
5. membership and leader context;
6. finality or milestone metadata;
7. processed queue entries.

One chain event changes the event journal, local EVM mirror, and any derived dispute or message indexes as one logical commit. Advancing the event cursor before these writes are durable can permanently skip the event after restart.

## 9. Versioning and compatibility

V1 currently relies on source-level agreement between Solidity tuples and TypeScript ABI strings. Production releases need one protocol schema version included in deployment metadata and sync handshakes.

A compatible change may add a local cache, index, or uncommitted diagnostic field. An incompatible change includes:

- changing field order or Solidity type;
- changing a hash or signature domain;
- changing participant or set ordering;
- changing zero-value meaning;
- changing proof traversal rules;
- adding a new message or fraud type without version negotiation;
- changing balance encoding or arithmetic.

Old objects must remain decodable for every unresolved dispute and withdrawal. An upgrade cannot discard the verifier for data that is still economically live.

## 10. Verification requirements

Required tests include:

- Solidity and TypeScript golden vectors for every shared structure;
- round-trip and noncanonical encoding rejection;
- signature recovery for every signed wrapper;
- duplicate and permutation tests for all set-like arrays;
- block, message, milestone, and fork-link continuity;
- snapshot hash sensitivity to every field;
- balance algebra conservation with nonempty custom data;
- crash injection at every atomic commit boundary;
- old-version proof replay after an upgrade.

The existing codec, model, storage, state snapshot, block, dispute, and E2E tests supply partial evidence. They do not replace cross-language vectors or durable crash testing.

## 11. Source map

| Subject                | Current source                                 |
| ---------------------- | ---------------------------------------------- |
| Shared structs         | `contracts/V1/types/DataTypes.sol`             |
| State and fraud proofs | `contracts/V1/types/ProofTypes.sol`            |
| Dispute structs        | `contracts/V1/types/DisputeTypes.sol`          |
| Message hashes         | `contracts/V1/types/MessageTypeHashes.sol`     |
| SDK ABI type strings   | `src/types/ethers.ts`, `src/types/disputes.ts` |
| SDK enum translation   | `src/types/sol-enums.ts`                       |
| SDK storage domains    | `src/storage/`                                 |
| Model and codec tests  | `test/models/`, `test/utils/Codec.test.ts`     |
| Storage tests          | `test/storage/`                                |

## 12. Future work

Non-normative improvements include a generated schema registry, typed signature domains, canonical set encodings, compact proof representations, and persistent adapters for multiple environments. Any encoded change requires protocol versioning.
