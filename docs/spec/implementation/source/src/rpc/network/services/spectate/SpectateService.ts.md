# SpectateService.ts

> **Source:** [src/rpc/network/services/spectate/SpectateService.ts](../../../../../../../../../src/rpc/network/services/spectate/SpectateService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/spectate.md](../../../../../../views/architecture/sdk/rpc/spectate.md)

## Requirements

- [`INV-SYNC-1-XCQZ28` (Nothing trusted on receipt)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28)
  Contradicts: The supplied genesis timestamp is still persisted; downstream impact needs recheck under the new trusted walk ([`FIND-SECURITY-6-884TAJ`](../../../../../../../audit/open-findings.md#find-security-6-884taj)). The former chain-final reduction-input persistence path is removed; its broader regression assessment remains pending.
  Contradicts: `persistSyncPayload` still stores the responder's unchecked `disputeConfirmations`, and in some cases its `latestStateSnapshot`, for a window this sync did not reduce itself ([`FIND-SYNC-4-KGP4KF`](../../../../../../../audit/open-findings.md#find-sync-4-kgp4kf)).
- [`INV-SYNC-2-AT3RXE` (Requester-anchored validation)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-2-at3rxe)
  Contradicts: Responder step 4 puts the on-chain-tip-to-genesis outbound range in every payload; `generateSyncPayload` sends it only across forks and `applySyncResponse` requires it empty on the same fork, decided by no requirement. See [`OQ-IMPL-SYNC-BOUNDARY-1-4AFPKM` (Same-fork outbound range in the sync payload)](../../../../../../open-questions.md#oq-impl-sync-boundary-1-4afpkm).
- [`INV-SYNC-3-A7A2ED` (Fail-closed with caller-owned consequence)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed)
  Contradicts: a dispute committed after `generateSyncPayload` walked its tip fork makes a latest-mode request fail step 2.8.1 and blacklist the honest responder ([`FIND-SYNC-2-VV16K8`](../../../../../../../audit/open-findings.md#find-sync-2-vv16k8)).
  Contradicts: a local reduction out-of-gas in `sync` is classified as invalid served evidence and blacklists the responder; reduction gas sufficiency is unverified ([`FIND-SYNC-REDUCTION-GAS-1-AJE985`](../../../../../../../audit/open-findings.md#find-sync-reduction-gas-1-aje985)).
- [`INV-SYNC-4-Z6HER7` (Read-only trust establishment)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-4-z6her7)
- [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-1-t2589h)
  Partial: [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f): honest can't-prove-yet refusal punishes the requester (fault taxonomy pending).
- [`REQ-SYNC-2-TNT4F4` (Economic soundness before adoption)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-2-tnt4f4)
- [`REQ-SYNC-3-1P5ZHT` (Suffix through the standard pipeline)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-3-1p5zht)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../../../../../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
- [`REQ-SP-10-JMVHTB` (After successful synchronization, persist the verified start and retained…)](../../../../../../../specification/disputes/state-proofs.md#req-sp-10-jmvhtb)
  Contradicts: retained, unexecuted proof support can contaminate installed history ([`FIND-PROOF-PERSISTENCE-1-HYC9DS`](../../../../../../../audit/open-findings.md#find-proof-persistence-1-hyc9ds)).

## UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT

Requester verification chain

- Setup: Serve payloads with each element individually forged; alter echoes; force each abort step and snapshot race; both requester roles
- Oracle: Every forgery aborts at its step with role-correct consequences; echoes ignored; no transaction ever sent; valid payload adopts and replays

- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P1` — forged dispute window
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P2` — altered echo ignored
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P3` — spectator full abort
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P4` — no-transaction property
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P5` — valid adoption + suffix replay
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P6` — one-in-flight per peer
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P7` — forged genesis snapshot
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P8` — forged state proof
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P9` — forged latest finalized state
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P10` — forged pre-genesis outbound blocks
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P11` — forged latest-fork outbound blocks
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P12` — participant peer-cut abort
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P13` — same-fork proof remains adoptable when its exact target snapshot lands before validation
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P15` — height-too-old simulation with a different on-chain snapshot fails
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P19` — ordinary pinned sync adopts a verified successor without an optional flag
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P20` — ordinary pinned sync refuses an unknown fork and preserves local fork identity
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P21` — concurrent proof verification does not treat a local simulated reduction as chain finality
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P22` — a chain reduction landing after window persistence cannot reject an honest proof
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P23` — an already-final chain window contributes no local reduction input
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P24` — two source syncs share one local EVM; a second persist after the first reduction cannot reject either proof or blacklist either responder
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P25` — two identical supplied windows cause one finality multicall and reject with dispute window not linked
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P27` — an unfinalized block whose bytes do not decode is refused by the pipeline: the sync rejects with "block confirmation rejected", never "block confirmation threw"
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P28` — a pinned proof whose fork is disputed after it was served is accepted, and the responder is neither rejected nor blacklisted
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P29` — a same-fork proof ending at the on-chain height with a different snapshot is rejected because it regresses the on-chain snapshot
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P30` — a milestone snapshot above the on-chain anchor that was altered is rejected as invalid milestones
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P31` — a forged outbound block above the on-chain anchor is rejected as invalid latest-fork outbound blocks
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P33` — a proof whose milestones all start below the on-chain anchor behind a forged newer snapshot is rejected as invalid milestones and nothing is installed
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P34` — a same-fork proof whose threshold is the on-chain snapshot ahead of the fork genesis verifies with only the milestones above it; the latest-fork outbound run is checked from that on-chain snapshot
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P35` — a same-fork proof ending below the on-chain height is rejected because it regresses the on-chain snapshot
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P36` — a first dispute window on a real fork of the channel other than the on-chain fork is rejected as dispute window not linked
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P37` — a second dispute window that does not start at the first window's reduced fork is rejected as dispute window not linked
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P38` — a single dispute window starting at the on-chain fork is accepted with no rejection
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P39` — a payload served while the chain was still on the window's fork and applied after the chain adopted the window's reduced fork: the adopted prefix is skipped, the sync is accepted with no rejection, and the responder is not blacklisted
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P40` — the same late payload with its chain-final window claiming a reduced fork the chain did not record: nothing is skipped and the sync is rejected as dispute window not linked
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P41` — An injected internal failure on the second sync-replay tail block throws, preserves the first replayed full state, stores no failed block, and does not blacklist the responder
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P42` — An unpinned latest request with missing local fork installation uses the chain-derived target, refuses without blacklisting the requester
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P43` — An unpinned request to a responder on an old local fork installs the verified chain-derived successor without blacklisting either peer
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P44` — A participant sync accepts its local finalized tier without mirror or chain walks or responder penalty
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P45` — After local-final proof verification succeeds, a forged latest-fork outbound block still fails the independent sync check
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P46` — A fresh requester skips absent private finality, accepts the mirror proof walk and does not query the chain
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P47` — A fresh requester missing a consumed top-up accepts canonical proof verification after the mirror returns false, with no penalty
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P48` — A conflicting proof fails the private-final walk but passes the mirror walk without chain query; subsequent block replay rejects sync and blacklists the responder
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P49` — A requester whose mirror lacks the newer anchor accepts sync through chain-anchor fallback after genesis-start verification fails
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P50` — A requester whose mirror has the anchor but lacks later consumed inbound evidence accepts chain fallback without penalty
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P51` — Undecodable retained last-block bytes return false at all three proof tiers; sync rejects as invalid milestones and blacklists the responder without throwing
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P52` — Local-final executor failure during sync throws with no later walk, proof-rejection reason or blacklist
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P53` — Mirror executor failure during fresh sync throws with no chain walk, installed head, proof rejection or blacklist
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P54` — Node RPC failure after mirror false during fresh sync throws without installing a head or penalizing the responder
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P55` — A checked block signed by a real participant other than its author makes sync reject/blacklist without storing proof blocks
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P56` — An unrecoverable required confirmation makes sync reject/blacklist as invalid proof, without throwing or storing proof blocks
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P57` — Undecodable material inside a wholly skipped pre-anchor milestone does not prevent sync; planted historical block and snapshot are not stored
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P58` — Excess milestone snapshots make sync reject/blacklist and store neither proof blocks nor excess snapshots/states/change points
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P59` — Missing milestone snapshot makes sync reject/blacklist without storing proof blocks or change points
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P60` — Exact one-snapshot-per-milestone payload syncs successfully, stores the checked head, and reconstructs a chain-valid proof
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P61` — An empty genesis proof with zero snapshot entries syncs successfully and installs the genesis state with head remaining -1
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P62` — A participant missing unfinalized genesis-linked block zero syncs and replays it from genesis, reaches the same block and state, then authors onward; the progressed proof verifies on chain
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P63` — Two unfinalized participant changes remain inside the final milestone tail rather than starting milestones; a sync-only observer replays them, obtains the same state and participants, and reconstructs a verified proof
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P64` — A spectator with its own later finalized point accepts an earlier-start proof containing a newer unfinalized tail, preserves its finalized block, reaches the same latest state, and does not blacklist the responder
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P65` — A spectator rejects and blacklists a responder serving a valid historical proof ending below its finalized point, preserving its current height and application-state hash
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P66` — A spectator rejects and blacklists an honest isolated spectator whose own proof ends below the requester final point; requester head remains unchanged
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P67` — A spectator rejects and blacklists an honest same-key restarted responder whose resynced but later isolated proof is older; the requester preserves its final block and application-state hash
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P68` — When the chain anchor advances into an in-flight proof range, sync succeeds without blacklisting, persists the anchor block and newer state while omitting below-anchor history, and rebuilds an anchor-start proof that synchronizes a fresh spectator
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P69` — A tail block also used as earlier-change support is replayed during real observer sync; every tail block hash and latest application-state hash match the responder
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P70` — A forged transition in a repeated tail block passes proof persistence but is executed during tail replay; a fresh spectator reaches SYNCED then returns to OPENED and closes, while the honest responder proof remains valid
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P71` — Applying the same anchor-rooted proof twice while its head is locally final accepts both, performs no second state install or replay, and preserves exact stored block hashes/signers and state hash
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P72` — Applying an older proof then a newer final proof accepts both and installs the new state while preserving older-only block hashes/signers and storing newer proof block hashes
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P73` — After installing the anchor state, receiving a valid run with earlier genuine supplied state still accepts and replays using held state to reach the responder tip without blacklist
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P74` — Receiving a proof rooted before a newly adopted anchor retains the observed anchor and suffix, and reconstructs a chain-valid proof whose material starts no earlier than that anchor
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P75` — Syncing past an unposted finalized departure stores its participant-change point and reconstructs a valid multi-milestone proof including the departure hop
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P76` — After a first sync, a newer proof verifies from private finality without another mirror-anchor or chain walk, while reconstruction still starts at the original mirrored anchor
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P77` — Applying known proof data twice then new data produces state-install counts 1/0/1, zero replay on repetition, preserves earlier block hashes, and yields the new state and a chain-valid reconstruction
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P78` — A synced unfinalized tail persists both replayed blocks, their snapshots and full states and advances the active head through the tail
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P79` — A wholly pre-anchor milestone with forged participant snapshot is skipped without storing its block/snapshot/change point; retained proof syncs and reconstructs from the anchor
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P80` — A forged participant-change prefix inside an anchor-containing run is clipped; its block/snapshot/change point is absent while retained suffix syncs and reconstructs from the anchor
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P81` — A later support block retains the signature needed for virtual finality, gap history is absent, and reconstruction ending at that support block uses the two-block run and verifies
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P82` — Verified support evidence outside replay is stored as a block with its signatures but does not cause its resulting snapshot or full state to be stored
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P83` — Repeated occurrences of the same block contribute distinct signatures that merge in storage; the tail applies and reconstruction ending at the merged block proves it final as a one-block milestone
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P84` — A threshold hop above the anchor syncs without contiguous gap history; those gap heights remain absent and reconstruction verifies from the anchor
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P85` — After compact sync, two later final blocks advance the spectator reconstruction to the new head while stored original support evidence remains unchanged
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P86` — After compact sync and progress, a new chain anchor becomes the reconstruction start; rebuilt proof needs no earlier evidence although previously stored support blocks remain
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P87` — After installing a newer finalized proof, an older valid payload is rejected as below local finality, blacklists the responder and leaves the active head unchanged
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P88` — An overlapping occurrence with different authenticated contents at the same height/author is rejected as invalid milestones, blacklists its responder and stores none of the inspected proof blocks
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P89` — When requester latest height equals the served finalized replay base, sync reuses its state without unsafeSetLatestState, reaches the tip and matches responder state without blacklist
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P90` — When requester latest height is one below the served finalized replay base, sync installs the base, reaches the tip and matches responder state without blacklist
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P91` — An unpinned latest-state sync served while responder successor installation is held moves the requester off the source fork and blacklists neither side
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P92` — sync persists only the checked region when the chain anchor advances across malformed skipped history
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P93` — a chain-final window the chain has not adopted, whose inbound list carries an extra fabricated successor: the sync is accepted, none of the listed inbound blocks is stored, and the requester's inbound head is unchanged
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P94` — a window the requester reduces locally during the sync: the sync is accepted and exactly the served inbound blocks are stored, with the inbound head on the last one
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P95` — the P93 payload while the reduction lands on chain after the requester's finality read and before its window fetch, so its local reduction returns early: the sync is accepted, none of the listed inbound blocks is stored, and the inbound head is unchanged
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P96` — the P93 payload while a concurrent sync of the genuine payload reduces the window in the requester's local diamond after this sync persisted the window and before it reduces: both syncs are accepted, only the genuine inbound blocks are stored, and the inbound head is on the last genuine block
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P97` — a window the requester reduces locally during the sync whose inbound list carries an extra fabricated successor: the local reduction reverts, the sync is rejected as a served reduction that reverts, no listed inbound block is stored, the inbound head is unchanged, and the local window stays unreduced
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P98` — an unreduced window at the on-chain fork whose disputes name a fork without a dispute window, claiming a fabricated reduced fork with a self-consistent genesis: the sync is rejected as a dispute window mismatch, the responder is blacklisted, the requester stays on its fork, the local window stays unreduced, and no inbound block is stored
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P99` — the P98 payload when its disputes name the window's fork under a channel without a dispute window: the sync is rejected as a dispute window mismatch, the responder is blacklisted, the requester stays on its fork, the local window stays unreduced, and no inbound block is stored
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P100` — a chain-final window the chain has not adopted, followed by a window the requester reduces during the sync: the sync is accepted, none of the first window's listed inbound blocks is stored, the second window's served inbound blocks are stored, and the inbound head is on the second window's last block. Owed: no test yet, blocked on harness staging of two linked dispute windows
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P101` — The runtime stops while the sync install is held: after the release the install commits nothing, the VM and stored state equal the state before the sync, the sync returns false and the responder is not blacklisted.
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P102` — A successor sync whose install read fails after the VM write throws; the VM is restored, the successor genesis is not stored, the fork stays and the responder is not blacklisted.
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P103` — With the successor sync held at its install entry, a queued successor block's queue timeout sees an unknown fork, not a known stale one, and probes its source; after the install the block is stored on the successor and neither reduced peer is blacklisted.
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P104` — With the fork's first outbound block at the chain anchor and a later exit above it, the responder serves and a fresh requester stores only the block above the anchor; the requester's dispute carries that block and the chain accepts the dispute proof.
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P105` — With the sync install held after staging, a block conflicting with the served history is stored at the base height before the commit: the commit finds the conflict, the VM is restored, no proof or history is published, fork and status are unchanged, the stored conflicting block stays and the responder is blacklisted.
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P106` — The same held install without a conflicting block commits, and the sync reaches the tip without blacklisting the responder.
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P107` — A requester that already holds the base, with a stored block at the base height that conflicts with the served history: the conflict is found when the proof is staged, no install runs, the sync aborts with the local state kept and the responder is blacklisted.

## UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD

Responder proving

- Setup: Request latest/pinned/height-0/above-latest/unknown-fork targets from varied local states
- Oracle: Pinned forks or verified successors proven; unrelated or unavailable targets refused; malformed height rejected pre-walk; same-fork payload omits cross-fork evidence; refusal consequence documents [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f)

- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P1` — latest-target success
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P2` — height-0 pin
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P3` — above-latest refused
- [ ] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P4` — unknown fork refused
- [ ] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P5` — malformed height cheap-rejected
- [ ] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P6` — lagging-responder refusal (documents [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f))
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P7` — pinned-target success
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P8` — same-fork payload emits an empty pre-genesis outbound segment while preserving the latest-fork outbound proof
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P9` — a recovered dispute window identifies a successor whose genesis is not installed; proof serving uses the computed genesis before installation
