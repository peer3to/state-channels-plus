# AgreementManager.ts

> **Source:** [src/agreementManager/AgreementManager.ts](../../../../../../src/agreementManager/AgreementManager.ts)

## Requirements

- [`REQ-FIN-3-9P9J4Q` (A signature on block B is also an indirect vote for every ancestor of B on the…)](../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q)
- [`REQ-SP-1-9YABY1` (A milestone normally proves its first block final, directly or through…)](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
- [`REQ-SP-2-ST4JJ4` (Proofs connect the trusted start through required final membership hops to the…)](../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
- [`REQ-SP-3-SP1JG4` (A membership hop requires signatures from the union of the previous…)](../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)
- [`REQ-MIRROR-3-THD7K8` (Cache, never authority)](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8)
- [`REQ-SP-8-9ZCCEJ` (Construct proofs from the mirrored chain anchor, which may lag the chain but…)](../../../../specification/disputes/state-proofs.md#req-sp-8-9zccej)
- [`REQ-SP-9-RNXP56` (Both synchronization and dispute audit try the peer's latest finalized state,…)](../../../../specification/disputes/state-proofs.md#req-sp-9-rnxp56)
- [`REQ-SP-10-JMVHTB` (After successful synchronization, persist the verified start and retained…)](../../../../specification/disputes/state-proofs.md#req-sp-10-jmvhtb)
  Contradicts: sync's `stageVerifiedProof` can retain unexecuted proof support that contaminates installed history; an audit writes its verified material to proof evidence through `persistAuditEvidence` instead ([`FIND-PROOF-PERSISTENCE-1-HYC9DS`](../../../../audit/open-findings.md#find-proof-persistence-1-hyc9ds)).
- [`REQ-IX-4-BB35GC`](../../../../specification/disputes/README.md#req-ix-4-bb35gc)
- [`REQ-FIN-7-RTZWQZ` (The threshold is unanimous over the _relevant participant set_)](../../../../specification/protocol-model/finality.md#req-fin-7-rtzwqz)
- [`REQ-FIN-4-ZFDDS6` (Consequently, in a channel with N participants, N consecutive blocks authored…)](../../../../specification/protocol-model/finality.md#req-fin-4-zfdds6)
- [`REQ-BLOCK-PIPE-11-DCHAJ2` (Signature admission by participant union)](../../../../specification/block-progression/block-processing.md#req-block-pipe-11-dchaj2)
- [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)

## UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D

Proof construction

- Setup: Build proofs across membership changes, virtual-finality windows, genesis anchoring, and suffix fallback
- Oracle: Milestones at every change point; virtual coverage computed per the union rule; proofs verify under the canonical facet

- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P1` — hop per membership change
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P2` — virtual coverage window
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P3` — genesis-anchored fallback
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P4` — suffix fallback
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P5` — facet-verification round trip
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P6` — proof requested at the exact join-block height, raised threshold completed only above it → tops out at the requested height
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P7` — A participant retaining its anchor after pruning older history can rebuild both its latest proof and anchor proof and retain replay state
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P8` — A spectator synced with the anchor as latest final stores its block, snapshot and exact full state and rebuilds a valid anchor proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P9` — A compact spectator with later finality and overlapping join evidence rebuilds its latest proof and retains the latest final state without history below the join
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P10` — After persistence-only replay above the active view, the auditor constructs its own dispute ending at its frozen height and snapshot; the newer replayed head and full state remain stored without its signature
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P11` — The same disconnected peer reconnects and progresses live; its own constructed dispute uses its latest active snapshot and the new head carries its author or confirmation signature
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P12` — An audit-verified final block above the active view, kept as proof evidence, supports an explicit-height chain-valid final proof; default construction remains bounded by the active view
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P13` — Backward search finds the latest final point and retains its unfinalized tail inside one chain-valid milestone
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P14` — A join hop whose supporting run overlaps a later final point keeps that point as a separate last milestone and the chain verifies both
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P15` — Two membership changes each retain minimum forward signer coverage; the latest fully signed head becomes a separate final milestone found backward
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P16` — When backward search finds no later final start than the preceding join milestone, construction extends that milestone through the latest block without duplicating its start
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P17` — When block n+1 supplies finality evidence for n, both full and finalized-only proofs keep n+1; snapshot preparation targets n and has update calldata
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P18` — Construction with a current mirrored anchor starts at that same anchor, retains only later final hops and verifies from the chain anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P19` — Construction with a mirror lagging the chain starts at the older genesis and still verifies from the newer canonical anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P20` — A private finalized point above genesis supplies the verification start while construction remains rooted at mirrored genesis
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P21` — Verification from a newer private final point changes neither mirror nor chain snapshot, nor subsequent proof construction rooted at their anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P22` — Missing required anchor-run blocks make construction throw; restoring the genuine blocks permits an explicit new attempt yielding the expected chain-valid run
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P24` — Loss of a required join confirmation lowers the proved final point to the preceding block and retains the join in a chain-valid unfinalized tail
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P26` — Required proof-block absence makes dispute construction throw and leaves the chain dispute window without commitments
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P27` — Required proof-block absence makes sync payload generation throw and return no replacement payload
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P29` — With required proof material present, snapshot posting sends updateStateSnapshotSameFork and the chain adopts the newer last-milestone final point
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P30` — A canonical chain walk connection failure during snapshot posting propagates and leaves the chain snapshot unchanged
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P31` — A hop consuming then removing a joiner, absent from both endpoint participant sets, is not final without that joiner; adding its signature makes SDK construction retain it and the local canonical walk verify
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P32` — An ordinary join hop retains exactly the previous/resulting participant union signatures and produces chain-valid finalized-only and tailed proofs
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P33` — Before successor anchor adoption, an empty successor proof uses its authenticated genesis at both mirror and chain tiers, never the ancestor anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P34` — Before successor anchor adoption, an unfinalized genesis-linked block-zero run uses successor genesis at both tiers and replays from index zero
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P35` — Ancestor genesis evidence supplied for a successor fork fails both mirror and chain verification
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P36` — Genuine successor genesis verifies, but substituting its origin fork causes both mirror and chain verification to fail
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P37` — Shared proof verification accepts its latest private final start without invoking mirror-anchor or chain walks
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P38` — With no private final state above the anchor, shared verification accepts the mirror walk and never invokes the chain walk
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P39` — A proof conflicting at private final height returns false there but is accepted from the mirrored anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P40` — A genesis-only lagging mirror fails to verify while the newer chain anchor establishes the same proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P41` — A mirror missing consumed inbound evidence returns false; canonical chain verification accepts
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P42` — An unlinked block causes all three tiers to return false; shared verification returns the chain invalid verdict without throwing
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P44` — A local EVM connection failure during mirror walk throws with no chain fallback
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P45` — A node RPC failure after the mirror cannot verify throws without an invalid-proof verdict
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P46` — A later joiner synced past a finalized join retains its participant-change hop, rebuilds a genesis-start proof after joining and progress, and constructs a dispute whose proof verifies on chain
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P47` — After a departure and later join, a synced peer retains both change hops, serves a rebuilt proof that synchronizes a fresh spectator to the same state, and posts a chain snapshot with the departed member absent and the joiner present
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P48` — With its mirror held behind the chain anchor, a builder produces a larger genesis-start proof accepted by chain verification and real spectator sync; after mirror release it rebuilds from the current anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P49` — A spectator synced across an unposted departure retains the departure hop and verifies reconstructed proofs before and after progress; after adopting the exit snapshot it rebuilds from that anchor without older proof blocks
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P50` — After exit-anchor adoption and explicit deletion of older blocks and snapshots, a synced spectator rebuilds and serves a verified proof, constructs a chain-verified dispute proof, then posts a newer snapshot
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P51` — A sync-only observer persists separated milestone runs supported by several-block virtual voting, leaves every gap block absent, reconstructs the same runs and constructs a chain-verified dispute proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P52` — A sync-only observer accepts overlapping compact milestones, retains matching shared-block hashes and signer sets with no gap history, and rebuilds the same chain-verified runs and a chain-verified dispute proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P53` — A peer reconstructs chain-valid proofs while synced, pending, participating and after progress, retains the finalized join hop, then rebuilds from a moved anchor and constructs a chain-verified dispute proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P54` — A former spectator now participating deletes older blocks and snapshots after anchor movement yet rebuilds and serves a verified proof, constructs a chain-verified dispute proof and posts a newer snapshot
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P55` — Before successor adoption a participant and a fresh synced spectator build chain-valid proofs from successor genesis while the chain snapshot stays on the source fork; after adoption and progress the spectator rebuilds from the successor anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P56` — A build preflight rejected by the local trusted-start walk because consumed inbound evidence is missing falls through to the canonical walk; when it accepts, construction returns a proof independently accepted by the chain view
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P57` — When both local trusted-start and canonical build preflight walks reject because consumed inbound evidence is missing, construction throws and returns no proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P58` — With block zero and one available but a required signer absent, construction returns one genesis-linked run [0,1]; the canonical walk accepts, replay begins at index zero, and the finalized snapshot remains genesis
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P59` — an exact final proof keeps later virtual votes and rejects the unfinalized support height
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P60` — a chain anchor advance during verification returns the checked start and skips malformed old history in persistence
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P61` — a mirror anchor advance during verification returns the checked start and skips malformed old history in persistence
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P62` — Exact construction at a join height is the stored proof's prefix to its join hop, verifies on chain at exactly that height without moving the view, and does not change when a stored block's sole later vote is removed
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P63` — Exact construction at an exit height is the stored proof's prefix to its exit hop, verifies on chain at exactly that height without the leaver, and does not change when a stored block's sole later confirmation is removed
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P64` — A spectator audits a real join proof above its frozen view, then constructs exactly the join point with later union votes; canonical verification accepts, the join is the only milestone, and the view stays frozen
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P65` — For an exact target after an earlier join, audit-persisted evidence above a frozen view produces both overlapping hops with their full union signatures; canonical verification ends at exactly the target and the view stays frozen
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P66` — `tryBuildStateProof` below the mirrored anchor returns no proof: this view is behind the chain, and no proof is built from history below the anchor
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P67` — A missing participant-change block above the anchor and below the stored final point leaves construction building the stored hops
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P68` — A missing tail block above the stored final point makes construction throw the missing-block error
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P69` — A missing stored snapshot of a join block below the stored final point leaves construction building the stored hops
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P70` — Snapshot posting over a missing participant-change block below the stored final point still sends the update, and the chain adopts the stored final point
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P71` — Storage that lacks a participant-change block below the stored final point leaves the local final tier walking the proof and accepting it; no later tier runs

## UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX

Reduction inbound evidence

- Setup: Build reduce data with a complete store, a dropped recoverable event, an unrecoverable range, a reduced head the node never received, and a reduced head whose snapshot the node stored without its state
- Oracle: Complete data passes; chain recovery restores dropped events; exhaustion or an unheld reduced head returns unavailable before local reduction, never a throw

- [ ] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P1` — complete local range
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P2` — missing event recovered from chain
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P3` — recovery exhaustion returns unavailable for retry
- [x] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P4` — a non-genesis reduced head whose snapshot the node never received returns unavailable for retry, not a throw
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P5` — a non-genesis reduced head whose snapshot the node stored without its state (a verified proof hop) returns unavailable for retry, not a throw

## UNIT-TEST-AGREEMENT-MANAGER-3-ZBC869

A failed recovery of a genesis-hop inbound run is remembered per fork and upper inbound hash, so later signer-admission checks of the same hop do not rescan chain logs.

- Setup: A spectator that holds no inbound run below its synced point and cannot fetch one; stored-block merges whose copies add stray never-member signatures; a chain-log query counter. For the fork and bound cases: a never-member signature on the block at a peer's local final point, judged against hop ends whose upper inbound hash names a run the chain never held, on the disputed fork and its successor
- Oracle: Each stray signature is stripped and the copy is `DUPLICATE`; the chain-log query count after the second merge equals the count after the first; a remembered miss is judged without a chain-log query; the same upper hash on another fork is queried, and that fork's miss makes the first fork query again; after 257 misses the oldest is queried again and the second oldest is not

- [x] `UNIT-TEST-AGREEMENT-MANAGER-3-ZBC869.P1` — a second never-member signer of the same stored block after the genesis hop's recovery failed: no new chain-log scan
- [x] `UNIT-TEST-AGREEMENT-MANAGER-3-ZBC869.P2` — after a fork change, the same hop's recovery scans the chain logs again
- [x] `UNIT-TEST-AGREEMENT-MANAGER-3-ZBC869.P3` — past 256 remembered misses, the oldest is forgotten and its hop is scanned again

## UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB

The stored proof is written only by the own advance, the sync install, the re-root and the reset, and a write never replaces a later stored final point.

- Setup: A spectator that holds its own earlier final point syncs to a later served final point, to the final point it already stores, and with its held install interrupted by a conflicting block or by a stored-proof change; a pending auditor audits a dispute above its own final point; an advance of the old fork runs after a fork change; a peer loses its stored block at its stored final point; a peer's stored proof is re-rooted directly at the held snapshot below its final point; a peer stores a reduced fork's genesis built from its block 1 state and resets its stored proof there
- Oracle: The stored proof read back through `getLocalFinalizedSnapshot` and the `Type.StoredProof` encoding of the record; the install state; the sync result's rejections and blacklist flag; the proof built over the stored final point

- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P1` — a sync to a later final point stores the served final point with its state
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P2` — a sync to the final point already stored leaves the stored proof unchanged
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P3` — an install that aborts on a conflict after the staging publishes neither the state nor the staged proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P4` — an install whose stored proof changed after the staging aborts and writes neither the state nor the staged proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P5` — an audit that verifies a later final point than the auditor's own leaves the stored proof unchanged
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P6` — an advance of the old fork after a fork change writes nothing and keeps the new fork's stored proof
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P7` — a stored block dropped at the stored final point leaves the final point and the proof built over it unchanged
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P8` — a re-root at a snapshot below the final point moves the anchor there and keeps the hop above it and the final point with its state
- [x] `UNIT-TEST-AGREEMENT-MANAGER-4-GFM6GB.P9` — a reset at a genesis of a fork with no stored proof makes that genesis, with its state and no hop, the stored proof and drops the old fork's

## UNIT-TEST-AGREEMENT-MANAGER-5-3PCACH

The final points a conflict counter rests on: the stored proof's own points, and audit evidence points only at heights where the stored proof has none, from records that agree with it.

- Setup: A factory-built stored proof installed as the peer's stored proof, and factory-built audit evidence records that share its hops, add a hop above them, or hold other snapshots at its final heights
- Oracle: The heights and snapshot hashes that `getEvidenceFinalPoints` returns, against the hops the factory built

- [x] `UNIT-TEST-AGREEMENT-MANAGER-5-3PCACH.P1` — an agreeing record's points at the stored proof's own heights are not returned; its point above them is
- [x] `UNIT-TEST-AGREEMENT-MANAGER-5-3PCACH.P2` — a record with another snapshot at one of the stored proof's heights adds no point; an agreeing record still adds its point
