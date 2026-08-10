# State proofs, milestones, and finality

## Status and authority

This chapter defines the intended proof model. The current `StateProofFacet` implements part of it but rejects a required proof composition. That difference is a known bug, not a change to the intended model.

## 1. Purpose

A state proof shows that a claimed latest snapshot belongs to a valid history of one fork. It must do this without submitting every confirmation ever exchanged in a long-lived channel. Milestones compress finalized history into anchors. A trailing signed-block suffix carries the latest valid but possibly non-final state into a dispute.

## 2. Design decisions and rationale

### 2.1 Execution does not wait for finality

A valid block may be built on immediately. Peers do not stop after every block to collect all signatures. This preserves continuous execution. A later signature can finalize earlier ancestry through virtual voting.

The rejected model is “confirm a block unanimously before producing its child.” That turns one slow peer into a normal-path stop and contradicts the intended block pipeline.

### 2.2 A signature commits to the full ancestry

A participant signs encoded block bytes. Those bytes commit to `previousBlockHash`, and the parent commits recursively to all earlier blocks. The signature is therefore a vote for the signed block and its entire ancestor chain.

This is safe only with non-equivocation. A participant that signs conflicting blocks for the same authoring position exposes objective double-sign evidence and can be slashed.

### 2.3 Milestones are finality anchors

A milestone is an ordered list of linked block confirmations. Its first block’s snapshot becomes final when the union of distinct valid signatures found across the list covers the required threshold set. Later blocks provide virtual votes for the first block.

A milestone is not a bag of independently threshold-signed blocks. Linkage and signer coverage across ancestry are the point.

### 2.4 Membership changes require threshold-context hops

Finality cannot be checked against only the final participant set. A join or removal changes who must authorize later history. The hop that crosses a membership change uses the union of the previous snapshot participants, resulting snapshot participants, and pending joins consumed between their inbound heads. This prevents an asserted new set from authorizing its own creation.

### 2.5 The latest dispute state may be non-final

A state proof may end with a linked signed-block suffix after the last milestone. Those blocks need authentic author signatures and valid structure, but they do not need unanimous finality. During reduction, competing valid views are compared deterministically and the longest proved history is carried into the successor.

Discarding all non-final progress would let one unavailable participant roll back otherwise valid moves. Carrying it forward is tied to round-robin authoring and slashable equivocation.

## 3. Boundary and responsibilities

The contract verifies bytes, signatures, ancestry, threshold coverage, membership-hop snapshots, and the final snapshot commitment. The state proof does not by itself prove every application transition. Auditing data and fraud proofs handle invalid transition or invalid state claims. The SDK constructs minimal proofs from its block and snapshot stores.

## 4. Data model and owned state

### 4.1 Signed block

`SignedBlock` contains encoded `Block` bytes and the author signature over those exact bytes. The decoded transaction header names channel, author, fork, transaction count, and timestamp. The block also commits to a state snapshot hash, parent block hash, and consumed message blocks.

### 4.2 Block confirmation

`BlockConfirmation` contains one author-signed block plus zero or more additional signatures over the same encoded block. Signers are deduplicated by address. An invalid signature invalidates the confirmation; a valid signature by a non-threshold participant provides no threshold weight.

### 4.3 Milestone proof

`MilestoneProof.blockConfirmations` is an ordered, nonempty linked segment. The first confirmation names the snapshot being finalized. Later confirmations extend its ancestry and contribute virtual votes.

### 4.4 State proof

`StateProof` contains:

- zero or more milestone proofs, in historical order;
- zero or more trailing `SignedBlock` values after the last final anchor.

Both arrays may be nonempty. Genesis is the implicit final anchor when the milestone array is empty. The proof’s latest block is the last suffix block if a suffix exists, otherwise the last block confirmation of the last milestone, otherwise no block at genesis.

### 4.5 Milestone snapshots

Each milestone is paired with the `StateSnapshot` finalized by its first block. Snapshots provide participant and message-head context for the next hop. Their encoded hash must equal the snapshot hash committed by the finalized block.

## 5. Inputs and preconditions

State proof verification receives the dispute, auditing data, fork genesis snapshot data, milestone snapshots, and the latest claimed snapshot.

It requires:

1. auditing data hash equals the dispute commitment;
2. `forkId` equals the hash of genesis snapshot data;
3. milestone proof and milestone snapshot counts match;
4. every block decodes within configured byte and array bounds;
5. every author signature is valid and recovers the header participant;
6. all blocks name the dispute channel and fork;
7. transaction counts and parent hashes form one continuous path;
8. each milestone reaches full distinct signer coverage for its required set;
9. each paired snapshot hash matches its milestone’s finalized snapshot hash;
10. the suffix starts at the last milestone block, or at transaction count zero from genesis;
11. the final proved block commits to the latest claimed snapshot;
12. the latest snapshot commits to the supplied application state where that state is used.

## 6. Processing algorithm

### 6.1 Determine the initial anchor

1. Verify `forkId == hash(genesisSnapshotData)`.
2. Resolve the fork genesis timestamp from the adopted genesis or finalized origin-fork dispute path.
3. Construct the implicit genesis snapshot at block height zero.
4. Set current anchor snapshot to genesis, current participant context to genesis participants, and current block boundary to “before transaction zero.”

### 6.2 Verify each milestone

For milestone `i`:

1. Require a nonempty confirmation list.
2. Decode its first block and require channel and fork equality.
3. Require the segment begins at the next expected block after the prior anchor path. When a submitted proof includes an already adopted prefix, skip only a prefix whose linkage to the adopted snapshot is proved.
4. For each confirmation in order:
    1. require parent hash equals the hash of the previous encoded block;
    2. require transaction count increments by one;
    3. verify author signature and author/header equality;
    4. verify every added signature over the same bytes;
    5. add valid expected signers to a distinct signer set.
5. Derive the expected threshold participants as the union of prior snapshot participants, resulting snapshot participants, and pending participants introduced by inbound JOIN messages between those snapshot heads.
6. Require distinct signer set equals the complete expected threshold set. Extra nonmembers do not count; they do not compensate for a missing expected signer.
7. Require the first block’s `stateSnapshotHash` equals the hash of the paired milestone snapshot.
8. Require that snapshot’s fork, height, stream heads, and participant transition are consistent with the proved block and previous anchor.
9. Make the paired snapshot and last confirmation the next anchor context.

The protocol may allow one long confirmation segment to finalize more than one earlier block, but a compact proof must still state each membership-context hop needed by later verification.

### 6.3 Verify the trailing non-final suffix

1. If the suffix is empty, continue with the latest milestone block or genesis.
2. If no milestone exists, require the first suffix block has transaction count zero and the genesis parent representation required by the block format.
3. If a milestone exists, require the first suffix block’s parent hash equals the hash of the last block encoded in the last milestone and its count is one greater.
4. For each suffix block, verify decode, channel, fork, author signature, expected author under the state-machine leader schedule, parent hash, and count increment.
5. Do not require threshold confirmation of suffix blocks.
6. Record the last suffix block as the latest proved block.

Expected-author verification may require replaying the state machine from the final anchor. If the verifier cannot establish author order from committed inputs, the proof is incomplete.

### 6.4 Link the latest state

If a latest proved block exists, require its `stateSnapshotHash` equals the dispute’s `latestStateSnapshotHash`. Require that hash also equals the supplied latest snapshot. If the proof has no blocks, require the latest snapshot is the fork genesis snapshot with the resolved genesis timestamp.

### 6.5 Direct and virtual finality examples

For participants `[A, B, C]`:

- direct finality: block 7’s confirmation contains valid signatures by A, B, and C; block 7 is final;
- virtual finality: A authors block 7, B authors linked block 8, and C authors linked block 9. The three author signatures cover A, B, and C across the linked segment, so block 7 is final;
- partial votes: block 7 and block 8 cover only A and B; block 7 is not final;
- broken ancestry: three signatures across blocks that do not form one parent chain do not finalize anything.

## 7. Outputs and postconditions

Verification returns true only when one continuous path connects fork genesis through every supplied final anchor to the latest state. It does not mutate channel state. A successful same-fork snapshot update uses milestone verification as an input and then applies message-stream effects. A dispute uses proof validity to decide whether its latest view participates in reduction.

## 8. Invariants

- **PROOF-INV-1:** every counted signature signs exact bytes on one continuous fork history.
- **PROOF-INV-2:** an address counts at most once toward one milestone threshold.
- **PROOF-INV-3:** every required participant, not merely the same number of signers, appears in the milestone signer set.
- **PROOF-INV-4:** the first milestone block names the snapshot finalized by later virtual votes.
- **PROOF-INV-5:** a membership-changing hop is authorized under the union transition context.
- **PROOF-INV-6:** the suffix is a descendant of the last final anchor.
- **PROOF-INV-7:** lack of finality does not make an otherwise valid suffix invalid.
- **PROOF-INV-8:** the final proved block commits to the exact latest snapshot used by the dispute.
- **PROOF-INV-9:** a genesis-only proof resolves the authoritative genesis timestamp before hashing a full snapshot.
- **PROOF-INV-10:** proof verification is deterministic for identical ABI inputs.

## 9. Ordering, concurrency, and atomicity

Milestones are ordered historically. Confirmation signatures within one block are treated as a set for coverage, but their ABI order remains committed where the full structure is hashed elsewhere. The suffix is strictly ordered by parent and transaction count.

The adopted on-chain snapshot may advance while a proof transaction waits. Same-fork update logic may skip a proved prefix older than the adopted threshold snapshot only after verifying the submitted milestone segment actually contains the adopted snapshot commitment at its height. It must not accept a disconnected newer suffix because the lower snapshot changed.

## 10. Trust and security assumptions

ECDSA recovery and collision resistance of `keccak256` are cryptographic assumptions. The safety of non-final suffix carry-forward also assumes deterministic round-robin authoring and objective equivocation detection. Another leader policy requires a new proof and accountability analysis.

Milestone arrays are attacker-controlled. Verification needs bounds on blocks per milestone, milestone count, signatures per confirmation, snapshot participant count, and total encoded bytes. Otherwise an honest recovery proof can be priced out by adversarial history growth.

## 11. Failure behavior and recovery

Any decode, linkage, signature, membership, or snapshot mismatch makes the complete state proof invalid. Verification should return a typed failure for audit helpers and revert only at a state-changing boundary that requires validity.

An invalid dispute state proof is removed through a dispute fraud proof during the kill period. Invalid block structure may also expose an objective block fraud proof. The protocol must avoid applying the same economic slash twice even if several proof categories describe the same participant fault.

Long histories are recovered by producing successive final anchors. A peer missing the suffix obtains signed blocks through peer RPC or chain calldata events.

## 12. Current implementation

`contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol` implements milestone signer union, parent linkage, genesis linkage, snapshot matching, and signed-block authentication. It derives the milestone threshold as the union of previous and resulting participants plus pending joins. `StateChannelCommon` provides shared link checks. `ProofTypes.sol` declares the proof structures.

Current `verifyStateProof` explicitly returns false when both `milestones` and `signedBlocks` are nonempty. `_areSignedBlocksLinkedAndVerified` assumes a suffix starts at transaction zero. This implements two separate proof shapes instead of the intended anchor-plus-suffix composition.

The current milestone loop collects signer coverage across linked confirmations and treats the first block’s snapshot hash as finalized. It does not fully state or enforce every block header, height, expected-author, and membership-transition condition described above.

## 13. Difference from the intended design

| Classification     | Difference                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| bug                | milestones and trailing signed blocks are mutually rejected                                        |
| bug                | suffix validation assumes transaction zero rather than linking to the last milestone               |
| missing            | complete channel, fork, height, and expected-author validation at every milestone and suffix block |
| missing            | explicit double-sign proof integration as the safety basis for virtual votes                       |
| documentation debt | current skipped-milestone logic is complex and lacks a precise accepted-prefix contract            |
| missing            | proof length and gas bounds for long-lived channels                                                |
| decision pending   | bounded proof strategy for very long histories and many membership changes                         |
| decision pending   | finality and rollback behavior under any leader election other than round robin                    |

## 14. Dependencies and cross-layer effects

The SDK confirmation pipeline produces `BlockConfirmation` records and milestones. Storage must retain enough blocks, signatures, snapshots, and membership context to build proofs after restart. Reduction uses the latest proved block. Fraud proofs use proof indices and must share the same path interpretation. Same-fork snapshot updates consume milestone proofs directly.

## 15. Verification

Required vectors include:

- genesis with no blocks;
- direct unanimity on one block;
- virtual finality across `N` linked author blocks;
- duplicate signatures and signatures from outsiders;
- broken parent link and skipped height;
- wrong channel, fork, author, or expected leader;
- join from four to five participants with old-plus-new authorization;
- removal with the corresponding union context;
- multiple milestone hops;
- milestone plus valid non-final suffix;
- competing valid suffixes used by deterministic reduction;
- already-adopted prefix skipping;
- malformed and oversized proof data;
- double-sign evidence on conflicting suffixes.

Current tests exercise milestone and state-proof helpers, but the milestone-plus-suffix case is expected to fail under current code and must become a regression test for the fix.

## 16. Future work

Consider recursive or aggregated proofs only after the exact V1 signer, membership-hop, and suffix semantics are stable. Any compression must preserve fraud-proof extractability.
