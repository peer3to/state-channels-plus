# DisputeValidationService.ts

> **Source:** [src/stateManager/dispute/DisputeValidationService.ts](../../../../../../../src/stateManager/dispute/DisputeValidationService.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`INV-DISPUTE-PIPE-1-BN0K81` (Equivalent audit)](../../../../../specification/disputes/dispute-processing.md#inv-dispute-pipe-1-bn0k81)
- [`REQ-DISPUTE-PIPE-2-MJRJV1` (Ordered complete verification)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1)
- [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)
- [`REQ-SP-9-RNXP56` (Both synchronization and dispute audit try the peer's latest finalized state,…)](../../../../../specification/disputes/state-proofs.md#req-sp-9-rnxp56)
  Contradicts: audit replay can run over history contaminated by retained, unexecuted proof support and produce an unsupported accusation ([`FIND-PROOF-PERSISTENCE-1-HYC9DS`](../../../../../audit/open-findings.md#find-proof-persistence-1-hyc9ds)).

## UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09

Audit order and evidence

- Setup: Corrupt each check alone; serve unavailable required evidence; force local/chain predicate divergence; drive the preflight
- Oracle: First counterable failure stores exactly one proof; missing or false local verification advances tiers; required-state failures throw; canonical logic decides; preflight blocks self-slash

- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P1` — inbound-tip reality check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P3` — invalid-without-proof throws
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P4` — preflight rejection
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P5` — chain re-check on staleness-sensitive checks
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P6` — proof-decode check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P7` — header-match check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P8` — block-structure check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P9` — posted-data verification check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P10` — suffix-replay check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P11` — latest-state consistency check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P12` — slash-subset check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P13` — balance-invariant check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P14` — disputer-latest-state check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P15` — timeout-not-linked check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P16` — timeout-participant-not-next check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P17` — timeout-too-early check failure
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P18` — timeout-threshold check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P19` — timeout-calldata-posted check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P20` — stated-reason check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P21` — output-correctness check failure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P23` — true flag alone supplies a reason: valid state audits successfully without a fraud proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P24` — Audit with no local final state accepts the local mirror and performs no chain walk
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P25` — Audit with missing mirrored consumed inbound evidence accepts the canonical chain proof without a counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P26` — Audit from a genesis-only mirror falls through to a newer chain anchor and accepts
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P27` — Local executor failure during audit propagates; no chain walk or counter is produced
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P28` — Local contract revert during audit propagates; no chain walk or counter is produced
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P29` — Malformed retained tail with posted auditing data produces an invalid-proof counter without crashing
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P30` — Malformed retained tail with permitted omitted data produces an invalid-proof counter without crashing
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P31` — Malformed inner block in a wholly skipped milestone is not checked and does not invalidate audit
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P32` — Replay failing below the chain anchor restarts from the verified anchor state and accepts without accusation
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P33` — A fault after the chain anchor is accused only by the canonical replay, at its actual position
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P34` — An authentic block conflicting with the local final point stores the final-conflict counter before any normal tier walk
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P35` — A participant audit missing a valid tail accepts after replay, stores the tail head block and full latest application state, and stores no counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P36` — A pending auditor missing a tail accepts after replay and stores its head block, committed snapshot and full latest application state with no counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P37` — A peer frozen by its own dispute audits and stores a higher replay chain with its snapshots and full states, adds no own confirmation or active-view advance, keeps its own constructed dispute at the frozen commitment, and resolves using the higher state
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P38` — A pending auditor with no conflicting final block and no required anchor state throws on an otherwise real anchored history without storing any counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P39` — A participant dispute missing required last-milestone signature and posted data is rejected with exactly the missing-auditing-data counter before any local or chain milestone verification, despite a later bogus slash fault
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P40` — A pending-participant dispute missing required signature and posted data is rejected with exactly the missing-auditing-data counter before local or chain milestone verification, despite a later bogus slash fault
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P41` — A dispute with required posted auditing data but a forged output snapshot-data hash is rejected with exactly DisputeInvalidOutputState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P42` — An omitted-data dispute claiming a final point below a newer real chain anchor is rejected with the below-anchor counter without milestone verification after its old block and state snapshot are pruned
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P43` — A posted-data dispute below a newer real chain anchor is rejected with the below-anchor counter without milestone verification after its old state snapshot is pruned
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P44` — A compact-synced pending auditor lacking the older application state rejects an older dispute with DisputeNotLatestState carrying a later block, and leaves the old state absent
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P45` — A compact-synced auditor missing older application state accepts a current dispute and stores no counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P46` — A late pending auditor without the departure application state accepts an eligible leaver's last-signed dispute, stores no counter, leaves old state absent and constructs its own proof above the departure height
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P47` — A late pending auditor accepts an older pending-participant dispute using a trusted start, performs no local or chain balance check, leaves old application state absent and submits exactly one newer dispute committed on-chain
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P48` — The late auditor responds to an older pending-participant dispute with a newer on-chain commitment in posted-auditing-data form when the last run lacks that pending participant signature and chain omission permission is false
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P49` — A late pending auditor accepts an eligible departed submitter's older dispute using a trusted start without local or chain balance checks or recovery of departure state, then submits exactly one newer committed dispute
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P50` — A pending auditor lacking anchor application state rejects a colluding fork with exactly the final-state-conflict counter before normal local or chain proof tiers; the chain predicate validates a different snapshot at the final proof's exact height
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P51` — A chain-eligible departed submitter falsely timing out a produced directly confirmed next block is rejected with TimeoutThreshold; restoring the designated killer leads to her on-chain slash although her latest signed point remains departure
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P52` — A late pending auditor with finality at the wrong-author timeout target or later, no departure state and no accused calldata creates exactly TimeoutSupersededByFinalState, and its same-fork final proof satisfies the chain predicate
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P53` — An honest timeout whose target is above the auditor's latest final point remains audit-valid with zero stored fraud proofs
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P54` — When the auditor also holds a fully signed block at the accused height, finality at that height still selects only TimeoutSupersededByFinalState for a wrong-author timeout
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P55` — A posted dispute forging a consumed join out of its final snapshot and signatures is rejected with a milestone-level InvalidStateProof counter at the last milestone; the chain step predicate agrees and the full dispute proof is rejected
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P56` — The consumed joiner can reject a forged hop omitting its membership and signature without the preceding application state; it stores InvalidStateProof against the submitter, and the chain step predicate agrees
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P57` — An honest consumed join in an unfinalized last-milestone tail with posted auditing data is accepted without any stored fraud proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P58` — A transport exception from the local verification read during a committed dispute audit propagates as a fatal error, performs no canonical verification read, stores no fraud proof, submits no kill or dispute, and leaves the original commitment present
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P59` — When an auditor lacks the full state at its finalized replay base and the higher dispute posts no auditing data, audit fails fatally without a fraud proof, kill or dispute upload and keeps its active next height
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P60` — When an auditor behind a newly finalized block lacks its required milestone snapshot and the dispute posts no auditing data, evidence construction fails fatally without an unsupported fraud proof, kill or dispute upload
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P61` — For an inserted above-anchor hop lacking required confirmations, the earlier-start auditor kills with exactly InvalidStateProof and is not slashed, while newer-start auditors confirm the same dispute and store no counters
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P62` — For an inserted earlier retained run skipping an intermediate height, the earlier-start auditor kills with exactly InvalidStateProof and is not slashed, while newer-start auditors confirm the same dispute and store no counters
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P63` — For a posted earlier-milestone snapshot row substituted with the final head snapshot, the earlier-start auditor kills with exactly InvalidStateProof and is not slashed, while newer-start auditors confirm the same dispute and store no counters
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P64` — A forged resulting snapshot in a manual InvalidStateProof challenge against an honest omitted-data dispute slashes the challenger, leaves the submitter unslashed and preserves its commitment
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P65` — A malformed milestone wholly below the chain anchor is skipped: auditors confirm the dispute, retain their original below-anchor block, never store the forged block and do not slash the submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P66` — A skipped malformed prefix does not suppress latest-state balance validation: the blind pending auditor kills the forged-total dispute with exactly the balance counter, then kills the colluders' real-head disputes with final-state-conflict counters; only the colluders are slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P67` — Omitted-data proof with undecodable newest block bytes after its anchor is killed by an auditor applying exactly InvalidStateProof; submitter is slashed and its commitment removed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P68` — Omitted-data proof with an unrecoverable extra confirmation signature on its unfinalized after-anchor block is killed with exactly InvalidStateProof, removes its commitment and slashes submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P69` — Omitted-data proof with undecodable middle bytes in an earlier retained run is killed with exactly InvalidStateProof at milestone zero, block one, despite a decodable last-run head
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P70` — Posted-data proof with an unrecoverable confirmation signature is killed by an honest auditor using only InvalidStateProof, and the submitter is slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P71` — With omitted data, an undecodable block before a retained foreign-fork tail does not prevent an auditor killing with exactly HeaderMismatch and slashing the submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P72` — With posted data, an undecodable block before a retained foreign-fork tail does not prevent an auditor killing with exactly HeaderMismatch and slashing the submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P73` — A posted-data proof with an undecodable first milestone is killed by an auditor applying only InvalidStateProof and slashing submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P74` — An omitted-data older-state claim with malformed skipped below-anchor history is killed with exactly NotLatestState and slashes submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P75` — A posted-data older-state claim with malformed skipped below-anchor history is killed with exactly NotLatestState and slashes submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P76` — An omitted-data last run containing undecodable bytes before its interior chain anchor is confirmed by every listed auditor with no stored counter and no submitter slash; the channel resolves
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P77` — After a forged final head and correctly replayable tail, a blind pending auditor applies only the balance counter over the tail snapshot, not the head; no transition counter is stored, and later final-conflict counters kill the real-head colluder disputes
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P78` — A blind pending auditor confirms the real final head and correct tail using required posted data before gossip restoration; all listed auditors then confirm, store no counter and do not slash the self-removing submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P79` — A participant initially holding only the anchor height accepts an omitted-data dispute spanning the anchor and unfinalized tail, obtains latest snapshot and application state, and stores no counter despite a pending signer absent from the first block
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P80` — A pending participant initially holding only anchor height accepts an omitted-data anchored tail, persists latest snapshot and application state, stores no counter and remains pending
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P81` — With last-run head above the chain anchor and signatures from every required peer including pending joiner, chain omission permission is true; blind participant and pending auditor accept and recover the latest tail state from their own final head
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P82` — When a participant never signed, an omitted-data dispute with a later state fault is killed by an honest auditor applying only the missing-auditing-data counter, slashing its submitter; auditors store no InvalidStateProof counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P83` — When a forced pending joiner never signed, an omitted-data dispute with a later state fault is killed by an honest auditor applying only the availability counter, slashing submitter, with no stored InvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P84` — When a pending signer makes omission impermissible, auditors accept the posted-data dispute; a direct copy marked unposted instead returns the availability counter, while normal resolution slashes the original block offender
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P85` — A blind pending auditor kills a posted forged-total final snapshot using only InvalidBalanceInvariant, then kills the colluders' real-head disputes using final-state-conflict counters; the final slash set contains exactly those colluders
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P86` — A lagging-mirror auditor reaches local and chain proof tiers, stores the same after-anchor transition-counter index one as a current auditor, and the dispute is killed with only submitter slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P87` — With chain anchor at index two inside the last run, lagging and current auditors both store the tail transition counter at original index three; a kill lands and only submitter is slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P88` — For a nonauthentic block immediately after an interior anchor, the lagging auditor stores the structure counter at original index three, the dispute is killed and only submitter is slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P89` — A forged below-chain-anchor block followed by an honest retained tail reaches both local and chain tiers; through kill expiry auditors store no counters, observe no kill and nobody is slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P90` — A forged below-anchor prefix does not hide an invalid transition two blocks after the anchor: lagging auditor stores the tail transition counter at original index four, a kill lands and only submitter is slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P91` — A proof ending at the chain anchor with a forged block below it reaches both local and chain tiers but remains without counters, kills or slashes through kill expiry
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P92` — After the same forged below-anchor history, a genuine invalid transition immediately after the chain cutoff produces original index-three transition evidence; a kill lands and only submitter is slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P93` — A pending joiner lacking the real predecessor block, snapshot and application state kills a posted hop that consumes its join without its signature; applied InvalidStateProof points at milestone zero without block index, only submitter is slashed, and predecessor holdings remain absent
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P94` — Placing the omitted-joiner hop after an anchor-holding first milestone produces the pending auditor's actual InvalidStateProof kill at milestone one without block index, and only submitter is slashed
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P95` — An empty milestone proof claiming a random latest-state hash in an omitted-data dispute produces stored InvalidStateProof, an observed kill and eventual channel resolution; honest replacement is held until kill observation
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P96` — A proof independently checked to establish finality beyond its chain start, then assigned a random latest-state hash, is killed in omitted-data mode with stored InvalidStateProof and resolution after a delayed honest replacement
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P97` — A disconnected auditor observes the kill of an omitted-data random-hash dispute whose proof establishes finality beyond its chain start; honest peers store InvalidStateProof and resolve the fork
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P98` — An empty milestone proof claiming a random latest-state hash with posted auditing data produces stored InvalidStateProof, an observed kill and channel resolution with a synthetic pending participant
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P99` — A posted-data dispute whose latest-state hash is changed to a random value produces stored InvalidStateProof, a kill observation and eventual resolution
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P100` — After departure and later advancement, a disconnected auditor missing a newer block observes the kill of a posted nonempty-proof dispute with a random latest-state hash; stored InvalidStateProof and resolution follow
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P101` — With a proof checked to have no final point beyond its chain start, a posted random latest-state hash yields stored InvalidStateProof, kill observation at peer zero and channel resolution
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P102` — With a proof checked unfinalized and a participant disconnected during staging, a posted random latest-state hash yields stored InvalidStateProof, kill observation at that disconnected peer and resolution
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P103` — A disconnected auditor's proof-confirmation work is held while its fork gossip queue is cleared, then released; a posted unfinalized-proof dispute with random latest-state hash still yields stored InvalidStateProof, observed kill and channel resolution
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P104` — Audit accepts from its known local final point, produces no counter, and calls neither mirror-anchor nor chain walk
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P105` — Substituting block-one snapshot for the posted block-zero milestone snapshot makes audit reject with InvalidStateProof after one mirror walk and one chain walk
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P106` — A missing participant-change block required to establish the local final point makes audit throw before any mirror-anchor or chain walk and produce no counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P107` — After the local mirror cannot establish a consumed-inbound hop, a chain transport failure makes audit throw with no counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P108` — An unproven prefix below the local final point is skipped: trusted-start walk accepts without mirror-anchor or chain walk and without counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P109` — An unproven prefix above the genesis trusted start produces InvalidStateProof pointing inside that prefix without a block index; canonical step verification accepts it, and the auditor kills the dispute and slashes submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P110` — When no tier can supply a forged hop snapshot, the auditor holds no block at that height and auditing data is omitted, audit throws for missing milestone snapshots without a counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P111` — A forged hop conflicting with a held final block is countered at milestone zero/block zero without a mirror-anchor or chain walk; the auditor kills the dispute with ConflictsWithFinalState and slashes submitter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P112` — After an honest proof is accepted without mirror-anchor or chain walk, replacing its latest snapshot hash with an earlier real snapshot makes audit return InvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P113` — After posted-data audit succeeds without mirror-anchor or chain walk, omitting data from a dispute requiring it produces LastMilestoneNotFinalAndNoAuditingData
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P114` — A dispute listing an unslashed address produces OnChainSlashesNotSubset without mirror-anchor or chain proof walks
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P115` — Posted auditing data replaces the latest snapshot with an earlier real snapshot; audit rejects with InvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P116` — An empty genesis proof names a later real snapshot as latest; audit rejects with InvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P117` — Posted data names a latest snapshot whose application-state hash is substituted from another state; audit rejects with InvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P118` — An empty genesis proof names a genesis snapshot with an application-state hash from another state; audit rejects with InvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P119` — A pending auditor lacking the proved final state accepts verified posted state bytes, produces no counter, and holds full state by the expected hashes at both replay base and hop after audit
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P120` — Posted finalized-state bytes with the wrong hash are not installed; when the required real replay state is absent, audit throws without a counter and the base state remains absent
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P121` — A missed tail with another participant’s real signature substituted for its author signature returns InvalidBlockStructure and stores none of the tail blocks
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P122` — An unrecoverable confirmation signature in the last milestone’s first block returns InvalidStateProof and stores none of the missed tail blocks
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P123` — With preanchor blocks pruned, current-anchor and genesis-start mirrors both counter the postanchor fault at last-milestone index one; chain eligibility excludes anchor and past-run indices
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P124` — A genesis-linked last milestone containing an invalid preanchor block is accepted by current and lagging auditors without counters; only the lagging auditor needs the canonical chain tier, and every supplied block is challenge-ineligible
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P125` — With the anchor inside a milestone containing both a preanchor invalid block and postanchor fault, both current and lagging auditors counter only the postanchor fault at its actual index; anchor and past-run indices are ineligible
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P126` — Appending a copy with its author signature replaced by a confirmation signature after the protected head produces DisputeInvalidBlockStructure at original last-milestone index one
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P127` — A foreign-fork header on the eligible last-milestone tail yields local and chain mismatch answers and stores DisputeStateProofHeaderMismatch
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P128` — A pending auditor first retains a threshold-final forged-balance head: its dispute is killed by the balance counter, the colluders’ conflicting real-head disputes are killed by final conflict, all colluders are slashed, and reduction uses only the auditor’s own dispute
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P129` — A pending auditor first retains the real final head, then receives a conflicting forged-balance head: final conflict kills the forged dispute, only its submitter is slashed, and the channel resolves
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P130` — Concurrent audits reach persistence with the forged-balance head first: only that head is stored, its dispute is killed by the balance counter, both conflicting real-head disputes are killed by final conflict, and reduction uses only the honest auditor’s own dispute
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P131` — Concurrent audits reach persistence with the real head first: only that head is stored, the forged-head audit is countered after its walk, only the forged submitter is slashed, and the real-head disputes reduce
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P132` — Participants already holding the real final block audit a conflicting forged-balance head: final conflict kills the forged dispute, its submitter is slashed, and the channel resolves

## UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D

Snapshot source and genesis balances

- Setup: Audit posted and missing pinned snapshots; audit honest and altered nonzero genesis deposits
- Oracle: Committed snapshot data is authenticated; required missing local state throws; the balance invariant rejects altered totals

- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P1` — posted pinned snapshot with a behind inbound anchor creates the matching fraud proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P3` — honest nonzero genesis deposits pass the balance invariant
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P4` — tampered nonzero genesis deposits fail the balance invariant

## UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS

Exhaustive dispute audit, persistence, timeout, and snapshot-hash paths

- Setup: Drive the public validation and persistence entries through real channel history, corrupted inputs, stale observers, chain reads, and replay races
- Oracle: Each declaration observes the exact verdict, proof, failure, persistence, timeout, or race result without hiding the file from verification inventory

- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P1` — Unit: DisputeValidationService > inbound hash > dispute.input.latestInboundMessageBlockHash = random -> false + DisputeInboundHashNotInChain
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P2` — Unit: DisputeValidationService > state proof decode > milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData false -> false + DisputeLastMilestoneNotFinalAndNoAuditingData
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P4` — Unit: DisputeValidationService > header + structure > milestones[-1].blockConfirmations[-1] header.channelId = random -> false + DisputeStateProofHeaderMismatch
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P5` — Unit: DisputeValidationService > header + structure > milestones[-1].blockConfirmations[-1] header.forkId = random -> false + DisputeStateProofHeaderMismatch
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P7` — Unit: DisputeValidationService > other checks > dispute.input.latestStateSnapshotHash = random -> false + DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P8` — Unit: DisputeValidationService > other checks > dispute.input.onChainSlashes += unslashed address -> false + DisputeOnChainSlashesNotSubset
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P9` — Unit: DisputeValidationService > other checks > stateProof truncated below the disputer's latest signed block -> false + DisputeNotLatestState carrying that block
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P10` — Unit: DisputeValidationService > other checks > disputer's latest signed height == latestStateSnapshot.blockHeight -> not flagged, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P11` — Unit: DisputeValidationService > other checks > untampered dispute over real history -> true, no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P12` — Unit: DisputeValidationService > posted auditing data > milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData true -> false + DisputeInvalidStateProof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P13` — Unit: DisputeValidationService > posted auditing data > postedAuditingData true + matching auditingData -> verifyStateProof accepts, true
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P14` — Unit: DisputeValidationService > posted auditing data > auditingData.latestStateSnapshot.timestamp += 1 (breaks disputeAuditingDataHash) -> false + DisputeInvalidStateProof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P15` — Unit: DisputeValidationService > posted auditing data > dispute.postedAuditingData = false on an unfinalized head -> false + DisputeLastMilestoneNotFinalAndNoAuditingData
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P16` — Unit: DisputeValidationService > posted auditing data > auditingData.latestStateSnapshot.snapshotData.totalDeposits.amount += 1 -> false + DisputeInvalidBalanceInvariant
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P17` — Unit: DisputeValidationService > posted auditing data > auditingData.inboundMessageBlocks nonempty (real join) -> chain verified, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P18` — Unit: DisputeValidationService > posted auditing data > dispute.input.lastInboundMessageBlockHeight = an earlier real inbound block below snapshotData.latestInboundMessageBlockHeight -> false + DisputeInboundAnchorBehindLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P19` — Unit: DisputeValidationService > posted auditing data > dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight = 0 -> false + DisputeInboundAnchorBehindLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P20` — Unit: DisputeValidationService > posted auditing data > the same ZeroHash + height 0 pair on the posted-auditing-data path -> false + DisputeInboundAnchorBehindLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P21` — Unit: DisputeValidationService > milestone finality + state proof anchor > dispute.input.latestInboundMessageBlockHash = pre-join head -> joiner still holds milestones[-1].blockConfirmations[0], audits it
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P24` — Unit: DisputeValidationService > milestone finality + state proof anchor > inbound run the auditor does not hold > settled path, recoverable gap -> full audit, zero proofs, the run is now held
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P26` — Unit: DisputeValidationService > milestone finality + state proof anchor > stateProof.milestones = [] -> stored genesis snapshot + forkId == snapshotDataHash, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P29` — Unit: DisputeValidationService > milestone finality + state proof anchor > localDiamond.isDisputeInboundHashValid false + RPC true -> no DisputeInboundHashNotInChain
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P31` — Unit: DisputeValidationService > pipeline > onBlockConfirmationStruct false with an empty disputeFraudProofs store -> throw
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P32` — Unit: DisputeValidationService > dispute output > dispute.outputSnapshotDataHash = random -> false + DisputeInvalidOutputState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P33` — Unit: DisputeValidationService > dispute output > timeout.participant = 0 AND onChainSlashes = [] AND selfRemoval false -> false + InvalidDisputeReason
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P34` — Unit: DisputeValidationService > replay > same invalid dispute audited twice -> false both times, disputeFraudProofs stays at 1
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P44` — Unit: DisputeValidationService > timeout checks > dispute.input.timeout.blockHeight += 1 -> false + TimeoutNotLinkedToLatestState
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P45` — Unit: DisputeValidationService > timeout checks > dispute.input.timeout.participant = a peer that is not next to write -> false + TimeoutParticipantNotNext
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P46` — Unit: DisputeValidationService > timeout checks > window creation timestamp >= previous block timestamp + timeoutWaitTime -> timeout checks pass, true
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P47` — Unit: DisputeValidationService > timeout checks > window creation timestamp < previous block timestamp + timeoutWaitTime -> false + TimeoutTooEarly
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P48` — Unit: DisputeValidationService > timeout checks > window creation timestamp == previous block timestamp + timeoutWaitTime -> accepted
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P49` — Unit: DisputeValidationService > timeout checks > timeout.participantSignatureOnPreviousBlock: 0x / timed-out signer / other signer -> TimeoutTooEarly, none, TimeoutTooEarly
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P50` — Unit: DisputeValidationService > timeout checks > block at timeout.blockHeight signed by every participant -> false + TimeoutThreshold
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P51` — Unit: DisputeValidationService > timeout checks > timeout.blockHeight = a block whose calldata is on-chain, isForced true -> false + TimeoutCalldataPosted
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P52` — Unit: DisputeValidationService > timeout checks > stale local previousBlockCalldata -> validateTimeoutCalldataPostedProof false, audit continues without TimeoutCalldataPosted
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P53` — Unit: DisputeValidationService > timeout checks > timeout dispute audited before the window reaches the local chain view -> throw
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P54` — Unit: DisputeValidationService > race > fork advances while the audit is parked at getOnChainSlashedParticipants -> false + DisputeNotLatestState
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P55` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (1) stateProof empty — genesis (no milestones) > all peers are in sync > [no calldata] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P56` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (3) stateProof.milestones only — last milestone block commits to hash > all peers are in sync > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P57` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (3) stateProof.milestones only — last milestone block commits to hash > auditor peer 3 disconnected — local storage stale, pipeline still kills > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 3)
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P60` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (1) stateProof empty — genesis (no milestones) > all peers are in sync > [calldata posted] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P61` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (3) stateProof.milestones only — last milestone block commits to hash > all peers are in sync > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P62` — E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (3) stateProof.milestones only — last milestone block commits to hash > peers not synced — auditor peer 1 disconnected (misses latest block) > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 1)
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P64` — an unfinalized block whose bytes do not decode, replayed with an invalid state-proof structure, makes the audit return false with exactly one `DisputeInvalidBlockStructure` proof and no throw
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P65` — A final point at height 2 needs votes from height 3. The audit builds a counter that verifies at height 2, then its real upload is killed on chain by that counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P66` — an audit retains virtual votes above a frozen view for a later final-conflict counter
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P67` — concurrent virtual-final audits keep the real proof first and counter the conflicting proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P68` — concurrent virtual-final audits keep the forged proof first and counter the conflicting proof

## UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ

Inbound availability during dispute audit

- Setup: Real multi-peer disputes with dropped delivery, held handlers, final disputes or empty posted runs
- Oracle: Recovered evidence permits audit without a false proof; deferred final reduction resumes after event release and selects the final dispute fork.

- [x] `UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P1` — recoverable inbound log → the auditor recovers it, audits for real and converges
- [x] `UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P3` — final dispute over an unrecoverable gap → reduction deferred, then settles on the final dispute's fork
- [x] `UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P4` — posted auditing data with an emptied inbound run → the auditor still rebuilds locally, nobody is slashed

## UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X

Local-first audit predicates

- Setup: `validateDispute` on a real auditor for each local-first read (last milestone final by everyone, correct latest state, balance invariant, state proof, timeout-calldata-posted preflight) and for the pure header check; the local diamond and the chain manager are made to disagree with real state (a lagging mirror or store, a chain view served before an event) or with forged dispute input, the local read is made to revert in the EVM or to fail outside it, and the chain read is made to revert or to fail for transport; local and chain reads are observed record-only
- Oracle: For state-proof verification, completed false local results try the next tier. Other local-first audit predicates confirm the answer that would accuse the submitter; timeout-calldata preflight accepts local false and confirms local true. Thrown execution or RPC failures propagate fatally, without becoming proof verdicts.

- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P1` — last milestone: local "final" is kept with no chain read and no `DisputeLastMilestoneNotFinalAndNoAuditingData` proof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P2` — last milestone: local "not final", chain "not final": one chain read, then `DisputeLastMilestoneNotFinalAndNoAuditingData` is stored
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P3` — latest state: local "incorrect", chain "correct": the chain answer wins and no `DisputeInvalidStateProof` is stored for the latest-state check
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P4` — balance invariant: local "invalid", chain "invalid": one chain read, then `DisputeInvalidBalanceInvariant` is stored
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P5` — state proof: local "invalid", chain "valid": the chain answer wins and no `DisputeInvalidStateProof` is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P7` — timeout-calldata-posted preflight: local "invalid" is kept with no chain read and no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P8` — timeout-calldata-posted preflight: local "valid", chain "invalid": no proof is stored and the audit returns valid
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P10` — last milestone: the local read fails outside the EVM: the audit throws that error, with no chain read and no proof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P11` — last milestone: local "not final", chain "final" (the chain view has not seen a join): the chain answer wins and no `DisputeLastMilestoneNotFinalAndNoAuditingData` is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P12` — latest state: local "correct" is kept with no chain read and no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P13` — latest state: local "incorrect", chain "incorrect": one chain read, then `DisputeInvalidStateProof` is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P15` — latest state: the local read fails outside the EVM: the audit throws that error, with no chain read and no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P16` — balance invariant: local "valid" is kept with no chain read and no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P17` — balance invariant: local "invalid" (the mirror misses a consumed top-up), chain "valid": the chain answer wins and no proof is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P19` — balance invariant: the local read fails outside the EVM: the audit throws that error, with no chain read and no proof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P20` — state proof: local "valid" is kept with no chain read and no proof
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P21` — state proof: local "invalid", chain "invalid" (the chain returns false): one chain read, then `DisputeInvalidStateProof` is stored
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P24` — state proof: local "invalid", the chain read fails for transport (not `CALL_EXCEPTION`): the audit throws and no proof is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P25` — timeout-calldata-posted preflight: local "valid", chain "valid": one chain read, then `TimeoutCalldataPosted` is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P27` — timeout-calldata-posted preflight: the local read fails outside the EVM: the audit throws that error, with no chain read and no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P28` — timeout-calldata-posted preflight: local "valid", the chain read fails for transport: the audit throws and no proof is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P29` — proof header: a local "no mismatch" continues the audit with no chain read
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P30` — last milestone: local "not final", the chain read fails for transport: the audit throws and no proof is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P31` — latest state: local "incorrect", the chain read fails for transport: the audit throws and no proof is stored
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P32` — balance invariant: local "invalid", the chain read fails for transport: the audit throws and no proof is stored
- [ ] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P33` — state proof: the local read fails outside the EVM: the audit throws that error, with no chain read and no proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P34` — the auditing-data omission predicate reverts locally during an audit: the error propagates without a chain read, verdict, or fraud proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P35` — the latest-state correctness predicate reverts locally during an audit: the error propagates without a chain read, verdict, or fraud proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P36` — the balance-invariant predicate reverts locally during an audit: the error propagates without a chain read, verdict, or fraud proof
- [x] `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-4-E7PE6X.P37` — the timeout-calldata predicate reverts locally during an audit: the error propagates without a chain read, verdict, or fraud proof
