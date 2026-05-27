# W1 review — round 2

reviewer: explorer agent, threaded-harness branch, 2026-05-26.
target: `docs/parallel-plan-v2/W1-harness-polymorphism.md` (revised after round 1).
baseline: `docs/parallel-plan-v2/W1-review.md`.

---

## 1. round-1 finding dispositions

| finding                                             | status       | one-line evidence                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAJOR-1 — `InlineOpRegistry` v1 leakage             | **RESOLVED** | §6 bucket (iii) "**there is no registry**"; §8 explicitly rejects `runInlineOp`; revision-log M1 cites W0 D-11 rewrite. no `InlineOpId` / handler-table reintroduction under a new name.                                                                             |
| MAJOR-2 — appendix A undercount                     | **RESOLVED** | appendix A is now three buckets; bucket (ii) enumerates 9 inline-only action families (byzantine monkey-patches, `localRpc` mutation, `p2pManager.openConnections`, closure overloads). gating via `harness.requireInlinePeer` is spec'd in §6 and codified as D-16. |
| MAJOR-3 — `PeerHandle` bloated past D-6             | **RESOLVED** | §3 trimmed to 5 async methods + 4 sync identity fields + 1 cached scalar + 2 push-fed live objects. §3 "what _is not_ on `PeerHandle`" list names exactly the cut methods from round 1. revision-log MAJOR-3 confirms 14→5 method count.                             |
| MAJOR-4 — D-12 `activeForkId` async flip            | **RESOLVED** | §3 `forkId` is a sync getter; §7 `activeForkId` stays sync ("D-12 reverted"); §8 explicitly: "`await` is not introduced into test scenarios." W0 D-12 amended to match.                                                                                              |
| MINOR-1 — signer's home unpinned                    | **RESOLVED** | §8 pins: "orchestrator owns the signer (an ethers `Wallet`)"; W0 D-15 added with the same shape (worker receives only the private key on spawn). `signMessage` stays sync.                                                                                           |
| MINOR-2 — `EventBarrier` / `EventSpies` indirection | **RESOLVED** | §3 comment on the field declaration: "both modes return instanceof EventSpies / EventBarrier respectively (asserted at construction)." closes the class-identity footgun.                                                                                            |
| NIT-1 — D-row landing in W0                         | **RESOLVED** | W0 revision log lists D-11 rewrite, D-12 amendment, D-15 add, D-16 add — all present in the W0 file at lines 85–118. cross-cutting consistency restored.                                                                                                             |

every round-1 finding is closed in the document. no PARTIAL, no UNRESOLVED, no REGRESSED.

---

## 2. consistency check vs W0 + master plan

- **D-11 (closures inline-only, no registry).** W1 §6 + appendix A bucket (iii) match W0 D-11 verbatim ("there is no registry"). master-plan.md line 121 "InlineOpRegistry, MathThreadedTransitionActions — same reason" is honored. master-plan W1 OQ#2 (line 163) cross-references D-11 supersession; in sync.
- **D-12 (`activeForkId` stays sync).** W1 §7 + §8 + appendix A `forkId` row match the amended D-12 ("cached via W4 push"). master-plan.md line 63 "defaults off — see W0 D-12" is consistent.
- **D-15 (orchestrator owns signer).** W1 §8 MINOR-1 disposition matches W0 D-15 statement; spawn payload `{ privateKey, ... }` referenced from both sides.
- **D-16 (`requireInlinePeer` gating).** W1 §4 ("`getInlinePeerRecord(peerIndex)` helper, which throws") and §7 ("add `requireInlinePeer(peerIndex)`") refer to the gating seam. small naming wobble — see new-finding N-1 below.
- **master-plan 9 non-negotiables.** W1 §9 self-review hits each one; the row-5 ("no double code") rest no longer depends on undisclosed action surfaces — bucket (ii) is now the audit list.

---

## 3. size / scope check

round-1 W1 was 250-ish lines (pre-rework, by inspection of the revision log). round-2 W1 is **336 lines** including a new appendix A (three buckets) and appendix B (D-row updates). that is growth, not shrinkage.

is the growth justified? mostly yes:

- appendix A bucket (ii) is the audit surface for D-16 — load-bearing. cutting it would re-open MAJOR-2.
- §6 "three buckets" framing replaces the v1 `runInlineOp` escape hatch and is shorter than what it replaces. neutral.
- §8 resolutions are one paragraph per round-1 finding — needed for traceability.

what could still be trimmed (non-blocking):

- §9 self-review against the 9 non-negotiables duplicates what the prose already establishes; could be a one-line "all 9 boss-points satisfied; per-row evidence above" without losing rigor.
- appendix A bucket (i) and (ii) carry a "rpc route (worker mode)" column on bucket (i) and prose explanations on bucket (ii) — the table form for bucket (ii) too would shave ~15 lines.

verdict on shrinkage: W1 grew, but the growth is the round-1 fix-pass content (audit surface + traceability) not new design. v2 invariant ("shrink relative to v1") still holds against the v1 baseline (which had `RemotePeerHandle.ts`, `IPeerHarness.ts`, `InlineOpRegistry`, three threaded action subclasses, ~600+ lines spread across files).

---

## New findings

### N-1 (MINOR) — `requireInlinePeer` vs `getInlinePeerRecord` naming wobble

§4 introduces `getInlinePeerRecord(peerIndex)` ("the harness's `getInlinePeerRecord(peerIndex)` helper, which throws if the peer is a `WorkerPeer`"). §6 and §7 and W0 D-16 and appendix A all call it `requireInlinePeer(peerIndex)`. one helper, two names. pick `requireInlinePeer` (the `require*` verb signals "throws if absent" per the project's harness naming conventions); fix the §4 sentence.

**fix.** s/getInlinePeerRecord/requireInlinePeer/ in §4. one-word edit.

### N-2 (MINOR) — `ingestBlockConfirmation` justification needs one citation

§3 keeps `ingestBlockConfirmation(req): Promise<boolean>` on `PeerHandle`. appendix A row says "`TransitionActions` block-ingest path (`peer.stateManager.ingestBlockConfirmation`)" — singular caller, no file:line. revision-log MAJOR-3 says "ingestBlockConfirmation kept (real caller)." worth pinning the file:line in appendix A for the same audit rigor every other row gets. not blocking; trims future "is this still used?" review cycles.

### N-3 (NIT) — revision log references D-13/D-14 that aren't W1's

W1 revision log line 336 says "land them in W0 in the same change (D-11 rewrite, D-12 revert, D-13 new, D-14 new)." D-13 doesn't exist in W0; D-14 is W4's (spy args). the W1 round-1 fixes actually land as D-11/D-12/D-15/D-16 in W0. minor stale text from the round-1 mid-edit; not a correctness issue, but the doc citing the wrong D-numbers should be cleaned to avoid confusing the PDR reader.

**fix.** s/D-13 new, D-14 new/D-15 new, D-16 new/ in the W1 revision-log NIT-1 line.

---

## Verdict

**READY FOR PDR**, with two one-line cleanups (N-1, N-3) and one optional citation (N-2). all round-1 findings are RESOLVED. W1 ↔ W0 D-rows are consistent. no v1 leakage reintroduced. no new BLOCKER or MAJOR introduced by the round-1 fix pass.

doc grew by ~30% during the fix pass; growth is audit surface (appendix A bucket ii) directly required to close MAJOR-2, not over-engineering. shrinkage-vs-v1 invariant holds.
