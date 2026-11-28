# State Proof Store

> **Agent status:** Maintained design draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The two in-memory modules that keep proofs outside block history: the stored proof of
> the active fork (what it holds, how it is started, advanced, seeded by synchronization, re-rooted
> and reset, and how readers use it), the proof evidence kept from audits and synchronization, and
> the pruning of block history that the stored proof makes possible.
> Proof semantics: [state-proofs.md](../disputes/state-proofs.md). Shared storage rules:
> [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

Proof construction ([`REQ-SP-8-9ZCCEJ`](../disputes/state-proofs.md#req-sp-8-9zccej)) needs the
membership hops above the construction anchor and the latest point that can be proved final. The
node keeps them in one **stored proof** for its active fork, so a reader takes the proven part from
it and reads only the unfinalized tail from block history. Proofs the node verifies for other
purposes (a dispute audit, a synchronization) are kept apart as **proof evidence**; they never
enter block history or the stored proof.

Terms used in this document:

- **Anchor.** The start of the stored proof: the same-fork chain anchor as the local mirror holds
  it, or the fork genesis when the mirror holds no snapshot on that fork.
- **Hop.** One milestone of the stored proof and the snapshot it proves final. The milestone's
  first block is the hop's final block; the blocks after it carry the signatures that make it
  final. A hop's height is the height of its final block.
- **Final point.** The point the stored proof proves final: the last hop's snapshot, or the anchor
  when there is no hop. The stored proof holds the full state at it.
- **Membership change.** A hop changes membership unless its required signer union
  ([`REQ-SP-3-SP1JG4`](../disputes/state-proofs.md#req-sp-3-sp1jg4)) is exactly the participant set
  at its start and the participant set at its end. A joiner that joins and leaves inside the hop
  is in the union, so that hop changes membership although both ends have the same set.
- **Tail.** The executed blocks above the final point. They are block history, not part of the
  stored proof.

The **stored proof record** holds: the anchor snapshot; the hops in order, each with its milestone
and its snapshot; the final point snapshot; and the encoded full state at the final point. It is
keyed by fork, and at most one record exists: storing a record for another fork replaces it.

A **proof evidence record** holds the fork it belongs to, a proof of the stored-proof shape (its
start, its hops, its final point and the state there), the latest point seen on that fork and the
state at that latest point. A state the node does not hold is recorded as empty bytes (`0x`).
Audit evidence is keyed by the audited dispute's hash; sync evidence is keyed by the hash of the
proof's final point snapshot. The two key spaces never collide.

For example, the anchor is the genesis of fork F with participants A, B and C. Blocks 0 to 4 are
executed and each becomes final with no membership change: the stored proof has one hop, whose
final block is 4, and holds the state at 4. D joins at block 6, which becomes final with D's
signature on block 7: the hop at 6 changes membership, so it is appended and the record holds the
hops at 4 and 6. When 8 becomes final, the hop at 6 is kept and the hop at 8 is appended; when 9
becomes final with no change, the hop at 9 replaces the hop at 8. When the chain adopts the
snapshot at 6, the record is re-rooted there: the hops at 4 and 6 are dropped and the hop at 9 is
kept.

## Requirements and invariants

**<a id="req-proofstore-1-v5keyp"></a>`REQ-PROOFSTORE-1-V5KEYP` — One stored proof, for the
active fork.** A node MUST hold at most one stored proof, and only for one fork; storing a proof for
another fork MUST replace the previous one. The record holds exactly the anchor, the hops, the
final point and the full state at the final point; the tail MUST NOT be stored in it. Only data
that a walk from the record's anchor verified enters it
([`REQ-SP-2-ST4JJ4`](../disputes/state-proofs.md#req-sp-2-st4jj4)). The record is never checked
against block storage on read: a block, snapshot or signature missing or changed below the final
point after the record was written does not change it or what readers build from it. Storage
grants no validity: a record read back after a restart re-enters verification
([`REQ-STOR-3-4RJGER` (Restart recovery without trust)](durability.md#req-stor-3-4rjger)).

**<a id="inv-proofstore-1-0n80s6"></a>`INV-PROOFSTORE-1-0N80S6` — The proof write and the state
install are one step.** When a synchronization installs a state, the stored proof that its verified
proof yields MUST be written in the same synchronous step that persists the served history and
installs the state, with no suspension point between them. An install that aborts, whether on a
conflict found before the install or on one found between preparing the install and making it
visible, publishes neither the state nor the stored proof. When the stored proof changed after the
synchronization prepared its own from it, the install MUST abort rather than install without its
proof; that stale abort is no fault of the responder. A genesis install starts the new fork's
stored proof in the same step ([`REQ-PROOFSTORE-5-ZH56D4`](proof-store.md#req-proofstore-5-zh56d4)).
When the node already holds the installed point or a later one, no state is installed and the
stored proof is still written in the persist step when it is newer.

**<a id="inv-proofstore-2-4k6815"></a>`INV-PROOFSTORE-2-4K6815` — The record may lag history but
never lead it.** The stored proof's final point MUST always be a point that a walk from its anchor
proved and whose full state the node holds: one the node executed, installed, or reached on the
anchor itself. It never names a point the node's executed or installed history has not reached.
Writes to the stored proof are applied one at a time, in the order they were queued. A write that
was computed from an earlier read MUST be dropped when the record changed since that read or when
its fork is no longer the active fork. A reader MUST see every write queued before its read. The
writers triggered by a block commit, a stored-block merge or a chain snapshot update are not
awaited by their trigger, so a reader can see a record whose final point is below what executed
history already proves; it then builds from that lower final point, which is still valid.

**<a id="req-proofstore-2-dbn7sy"></a>`REQ-PROOFSTORE-2-DBN7SY` — Advance with own finality.**
After a block commits on the active fork, and after late signatures merge into a stored block of
the active fork, the node MUST advance the stored proof. Without a record it first starts one at
the anchor, only when it holds the state there. It then derives, over its executed block history
from the record's final point upward, each later point that can be proved final
([`REQ-SP-8-9ZCCEJ`](../disputes/state-proofs.md#req-sp-8-9zccej)). Each new final point replaces
the last hop when that hop changes no membership; otherwise it is appended as a new hop. The result
is written only when it verifies from the anchor and the node holds the state at its new final
point. The walk runs on the local mirror first and asks the chain only when the local walk completes
with a false result; an error is no result and keeps the record. When the result with replacements
does not verify, the node MUST try again with every new final point appended, so one failed
replacement never stops the advance. The dispute audit never writes the stored proof.

**<a id="req-proofstore-3-fdnjyn"></a>`REQ-PROOFSTORE-3-FDNJYN` — Seeding from a verified
synchronization.** After a received proof verifies in synchronization
([`REQ-SP-10-JMVHTB`](../disputes/state-proofs.md#req-sp-10-jmvhtb)), the node MUST prepare the
stored proof it yields and write it in the persist step
([`INV-PROOFSTORE-1-0N80S6`](proof-store.md#inv-proofstore-1-0n80s6)). When the proof verified from
the node's own final point, the record keeps its anchor and its hops and gains the received hops
above that final point, folded as an own advance folds them
([`REQ-PROOFSTORE-2-DBN7SY`](proof-store.md#req-proofstore-2-dbn7sy)): a received final point replaces the last hop when that hop
changes no membership, and when the folded record does not verify from the anchor the received hops
are appended. A proof that verified from the anchor or the fork genesis installs only for a node
without an own final point, or with one at or below that start
([`REQ-SYNC-5-M7W6JX` (Install only from where the requester stands)](../peer-communication/synchronization.md#req-sync-5-m7w6jx)); the
record is then the received hops rooted at that start, and a proof kept out writes nothing to it. Received hops are kept as received, since a verified hop
needs no other evidence; the last one is cut to the run that carries its required signatures,
because its tail is replayed as block history. The record is written only when its final point is
later than the stored one, and only when the node holds the state at the walk's final point; a
received proof that ends at the stored final point changes nothing. When the run consumed by the
last hop is not held, so that hop cannot be cut, nothing is written. How a received proof merges
with a stored proof it does not extend is
[`OQ-SPEC-PROOFSTORE-4-WJWVVW`](../open-questions.md#oq-spec-proofstore-4-wjwvvw).

**<a id="req-proofstore-4-xb8z9w"></a>`REQ-PROOFSTORE-4-XB8Z9W` — Re-rooting on a chain anchor
advance.** When the local mirror adopts a snapshot of the record's fork that is later than the
record's anchor, the node MUST re-root the stored proof there. Hops whose final point is at or
below the new anchor are dropped. The remaining hops are kept when they verify from the new anchor
to the same final point. Otherwise the record restarts at the new anchor with the state there and
then advances over block history
([`REQ-PROOFSTORE-2-DBN7SY`](proof-store.md#req-proofstore-2-dbn7sy)). When the node holds no state
at the new anchor and no kept hop verifies, the record is kept unchanged. Re-rooting the kept hops
needs neither block history nor the state at the new anchor, and no history is retained only for
the restart. Only a chain anchor
advance re-roots the record; a later own final point never does. Whether re-rooting waits for
base-layer finality of the adoption is
[`OQ-SPEC-PROOFSTORE-8-07YFKT` (Re-rooting and base-layer finality of the adoption)](../open-questions.md#oq-spec-proofstore-8-07yfkt).

**<a id="req-proofstore-5-zh56d4"></a>`REQ-PROOFSTORE-5-ZH56D4` — Reset on a fork change.** When the
node installs the genesis of a fork for which it holds no stored proof, the stored proof MUST become
that genesis alone, as anchor and final point with no hop, with the installed state. This replaces
the previous fork's record; nothing of the old record enters the new one. A stored proof the node
already holds for that fork is kept. A proof the node needs for an old fork comes only from proof
evidence ([`REQ-PROOFSTORE-7-B5PW2P`](proof-store.md#req-proofstore-7-b5pw2p)).

**<a id="req-proofstore-6-x7ft2k"></a>`REQ-PROOFSTORE-6-X7FT2K` — Readers use the stored proof.**
Every reader that needs a proof of its own active fork from the anchor MUST take it from the stored
proof: the synchronization responder, the node's own dispute, the snapshot update, the dispute
audit's local final tier ([`REQ-SP-9-RNXP56`](../disputes/state-proofs.md#req-sp-9-rnxp56)) and the
counters that need a proved final point. A proof at a requested height holds the record's hops whose
milestones end at or below that height, leaving out hops wholly below the local mirror's anchor, then
the linked tail from executed block history: appended to the last hop, or starting at the anchor
block when no hop is left. A proof of the final point only leaves out the tail. A missing or
unlinked tail block MUST make construction fail; an incomplete proof is never returned. The node's
local final point is the record's final point when the record holds a hop, and none otherwise. The
final points the node can prove for a counter are the record's hop points above the local mirror's
anchor, fewest hops first; the exact final proof at such a point is the record's hops up to that
hop. At any other height the node has no final proof of its own; agreeing audit evidence may add a
point there ([`REQ-PROOFSTORE-7-B5PW2P`](proof-store.md#req-proofstore-7-b5pw2p)).

**<a id="req-proofstore-7-b5pw2p"></a>`REQ-PROOFSTORE-7-B5PW2P` — Proof evidence outside block
history.** A proof the node verifies in a dispute audit MUST be kept only as audit evidence of that
dispute, after the audit's walk accepted it and its replay was valid: its start, the threshold hops
above the start as received with the snapshots they prove, the walk's final point with its state, and
the dispute's latest point with its state. No block, snapshot or membership change point is written
for it. When a hop's final block conflicts with the block stored at its height or with a final block
of other evidence of the fork, nothing is kept. Audit evidence is pinned: it is never counted toward
the bound, refused or evicted. Sync evidence holds proofs verified in synchronization; each fork
holds at most as many sync records as the channel's maximum participant count. A sync record is
written only for a proof that synchronization verified but kept out because a final-history kill
held ([`REQ-SYNC-5-M7W6JX` (Install only from where the requester stands)](../peer-communication/synchronization.md#req-sync-5-m7w6jx)): the walk's start (the fork genesis without
one), the threshold hops above it as received with the snapshots they prove, and the walk's final
point, also its latest point, with the served state there when it hashes to that point's state,
else empty bytes. It is kept only when its hops fit in a dispute upload under the chain's cap, since
no dispute can carry a larger history. Only audit evidence adds final points for a counter or for
the conflict check of later audit evidence; sync evidence serves snapshot and state lookups; a record that would
exceed that bound is refused and the refusal is logged, while a record replacing one with the same
final point is accepted. A fork's audit and sync records stay until the local mirror's chain anchor
leaves that fork. The proof evidence also keeps the forks on which a synchronization showed the node's
own history to be the side chain, so that the node signs nothing more there
([`REQ-SYNC-5-M7W6JX` (Install only from where the requester stands)](../peer-communication/synchronization.md#req-sync-5-m7w6jx)). Such a stop holds only for its fork; no later
record, refusal or other fork's drop lifts it, and it is removed with the fork's records. A state is read from evidence only by its hash, and an empty state is never
returned. A dispute replay's executed tail is block history, not evidence: it is stored by
coordinate without moving the head, and the first block stored at a coordinate is kept
([`REQ-SP-10-JMVHTB`](../disputes/state-proofs.md#req-sp-10-jmvhtb)).

**<a id="req-proofstore-8-r38ky5"></a>`REQ-PROOFSTORE-8-R38KY5` — History pruning.** Pruning is a node
setting that is off by default; when it is off, nothing is deleted. When it is on, the node MUST
delete history in two phases, each in one step that no write can interleave:

- **Below the anchor (phase 1).** After a re-root writes the record at a new chain anchor, the node
  deletes the blocks, snapshots, states and membership change points of the record's fork below that
  anchor. It keeps the anchor block with its snapshot and state, and the fork genesis with its state,
  which synchronization serving needs. When the local mirror's chain anchor leaves a fork, the node
  deletes that fork's whole history the same way, its genesis included. Neither delete runs while
  the local mirror holds a dispute on that fork; there is no delay after the adoption.
- **Skipped by a proven final hop (phase 2).** After each write of the stored proof by an advance, a
  synchronization install or a reset, the node deletes the blocks and states above the record's
  anchor and below its final point. It keeps the final-point block, the tail and every snapshot;
  those snapshots go with phase 1.

A state is keyed by its hash and can back several snapshots, so a state is deleted only when no
other held snapshot references it. Pruning never deletes message blocks, block calldata, queue
entries, fraud proofs, proof evidence or the stored proof. Pruned data is absent, never evidence
([`OQ-SPEC-PROOFSTORE-11-9X8JFG` (Missing-evidence policy with pruned storage)](../open-questions.md#oq-spec-proofstore-11-9x8jfg)); a later verified proof that carries a pruned hop merges
without restoring the dropped history. The retention bounds are
[`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](durability.md#req-stor-4-mf6ft6).

## Assumptions and constraints

- The stored proof uses the milestone form and verification rules of
  [state-proofs.md](../disputes/state-proofs.md). It is local, off-chain data: no contract or
  verification rule changes.
- Both modules are process memory. Their contents do not survive a restart; restart durability is
  [`OQ-SPEC-PROOFSTORE-9-7CNC80` (Restart durability of the stored proof and proof evidence)](../open-questions.md#oq-spec-proofstore-9-7cnc80). Each single
  operation follows [`REQ-STOR-2-TARP8S` (Commit-aligned durability)](durability.md#req-stor-2-tarp8s), and stores exchange
  values, not references ([`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](durability.md#req-stor-6-skp0km)).
- The anchor follows the local mirror of the chain anchor, which may lag the chain but never leads
  it ([`REQ-SP-8-9ZCCEJ`](../disputes/state-proofs.md#req-sp-8-9zccej)). A private final point never
  becomes the anchor.
- Direct access is the aim. The stored proof spares the walk over history, but its size grows with
  the hops kept between anchor advances
  ([`OQ-SPEC-PROOFSTORE-10-66ZDB2` (Snapshot updates that bound the stored proof)](../open-questions.md#oq-spec-proofstore-10-66zdb2)).
- Pruning ([`REQ-PROOFSTORE-8-R38KY5`](proof-store.md#req-proofstore-8-r38ky5)) follows the decisions on
  [`OQ-SPEC-PROOFSTORE-1-H52WPZ` (Retention rule for pruning below the on-chain snapshot)](../open-questions.md#oq-spec-proofstore-1-h52wpz) and
  [`OQ-SPEC-PROOFSTORE-2-218XFC` (Pruning above the anchor and lost exact-height checks)](../open-questions.md#oq-spec-proofstore-2-218xfc). It is off by default, and it is not combined with
  persistence of the stores
  ([`OQ-SPEC-PROOFSTORE-9-7CNC80` (Restart durability of the stored proof and proof evidence)](../open-questions.md#oq-spec-proofstore-9-7cnc80)).
- Absent data is never evidence; each reader has its own rule
  ([`OQ-SPEC-PROOFSTORE-11-9X8JFG` (Missing-evidence policy with pruned storage)](../open-questions.md#oq-spec-proofstore-11-9x8jfg), resolved). The conflict check counts only stored blocks on the
  hash-linked run that ends at the executed head
  ([`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../block-progression/block-processing.md#req-block-pipe-2-pcxnt6)). A dispute audit that lacks a
  milestone snapshot or the replay base state does not judge that proof and stores no counter from
  it; its state-free checks and the own dispute upload still run
  ([`REQ-SP-9-RNXP56`](../disputes/state-proofs.md#req-sp-9-rnxp56)). Reduce data that is not held is no result and is asked again;
  synchronization serving is unchanged. A re-root first re-roots the record's own hops; when that
  fails and the state at the new anchor is not held, the record is kept unchanged, and no extra
  history is retained for that fallback.
- Finality evidence is distinct from application-state validity. The stored proof proves which
  points are final; it does not prove that every application transition was correct.
- Behavior is the same on every supported host
  ([`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../runtime/execution.md#req-runtime-4-b0n70y)).

## Security considerations

Protected assets are the node's ability to prove its latest final state, to serve verifiable
synchronization and to audit and contest disputes, and the integrity of its block history. The
trust boundary is proof intake: a received proof is untrusted until it verifies.

- **Poisoned history.** A verified proof can carry signed blocks that never executed. Kept as block
  history, such a block could displace an honest block or ground a false accusation against an
  honest author. Audit evidence stays outside block history
  ([`REQ-PROOFSTORE-7-B5PW2P`](proof-store.md#req-proofstore-7-b5pw2p)); a replayed dispute tail
  is executed history and is kept by first write.
- **Torn install.** A state installed without its stored proof, or a stored proof published for an
  install that aborted, would let the node serve or dispute from a final point it does not hold.
  [`INV-PROOFSTORE-1-0N80S6`](proof-store.md#inv-proofstore-1-0n80s6) makes them one step and
  aborts a stale install without blaming the responder.
- **Stale writes.** An advance computed before a fork change, a re-root or a synchronization
  install could overwrite a newer record. [`INV-PROOFSTORE-2-4K6815`](proof-store.md#inv-proofstore-2-4k6815)
  drops such a write; the record may lag executed history but never names a point the node has not
  reached.
- **Edited history.** Blocks below the final point can be pruned, missing after a compact
  synchronization, or edited by a fault. The record is not checked against them
  ([`REQ-PROOFSTORE-1-V5KEYP`](proof-store.md#req-proofstore-1-v5keyp)), so their absence is never
  read as a reason to lower or drop a proven point; only the tail is read from history.
- **Evidence flooding.** A peer can serve many different valid side proofs. Sync evidence is
  bounded per fork and refused at the bound; audit evidence is bounded by the chain, which accepts
  one dispute per disputer per window. Residual: at a full bound, later sync evidence of that fork
  is not kept.
- **Anchor reversal.** If the chain removes an adoption after the node re-rooted on it, the dropped
  hops are gone and the record starts at an anchor the chain no longer holds. Verification then
  falls back to the chain tier ([`REQ-SP-9-RNXP56`](../disputes/state-proofs.md#req-sp-9-rnxp56));
  the re-root trigger is [`OQ-SPEC-PROOFSTORE-8-07YFKT` (Re-rooting and base-layer finality of the adoption)](../open-questions.md#oq-spec-proofstore-8-07yfkt).
- **Re-root without the restart state.** When no kept hop verifies from a new chain anchor and the
  node holds no state there (for example after pruning), the record keeps its older anchor below the
  chain's until a later re-root passes or a synchronization replaces the record. Residual: a
  synchronization to a final point equal to the record's does not replace it, so a node with no
  later final point can keep that older anchor.
- **Pruned history.** With pruning on, the node gives up what the deleted history gave: double-sign
  detection and exact-height checks at pruned heights, an audit replay from a pruned final point (that
  proof is not judged, [`REQ-SP-9-RNXP56`](../disputes/state-proofs.md#req-sp-9-rnxp56)), and the participant union of the anchor block
  and of the final-point block for a late signature, which reads the block below. Fraud proofs, proof
  evidence and the stored proof are kept apart and are never pruned. Residual: a fork the chain
  anchor leaves through a cross-fork adoption still carries its dispute in the mirror at that
  moment, so its history is kept rather than deleted.
- **Growth.** Hops that change membership accumulate between anchor advances, and a participant
  that forces many membership changes grows every peer's stored proof and the disputes built from
  it. The bound is the snapshot update and the dispute size limits
  ([`OQ-SPEC-PROOFSTORE-10-66ZDB2` (Snapshot updates that bound the stored proof)](../open-questions.md#oq-spec-proofstore-10-66zdb2)).

## Verification and test plan

### Requirement test matrix

#### <a id="req-proofstore-1-v5keyp.t1"></a>`REQ-PROOFSTORE-1-V5KEYP.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-1-V5KEYP`](proof-store.md#req-proofstore-1-v5keyp)

**Setup and stimulus:**

Store records for one fork and then another; read each fork; edit block storage below the final
point after the record was written.

**Expected result:**

One record exists; another fork reads nothing; a history edit below the final point changes neither
the record nor the proof built from it.

**Required permutations:**

<a id="req-proofstore-1-v5keyp.t1.p1"></a>`REQ-PROOFSTORE-1-V5KEYP.T1.P1` — Storing a record for another fork drops the previous fork's record.

<a id="req-proofstore-1-v5keyp.t1.p2"></a>`REQ-PROOFSTORE-1-V5KEYP.T1.P2` — A read for a fork other than the stored one returns nothing.

<a id="req-proofstore-1-v5keyp.t1.p3"></a>`REQ-PROOFSTORE-1-V5KEYP.T1.P3` — The stored block at the final point is dropped after the record was written: the final point and the proof built over it are unchanged.

#### <a id="inv-proofstore-1-0n80s6.t1"></a>`INV-PROOFSTORE-1-0N80S6.T1`

**Requirements / invariants:**

[`INV-PROOFSTORE-1-0N80S6`](proof-store.md#inv-proofstore-1-0n80s6)

**Setup and stimulus:**

Synchronize a node and interrupt the install between preparing the stored proof and making the
install visible: with a conflicting block, and with a write to the stored proof.

**Expected result:**

An aborted install publishes neither the state nor the stored proof; a stale abort does not reject
the responder.

**Required permutations:**

<a id="inv-proofstore-1-0n80s6.t1.p1"></a>`INV-PROOFSTORE-1-0N80S6.T1.P1` — A conflict found after the stored proof was prepared aborts the install: neither the state nor the stored proof is published.

<a id="inv-proofstore-1-0n80s6.t1.p2"></a>`INV-PROOFSTORE-1-0N80S6.T1.P2` — The stored proof changes after the synchronization prepared its own: the install aborts, the state is not published and the prepared proof is not written.

<a id="inv-proofstore-1-0n80s6.t1.p3"></a>`INV-PROOFSTORE-1-0N80S6.T1.P3` — An install aborted because the stored proof changed meanwhile rejects nobody: the responder is not blacklisted.

#### <a id="inv-proofstore-2-4k6815.t1"></a>`INV-PROOFSTORE-2-4K6815.T1`

**Requirements / invariants:**

[`INV-PROOFSTORE-2-4K6815`](proof-store.md#inv-proofstore-2-4k6815)

**Setup and stimulus:**

Queue an advance for a fork after the active fork changed; let an audit verify a later final point
than the node's own.

**Expected result:**

A write for a fork that is no longer active is dropped; no writer outside the node's own history
moves the final point.

**Required permutations:**

<a id="inv-proofstore-2-4k6815.t1.p1"></a>`INV-PROOFSTORE-2-4K6815.T1.P1` — An advance of the old fork after a fork change writes nothing, and the new fork's record stays.

<a id="inv-proofstore-2-4k6815.t1.p2"></a>`INV-PROOFSTORE-2-4K6815.T1.P2` — An audit that verifies a later final point than the node's own leaves the stored proof unchanged.

#### <a id="req-proofstore-2-dbn7sy.t1"></a>`REQ-PROOFSTORE-2-DBN7SY.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-2-DBN7SY`](proof-store.md#req-proofstore-2-dbn7sy)

**Setup and stimulus:**

Finalize blocks with and without membership changes, including a join and an exit; finalize a later
block above a re-rooted anchor.

**Expected result:**

A hop that changes membership stays as its own hop; a hop that changes none is replaced by the next
final point; every advance verifies from the anchor.

**Required permutations:**

<a id="req-proofstore-2-dbn7sy.t1.p1"></a>`REQ-PROOFSTORE-2-DBN7SY.T1.P1` — A join hop is kept as its own final point of the stored proof, and its exact final proof is the stored hops up to it.

<a id="req-proofstore-2-dbn7sy.t1.p2"></a>`REQ-PROOFSTORE-2-DBN7SY.T1.P2` — An exit hop is kept as its own final point of the stored proof, and its exact final proof is the stored hops up to it.

<a id="req-proofstore-2-dbn7sy.t1.p3"></a>`REQ-PROOFSTORE-2-DBN7SY.T1.P3` — With no membership change, each later final point replaces the last hop, so the record holds one hop.

<a id="req-proofstore-2-dbn7sy.t1.p4"></a>`REQ-PROOFSTORE-2-DBN7SY.T1.P4` — A final block after a re-root advances the record above the new anchor.

#### <a id="req-proofstore-3-fdnjyn.t1"></a>`REQ-PROOFSTORE-3-FDNJYN.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-3-FDNJYN`](proof-store.md#req-proofstore-3-fdnjyn)

**Setup and stimulus:**

Synchronize a node to a later final point than its own, and to the final point it already holds;
synchronize from the own final point with a last hop that changes no membership.

**Expected result:**

A later final point is written with its state; the same final point changes nothing; a received
final point replaces a last hop that changes no membership.

**Required permutations:**

<a id="req-proofstore-3-fdnjyn.t1.p1"></a>`REQ-PROOFSTORE-3-FDNJYN.T1.P1` — A synchronization to a later final point than the stored one stores the served final point with its state.

<a id="req-proofstore-3-fdnjyn.t1.p2"></a>`REQ-PROOFSTORE-3-FDNJYN.T1.P2` — A synchronization to the final point already stored leaves the stored proof unchanged.

<a id="req-proofstore-3-fdnjyn.t1.p3"></a>`REQ-PROOFSTORE-3-FDNJYN.T1.P3` — A synchronization from the own final point whose last hop changes no membership replaces that hop with the served final point: the stored proof holds one hop.

#### <a id="req-proofstore-4-xb8z9w.t1"></a>`REQ-PROOFSTORE-4-XB8Z9W.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-4-XB8Z9W`](proof-store.md#req-proofstore-4-xb8z9w)

**Setup and stimulus:**

Re-root a record directly at a held snapshot below its final point; post a snapshot update in a
live channel.

**Expected result:**

The anchor moves to the new anchor; hops above it and the final point with its state are kept;
every peer re-roots on the chain update.

**Required permutations:**

<a id="req-proofstore-4-xb8z9w.t1.p1"></a>`REQ-PROOFSTORE-4-XB8Z9W.T1.P1` — A re-root at the snapshot below the final point moves the anchor there and keeps the hop above it and the final point with its state.

<a id="req-proofstore-4-xb8z9w.t1.p2"></a>`REQ-PROOFSTORE-4-XB8Z9W.T1.P2` — A snapshot update posted on chain re-roots every peer's stored proof at the posted snapshot, with the state there.

<a id="req-proofstore-4-xb8z9w.t1.p3"></a>`REQ-PROOFSTORE-4-XB8Z9W.T1.P3` — With the state at the new anchor and the blocks below the final point absent, a re-root at the snapshot below the final point still passes from the record's own hop: the anchor moves there, the hop and the final point with its state are kept.

#### <a id="req-proofstore-5-zh56d4.t1"></a>`REQ-PROOFSTORE-5-ZH56D4.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-5-ZH56D4`](proof-store.md#req-proofstore-5-zh56d4)

**Setup and stimulus:**

Reset the stored proof at a reduced fork's genesis; resolve a dispute in a live channel so it moves
to a reduced fork.

**Expected result:**

The new fork's record is its genesis alone with its state; the old fork has no record; a final
block on the new fork advances it.

**Required permutations:**

<a id="req-proofstore-5-zh56d4.t1.p1"></a>`REQ-PROOFSTORE-5-ZH56D4.T1.P1` — A reset at the genesis of a reduced fork makes that genesis, with its state and no hop, the stored proof, and the old fork's record is gone.

<a id="req-proofstore-5-zh56d4.t1.p2"></a>`REQ-PROOFSTORE-5-ZH56D4.T1.P2` — A dispute moves a live channel to a reduced fork: each honest peer's stored proof is on the new fork with its state, none on the old fork, and a final block advances it.

#### <a id="req-proofstore-6-x7ft2k.t1"></a>`REQ-PROOFSTORE-6-X7FT2K.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-6-X7FT2K`](proof-store.md#req-proofstore-6-x7ft2k)

**Setup and stimulus:**

Build proofs after a tail block above the final point is dropped.

**Expected result:**

A missing tail block makes construction fail.

**Required permutations:**

<a id="req-proofstore-6-x7ft2k.t1.p1"></a>`REQ-PROOFSTORE-6-X7FT2K.T1.P1` — A dropped tail block above the stored final point makes construction throw with the missing-block error.

#### <a id="req-proofstore-7-b5pw2p.t1"></a>`REQ-PROOFSTORE-7-B5PW2P.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-7-B5PW2P`](proof-store.md#req-proofstore-7-b5pw2p)

**Setup and stimulus:**

Store audit and sync records on several forks up to and past the sync bound; drop a fork; read
states that a record does not hold. Keep a side chain from a synchronization under the chain's upload cap
and under a cap its hops exceed. Stop signing on two forks, write and refuse records on one, drop the other
or both.

**Expected result:**

Sync evidence is bounded per fork and refused at the bound; audit evidence is never refused or
evicted; a dropped fork keeps nothing; an empty state is never returned; a side chain is kept
only when its hops fit in a dispute upload. A signing stop holds only on its fork, survives every later
write and another fork's drop, and is removed with its fork.

**Required permutations:**

<a id="req-proofstore-7-b5pw2p.t1.p1"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P1` — A new sync record on a fork at the bound is refused and the refusal is logged.

<a id="req-proofstore-7-b5pw2p.t1.p2"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P2` — Audit evidence is never refused or evicted when the fork's sync evidence is at the bound.

<a id="req-proofstore-7-b5pw2p.t1.p3"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P3` — Dropping a fork removes its audit and sync evidence and keeps another fork's.

<a id="req-proofstore-7-b5pw2p.t1.p4"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P4` — A state a record does not hold is never returned, also for the hash of empty bytes.

<a id="req-proofstore-7-b5pw2p.t1.p5"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P5` — A side chain kept out of a synchronization under the chain's upload cap is kept as sync evidence of its final point: its start, the conflicting hop and the final point with its state.

<a id="req-proofstore-7-b5pw2p.t1.p6"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P6` — A side chain whose hops do not fit in a dispute upload is not kept as sync evidence.

<a id="req-proofstore-7-b5pw2p.t1.p7"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P7` — A signing stop holds on its fork and on no other fork.

<a id="req-proofstore-7-b5pw2p.t1.p8"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P8` — A signing stop survives a refused and an accepted record on its fork and the drop of another fork.

<a id="req-proofstore-7-b5pw2p.t1.p9"></a>`REQ-PROOFSTORE-7-B5PW2P.T1.P9` — Dropping a fork removes its signing stop with its records and keeps another fork's stop.

#### <a id="req-proofstore-8-r38ky5.t1"></a>`REQ-PROOFSTORE-8-R38KY5.T1`

**Requirements / invariants:**

[`REQ-PROOFSTORE-8-R38KY5`](proof-store.md#req-proofstore-8-r38ky5)

**Setup and stimulus:**

Run a channel with pruning on and with it off: finalize several blocks, let the chain adopt a
snapshot, re-root with and without a dispute mirrored on the fork, move the anchor to a reduced
fork, then synchronize a new peer, audit an honest dispute, a side-chain dispute and a dispute whose
final point the auditor pruned.

**Expected result:**

Off deletes nothing. On deletes exactly the phase 1 and phase 2 sets and keeps the listed points;
synchronization, audits, kills and reductions still work, and an auditor without the pruned base
does not judge that proof but still lands its own dispute.

**Required permutations:**

<a id="req-proofstore-8-r38ky5.t1.p1"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P1` — Pruning off (the default): final points advance and every block, snapshot and state stays.

<a id="req-proofstore-8-r38ky5.t1.p2"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P2` — Pruning on, final points advance: the blocks and states between the anchor and the final point are gone; their snapshots, the final-point block with its state and the tail stay.

<a id="req-proofstore-8-r38ky5.t1.p3"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P3` — Pruning on, a snapshot adoption moves the chain anchor: below it the blocks, snapshots and states are gone; the anchor block with its snapshot and state and the fork genesis with its state stay.

<a id="req-proofstore-8-r38ky5.t1.p4"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P4` — Pruning on, a re-root at an anchor below the final point with no dispute mirrored: the history below the anchor is deleted, the anchor block stays.

<a id="req-proofstore-8-r38ky5.t1.p5"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P5` — Pruning on, a re-root while the local mirror holds a dispute on the fork: nothing below the new anchor is deleted.

<a id="req-proofstore-8-r38ky5.t1.p6"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P6` — Pruning on, a dispute moves the chain anchor from a fork it was adopted on to a reduced fork: the left fork, still disputed in the mirror, keeps its history at every honest peer.

<a id="req-proofstore-8-r38ky5.t1.p7"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P7` — Pruning on, past several final points and an anchor advance: every participant keeps only the anchor block below its final point, and a new peer synchronizes from the pruned peers and follows the channel.

<a id="req-proofstore-8-r38ky5.t1.p8"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P8` — Pruning on, past several final points and an anchor advance, honest peers dispute an invalid transition: no auditor stores a counter, and the reduction moves every honest peer to the next fork.

<a id="req-proofstore-8-r38ky5.t1.p9"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P9` — Pruning on, a side-chain dispute that hops above a seated joiner's final point without the joiner's JOIN is still killed by the joiner's final-point regression counter.

<a id="req-proofstore-8-r38ky5.t1.p10"></a>`REQ-PROOFSTORE-8-R38KY5.T1.P10` — Pruning on, an auditor that pruned the state at the disputer's final point (its own final point and latest state are later) does not judge that proof, stores no counter and sends no kill, and its own dispute lands on chain.

## Future Work

_Non-normative._ A disk medium for both modules, which then follows the durability contract of
[durability.md](./durability.md). A same-fork snapshot update triggered by stored-proof size, once
[`OQ-SPEC-PROOFSTORE-10-66ZDB2` (Snapshot updates that bound the stored proof)](../open-questions.md#oq-spec-proofstore-10-66zdb2) is decided.
