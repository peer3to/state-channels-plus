# Data Types Reference

> **Status:** Draft.
> **Scope:** Field-level reference for the shared structs exchanged between the contracts and the
> SDK. Solidity definitions live under
> [contracts/V1/types](../../../../contracts/V1/types); TypeChain generates matching `*Struct`
> types for the TypeScript side. This document states fields and roles; the semantics of each type
> are owned by the linked protocol documents.

Source files:

- [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol) — transactions, blocks, messages, setup, exits, balances, snapshots.
- [DisputeTypes.sol](../../../../contracts/V1/types/DisputeTypes.sol) — disputes, timeouts, windows, reduction, auditing data.
- [ProofTypes.sol](../../../../contracts/V1/types/ProofTypes.sol) — state proofs, fraud-proof and dispute-fraud-proof envelopes and enums.
- [FraudProofTypes.sol](../../../../contracts/V1/types/FraudProofTypes.sol) — per-type block fraud-proof payloads.
- [DisputeFraudProofTypes.sol](../../../../contracts/V1/types/DisputeFraudProofTypes.sol) — per-type dispute fraud-proof payloads.
- [MessageTypeHashes.sol](../../../../contracts/V1/types/MessageTypeHashes.sol) — cross-layer message type constants.

## 1. Transactions and blocks

Semantics: [../concepts/history-and-commitments.md](../concepts/history-and-commitments.md) (data
model), [../protocol/finality.md](../protocol/finality.md) (signing, virtual voting, agreement).
Defined in [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol).

| Struct              | Fields                                                                     | Role                                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TransactionHeader` | `channelId`, `participant`, `forkId`, `transactionCnt`, `timestamp`        | Identifies the author, the fork, the position (`transactionCnt`), and the claimed time of a transition. `participant` is the protocol's logical author identity (never `msg.sender` — see [../concepts/state-machines.md](../concepts/state-machines.md)). |
| `TransactionBody`   | `encodedData`, `data`                                                      | The transition to execute; `data` is the EVM calldata run by `stateTransition`.                                                                                                                                                                            |
| `Transaction`       | `header`, `body`                                                           | One proposed state transition.                                                                                                                                                                                                                             |
| `Block`             | `transaction`, `stateSnapshotHash`, `previousBlockHash`, `messageBlocks[]` | A committed transition, hash-linked to its predecessor. `messageBlocks` carries cross-layer message blocks produced or consumed by this block.                                                                                                             |
| `SignedBlock`       | `encodedBlock`, `signature`                                                | A block signed by its author. Signing is a non-equivocating commitment ([../protocol/finality.md](../protocol/finality.md)).                                                                                                                               |
| `BlockConfirmation` | `signedBlock`, `signatures[]`                                              | A block plus collected participant signatures; the building unit of milestones ([../protocol/state-proofs.md](../protocol/state-proofs.md)).                                                                                                               |

### 1.1 The commitment hierarchy

A block does **not** commit directly to the serialized state-machine state. The commitment is
layered:

1. `Block.stateSnapshotHash` = `hash(StateSnapshot)` — the block commits to a **state snapshot**.
2. `StateSnapshot.snapshotData.stateMachineStateHash` = `hash(serialized state-machine state)` —
   the snapshot commits to the encoded state returned by the state machine's `getState()`.
3. The snapshot additionally commits to the participant set, the inbound and outbound
   message-stream tips, and the deposit/withdrawal totals (§6).

The serialized state is therefore committed **indirectly, through the snapshot hierarchy**.
Agreement checks and dispute verification MUST compare at the correct level: block-level checks
compare snapshot hashes; state re-execution checks compare `stateMachineStateHash` inside the
snapshot. See [../concepts/history-and-commitments.md](../concepts/history-and-commitments.md).

## 2. Cross-layer messages

Semantics: [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md). Defined in
[DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol) and
[MessageTypeHashes.sol](../../../../contracts/V1/types/MessageTypeHashes.sol).

| Struct         | Fields                                                                        | Role                                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Message`      | `messageType`, `participant`, `balance`, `data`                               | One cross-layer instruction. `messageType` is a hashed constant: `MESSAGE_TYPE_JOIN` = `keccak256("JOIN_CHANNEL_MESSAGE")`, `MESSAGE_TYPE_EXIT` = `keccak256("EXIT_CHANNEL_MESSAGE")`; integrators may define custom types handled by `_processCustomInboundMessage`. |
| `MessageBlock` | `previousBlockHash`, `blockHeight`, `messages[]`, `totalBalance`, `timestamp` | A hash-linked batch of messages forming one link of an ordered stream (inbound L1→L2 or outbound L2→L1). `blockHeight` is only relevant to dispute reduction for inbound blocks. `totalBalance` aggregates the batch's balances for incremental accounting.           |

Both directions form recursive hash-linked streams whose tips are committed by snapshots (§6);
the chain processes only the newly proven range on each snapshot advance.

## 3. Channel setup and membership

Semantics: [../protocol/lifecycle.md](../protocol/lifecycle.md) (opening),
[../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md) (joins as inbound
messages). Defined in [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol).

| Struct                    | Fields                                                                               | Role                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenChannel`             | `channelId`, `participants[]`, `balances[]`, `deadlineTimestamp`, `isAtomic`, `data` | Terms for opening a channel. `balances` is parallel to `participants`. `isAtomic` selects all-or-nothing deposits versus opening with only the successful ones. |
| `OpenChannelConfirmation` | `encodedOpenChannel`, `signatures[]`                                                 | Open terms plus the participants' signatures.                                                                                                                   |
| `JoinChannel`             | `channelId`, `participant`, `deadlineTimestamp`, `balance`                           | One participant's join (or top-up for an existing participant) with its balance commitment.                                                                     |
| `JoinChannelBlock`        | `previousBlockHash`, `joinChannels[]`                                                | A hash-linked batch of joins.                                                                                                                                   |
| `SignedJoinChannel`       | `encodedJoinChannel`, `signature`                                                    | A join signed by the joining participant.                                                                                                                       |
| `JoinChannelConfirmation` | `signedJoinChannel`, `signatures[]`                                                  | A join with the required threshold signatures (unanimous authorization — every current participant plus the joiner).                                            |

## 4. Exits

Semantics: [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md) — an exit is
an outbound message processed incrementally during a snapshot update, not a standalone withdrawal.
Defined in [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol).

| Struct             | Fields                                | Role                                                                                                                                                                  |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExitChannel`      | `participant`, `balance`              | A participant leaving with a resulting balance. Produced as a byproduct of a state transition, or enforced on-chain through a dispute (removal, slash, self-removal). |
| `ExitChannelBlock` | `exitChannels[]`, `previousBlockHash` | A hash-linked batch of exits.                                                                                                                                         |

## 5. Balances

Semantics: [../concepts/state-machines.md](../concepts/state-machines.md) — the state machine
defines the balance algebra (`addBalance`, `subtractBalance`, comparisons, totals). Defined in
[DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol).

| Struct    | Fields           | Role                                                                                                                                                                                                                                      |
| --------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Balance` | `amount`, `data` | Abstract value. `amount` covers the common integer case; `data` carries application-defined encoding for composite, multi-asset, or non-fungible models. Membership (`getParticipants`) and balance representation are separate concerns. |

## 6. Snapshots

Semantics: [../concepts/history-and-commitments.md](../concepts/history-and-commitments.md)
(commitment hierarchy), [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)
(stream tips, channel-balance invariant),
[../contracts/manager-and-facets.md](../contracts/manager-and-facets.md) (on-chain storage).
Defined in [DataTypes.sol](../../../../contracts/V1/types/DataTypes.sol).

| Struct           | Fields                                                                                                                                                                                                                                   | Role                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SnapshotData`   | `originForkId`, `stateMachineStateHash`, `participants[]`, `latestInboundMessageBlockHash`, `latestInboundMessageBlockHeight`, `latestOutboundMessageBlockHash`, `latestOutboundMessageBlockHeight`, `totalDeposits`, `totalWithdrawals` | The committed content of a channel at a point in history: origin fork, state-machine state commitment, participant set, both stream tips (hash + height), and aggregate deposit/withdrawal balances. |
| `StateSnapshot`  | `snapshotData`, `forkId`, `blockHeight`, `timestamp`                                                                                                                                                                                     | A `SnapshotData` bound to a fork and height. `forkId` = `hash(genesisSnapshotData)` of the fork the snapshot belongs to; `blockHeight` is the height of the block that committed to this snapshot.   |
| `ChannelBalance` | `latestInboundMessageBlockHash`, `latestInboundMessageBlockHeight`, `latestOutboundMessageBlockHeight`, `totalDeposits`, `totalWithdrawals`                                                                                              | The chain's per-channel accounting: its processed inbound tip (hash + height), its processed outbound **height** (no outbound hash is stored on-chain), and running deposit/withdrawal totals.       |

## 7. Dispute and proof types

Semantics: [../protocol/disputes.md](../protocol/disputes.md) (dispute inputs, windows,
reduction), [../protocol/fraud-proofs.md](../protocol/fraud-proofs.md) (fraud-proof families and
the on-chain slash set), [../protocol/state-proofs.md](../protocol/state-proofs.md) (milestones and
state proofs). Defined in [DisputeTypes.sol](../../../../contracts/V1/types/DisputeTypes.sol)
unless noted.

### 7.1 Disputes

| Struct                | Fields                                                                                                                                                                                                                                          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DisputeInput`        | `channelId`, `forkId`, `latestStateSnapshotHash`, `latestInboundMessageBlockHash`, `lastInboundMessageBlockHeight`, `stateProof`, `onChainSlashes[]`, `disputeAuditingDataHash`, `disputer`, `timeout` _(optional)_, `selfRemoval` _(optional)_ | The dispute claim. `forkId` is the hash of the disputed fork's genesis state (previous dispute output or latest on-chain state). `stateProof` proves the claimed latest state (§7.3). `onChainSlashes` is the consumed subset of the on-chain slash set. `disputeAuditingDataHash` = `hash(DisputeAuditingData)`, keeping uploads cheap. `disputer` MUST be the submitting `msg.sender`. `timeout` and `selfRemoval` are the optional timeout and voluntary-self-removal inputs. |
| `Dispute`             | `input`, `postedAuditingData`, `outputSnapshotDataHash`                                                                                                                                                                                         | The dispute record: the input claim, whether auditing data was posted as calldata, and the hash of the output state produced by dispute resolution.                                                                                                                                                                                                                                                                                                                              |
| `SignedDispute`       | `encodedDispute`, `signature`                                                                                                                                                                                                                   | A dispute signed by its author.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `DisputeConfirmation` | `signedDispute`, `signatures[]`                                                                                                                                                                                                                 | A dispute with collected signatures; full-threshold confirmation lets a window finalize immediately.                                                                                                                                                                                                                                                                                                                                                                             |
| `Timeout`             | `participant`, `blockHeight`, `minTimeStamp`, `isForced`, and optional `previousBlockProducer`, `previousBlockProducerPostedCalldata`, `participantSignatureOnPreviousBlock`                                                                    | A claim to remove an unavailable participant at a block height, invalid before `minTimeStamp`. `isForced` skips on-chain race-condition checks when the target committed to a block not linked to the latest state but deviation cannot be proven directly. The optional fields carry evidence about the previous block producer used by the timeout dispute fraud proofs. Precedence and ordering rules: [../protocol/disputes.md](../protocol/disputes.md).                    |

### 7.2 Windows, reduction, and storage

| Struct                          | Fields                                                                                                                                                                  | Role                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DisputeWindow`                 | `forkId`, `evidence`, `reducedResult`                                                                                                                                   | Per-fork dispute window state.                                                                                                                                                                                                                                   |
| `DisputeWindowEvidence`         | `creationTimestamp`, `lastEvidenceSubmissionTimestamp`, `disputeCommitments[]`, `hasPosted[]`                                                                           | The evidence phase: timing, committed dispute hashes, and who has posted.                                                                                                                                                                                        |
| `DisputeWindowReducedResult`    | `forkId`, `timestamp`, `reducer`                                                                                                                                        | The committed reduced result: the successor `forkId`, when it was reduced, and by whom.                                                                                                                                                                          |
| `ReduceOutput`                  | `latestBlock`, `slashedParticipants[]`, `latestInboundMessageBlockHash`, `latestInboundMessageBlockHeight`, `timeout`, `selfRemovals[]`                                 | The canonical outcome of order-independently reducing a fork's disputes: the latest valid carried-forward block, the slashes to apply, the inbound tip, at most one timeout, and voluntary self-removals.                                                        |
| `OnChainSlash`                  | `participant`, `timestamp`                                                                                                                                              | One entry of the on-chain slash set consumed by later disputes ([../protocol/fraud-proofs.md](../protocol/fraud-proofs.md)).                                                                                                                                     |
| `DisputeAuditingData`           | `genesisStateSnapshotData`, `latestStateSnapshot`, `milestoneSnapshots[]`, `latestFinalizedStateStateMachineState`, `inboundMessageBlocks[]`, `outboundMessageBlocks[]` | The heavy data backing a dispute, referenced by hash from `DisputeInput`. For K milestones there are K−1 snapshots (the first milestone is the genesis snapshot). `outboundMessageBlocks` covers the outbound chain segment proven up to the challenge deadline. |
| `DisputeData`                   | `onChainSlashes[]`, `disputeWindowMap` (`forkId → DisputeWindow`), `disputedForks[]`                                                                                    | Per-channel on-chain dispute storage.                                                                                                                                                                                                                            |
| `DisputeOutputState`            | `encodedModifiedState`, `outboundMessageBlock`, `totalDeposits`, `totalWithdrawals`                                                                                     | The state resulting from applying a dispute's transition (removals, slashes, exits) — the material behind `Dispute.outputSnapshotDataHash`.                                                                                                                      |
| `FraudProofVerificationContext` | `channelId`                                                                                                                                                             | Experimental context passed to fraud-proof verification; its final shape is undecided in code.                                                                                                                                                                   |

### 7.3 State proofs

Defined in [ProofTypes.sol](../../../../contracts/V1/types/ProofTypes.sol); semantics in
[../protocol/state-proofs.md](../protocol/state-proofs.md).

| Struct           | Fields                           | Role                                                                                                                                                  |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MilestoneProof` | `blockConfirmations[]`           | One milestone: a finality anchor proven directly by threshold signatures or virtually by later linked confirmations.                                  |
| `StateProof`     | `milestones[]`, `signedBlocks[]` | A chain of milestone anchors plus a trailing, cryptographically linked, possibly non-final suffix of signed blocks reaching the claimed latest state. |

### 7.4 Fraud proofs

Envelopes and enums in [ProofTypes.sol](../../../../contracts/V1/types/ProofTypes.sol); per-type
payload structs (the content of `encodedProof`) in
[FraudProofTypes.sol](../../../../contracts/V1/types/FraudProofTypes.sol) and
[DisputeFraudProofTypes.sol](../../../../contracts/V1/types/DisputeFraudProofTypes.sol). Semantics
in [../protocol/fraud-proofs.md](../protocol/fraud-proofs.md).

| Struct              | Fields                                                | Role                                                                                                                      |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `FraudProof`        | `proofType`, `participant`, `encodedProof`            | A block-level fraud claim. `participant` is the address to slash; running the encoded proof must return the same address. |
| `DisputeFraudProof` | `proofType`, `participant`, `dispute`, `encodedProof` | A dispute-level fraud claim; carries the accused `Dispute` itself.                                                        |

`FraudProofType` (block-level): `BlockDoubleSign`, `BlockInvalidStateTransition`, `WrongGenesis`,
`InvalidTimestamp`, `ForgedInboundMessageBlock`. Payload structs:
`BlockDoubleSignProof`, `BlockInvalidStateTransitionProof`, `WrongGenesisProof`,
`InvalidTimestampProof`, `ForgedInboundMessageBlockProof`, plus `BlockEmptyProof` (marked in code
for removal in favor of requiring transitions to actually change state).

`DisputeFraudProofType` (dispute-level), each with a matching payload struct:

| Value                                                                                                                        | Proves the dispute …                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DisputeNotLatestState`                                                                                                      | claimed a latest state that is not the latest.                                                                         |
| `DisputeInvalidOutputState`                                                                                                  | computed an incorrect output state.                                                                                    |
| `DisputeInvalidStateProof`                                                                                                   | carried an unverifiable state proof.                                                                                   |
| `DisputeInvalidBalanceInvariant`                                                                                             | violated the channel-balance invariant.                                                                                |
| `DisputeOnChainSlashesNotSubset`                                                                                             | listed on-chain slashes that are not a valid subset.                                                                   |
| `TimeoutThreshold`, `TimeoutCalldataPosted`, `TimeoutNotLinkedToLatestState`, `TimeoutParticipantNotNext`, `TimeoutTooEarly` | asserted an invalid timeout (contradicted by a threshold block or posted calldata, unlinked, wrong target, premature). |
| `DisputeInvalidBlockInStateProofApplyFraudProof`                                                                             | included a block in its state proof that is itself provably fraudulent.                                                |
| `DisputeLastMilestoneNotFinalAndNoAuditingData`                                                                              | ended its milestones on a non-final anchor without supplying auditing data.                                            |
| `InvalidDisputeReason`                                                                                                       | had no valid dispute input at all.                                                                                     |
| `DisputeStateProofHeaderMismatch`                                                                                            | carried a state proof whose headers do not match the claim.                                                            |
| `DisputeInboundHashNotInChain`                                                                                               | referenced an inbound message-block hash not in the on-chain inbound chain.                                            |
| `DisputeInvalidBlockStructure`                                                                                               | contained a structurally invalid block.                                                                                |
| `DisputeBlockAuthorNotParticipant`                                                                                           | contained a block authored by a non-participant.                                                                       |

## Future Work

_Non-normative._

- Generate this reference (fields and where-defined columns) from the Solidity sources or TypeChain
  output so it cannot drift from code.
- Document the exact ABI-encoding and hashing rules (`encodedBlock`, `encodedDispute`,
  `encodedProof`) alongside each struct once the serialization document exists.
- `FraudProofVerificationContext` is experimental in code; specify or remove it when the
  fraud-proof interface settles.
- `DisputeWindowEvidence.hasPosted` is noted in code as a candidate for a participant bitmask;
  reflect the change here if adopted.
