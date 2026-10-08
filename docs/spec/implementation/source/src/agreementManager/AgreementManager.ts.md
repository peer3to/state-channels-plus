# AgreementManager.ts

> **Source:** [src/agreementManager/AgreementManager.ts](../../../../../../src/agreementManager/AgreementManager.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-FIN-3-9P9J4Q` (A signature on block B is also an indirect vote for every ancestor of B on the…)](../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q)
- [`REQ-SP-1-9YABY1` (A milestone normally proves its first block final, directly or through…)](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
- [`REQ-SP-2-ST4JJ4` (Proofs connect the trusted start through required final membership hops to the…)](../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
- [`REQ-SP-3-SP1JG4` (A membership hop requires signatures from the union of the previous…)](../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)
- [`REQ-MIRROR-3-THD7K8` (Cache, never authority)](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8)
- [`REQ-SP-8-9ZCCEJ` (Construct proofs from the mirrored chain anchor, which may lag the chain but…)](../../../../specification/disputes/state-proofs.md#req-sp-8-9zccej)
- [`REQ-SP-9-RNXP56` (Both synchronization and dispute audit try the peer's latest finalized state,…)](../../../../specification/disputes/state-proofs.md#req-sp-9-rnxp56)
- [`REQ-SP-10-JMVHTB` (After successful synchronization, persist the verified start and retained…)](../../../../specification/disputes/state-proofs.md#req-sp-10-jmvhtb)
  Contradicts: `persistVerifiedProof` can retain unexecuted proof support that contaminates installed history ([`FIND-PROOF-PERSISTENCE-1-HYC9DS`](../../../../audit/open-findings.md#find-proof-persistence-1-hyc9ds)).
- [`REQ-IX-4-BB35GC`](../../../../specification/disputes/README.md#req-ix-4-bb35gc)
- [`REQ-FIN-7-RTZWQZ` (The threshold is unanimous over the _relevant participant set_)](../../../../specification/protocol-model/finality.md#req-fin-7-rtzwqz)
- [`REQ-FIN-4-ZFDDS6` (Consequently, in a channel with N participants, N consecutive blocks authored…)](../../../../specification/protocol-model/finality.md#req-fin-4-zfdds6)

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
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P12` — An audit-stored final block above the active view supports an explicit-height chain-valid final proof; default construction remains bounded by the active view
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
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P23` — A missing participant-change block above the anchor makes construction throw instead of skipping its hop
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P24` — Loss of a required join confirmation lowers the proved final point to the preceding block and retains the join in a chain-valid unfinalized tail
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P25` — A missing stored snapshot for a required participant-change block makes construction throw instead of skipping the hop
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P26` — Required proof-block absence makes dispute construction throw and leaves the chain dispute window without commitments
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P27` — Required proof-block absence makes sync payload generation throw and return no replacement payload
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P28` — Missing required participant-change block makes snapshot posting throw before any recorded multicall; the chain anchor stays unchanged
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
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P43` — Missing required participant-change storage while obtaining the local final start throws and no later proof tier runs
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
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P62` — Exact construction at a join height keeps later linked union votes, verifies on chain at exactly that height without moving the view, and returns no proof after the sole required later confirmation is removed
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P63` — Exact construction at an exit height retains the departing and remaining union signatures through a later linked block, verifies on chain at exactly that height without moving the view, and returns no proof after the sole required later confirmation is removed
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P64` — A spectator audits a real join proof above its frozen view, then constructs exactly the join point with later union votes; canonical verification accepts, the join is the only milestone, and the view stays frozen
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P65` — For an exact target after an earlier join, audit-persisted evidence above a frozen view produces both overlapping hops with their full union signatures; canonical verification ends at exactly the target and the view stays frozen

## UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX

Reduction inbound evidence

- Setup: Build reduce data with a complete store, a dropped recoverable event, and an unrecoverable range
- Oracle: Complete data passes; chain recovery restores dropped events; exhaustion returns unavailable before local reduction

- [ ] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P1` — complete local range
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P2` — missing event recovered from chain
- [ ] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P3` — recovery exhaustion returns unavailable for retry
