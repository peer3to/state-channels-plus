# Codex Security finding reassessment

> **Status:** Current static assessment; engineer review pending. No risk acceptance or fix approval is recorded.
> **Reviewed:** 2026-09-30, `dispute` at `9dc2437696fbe5d18e7a63d881c249382579f84d`, including the nine existing uncommitted files.
> **Scope:** Reassess the 12 findings from Codex Security scan `b16b8056-1a2e-47ad-b510-34ef96ce1d0b` at `d0ee003884e559a50c4128fe3c3b3064bd11a53e`. This is not a fresh repository-wide scan.

## Result and handoff

**9 confirmed, 1 not actionable because its exact path is fixed, and 2 needing boundary/reachability review.** Among the nine confirmed findings, the original scan ratings are five high, three medium and one low. Ratings are retained for continuity; queue rank orders exploitability separately. The two needs-review items retain their original low rating only as input metadata, not as confirmed vulnerabilities.

Read each item's preconditions before implementing a fix. Confirmed means the source supports the claim under those preconditions, not that an exploit was executed. No application, tests, builds or exploit probes were run during this reassessment. Documentation checks are recorded in the final handoff. No source fixes were made. The completed original scan remains immutable; the current decisions are here and in [open findings](./open-findings.md#codex-security-reassessment).

The repository fast-forwarded from the scan revision to the fetched `origin/dispute`. None of the upstream changes overlapped the nine local files. Their contents and both staged/unstaged binary diffs were identical before and after the update; no stash or conflict resolution was needed. They remain uncommitted. Their runtime/internal-RPC changes do not replace any of the cited fraud, sync or tooling controls.

The applicable SECURITY.md resolver returned no policy for the affected directories. Boundary judgments therefore use the specification, entrypoint routing, manifests and operational documentation. This report does not certify dependency security, deployed consumer facets, host firewall policy or browser local-network behavior.

## Triage queue

| Original rule         | Current result | Original severity | Queue rank | Finding / tracking                                                                                                                                                |
| --------------------- | -------------- | ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `milestone-skip`      | not_actionable | high              | —          | [Skipped milestones allow unsigned channel snapshot replacement](#milestone-skip)                                                                                 |
| `zero-verdict`        | confirmed      | high              | 1          | [A zero proof target lets outsiders kill honest disputes](#zero-verdict) · [`FIND-SECURITY-1-6SAJ4E`](open-findings.md#find-security-1-6saj4e)                    |
| `unbound-snapshot`    | confirmed      | high              | 2          | [Unlinked previous-state input can falsely slash an honest signer](#unbound-snapshot) · [`FIND-SECURITY-2-J3J60V`](open-findings.md#find-security-2-j3j60v)       |
| `pruned-inbound`      | confirmed      | high              | 3          | [Pruned genuine inbound history can falsely slash honest authors](#pruned-inbound) · [`FIND-SECURITY-3-REDPJW`](open-findings.md#find-security-3-redpjw)          |
| `open-deadline`       | confirmed      | medium            | 6          | [Expired opening signatures still authorize channel creation](#open-deadline) · [`FIND-SECURITY-4-02DYWZ`](open-findings.md#find-security-4-02dywz)               |
| `sync-inbound`        | confirmed      | high              | 5          | [Peer sync can make an honest node sign fabricated inbound data](#sync-inbound) · [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx)             |
| `sync-genesis-time`   | confirmed      | high              | 4          | [Peer sync can replace genesis time and induce a slashable first block](#sync-genesis-time) · [`FIND-SECURITY-6-884TAJ`](open-findings.md#find-security-6-884taj) |
| `host-input`          | confirmed      | low               | 9          | [Docker workload filtering omits worker-host services](#host-input) · [`FIND-SECURITY-7-SKBT55`](open-findings.md#find-security-7-skbt55)                         |
| `log-queue`           | confirmed      | medium            | 7          | [Guest log output can exhaust the worker supervisor](#log-queue) · [`FIND-SECURITY-8-J2S8H3`](open-findings.md#find-security-8-j2s8h3)                            |
| `publication-journal` | confirmed      | medium            | 8          | [Review clients can overwrite shared publication history](#publication-journal) · [`FIND-SECURITY-9-R9W4MP`](open-findings.md#find-security-9-r9w4mp)             |
| `harness-eval`        | needs_review   | low               | 1          | [Test harness exposes code execution before peer authentication](#harness-eval)                                                                                   |
| `registry-null`       | needs_review   | low               | 2          | [Malformed registration can stop the local discovery registry](#registry-null)                                                                                    |

Ranks are unique within each of the confirmed and needs-review queues. Unauthenticated on-chain paths rank before peer-assisted signing paths; admitted tooling clients rank later. The fixed item has no rank. All 12 inputs are retained, including the fixed and uncertain claims.

<a id="milestone-skip"></a>

## 1. Skipped milestones allow unsigned channel snapshot replacement

**Verdict:** `not_actionable` · **Confidence:** high · **Original severity:** high.

Source identity: `csf_8a972993ab889a6f4a696895`; rule `milestone-skip`; occurrence `occ_cad859aa82ba1b122a359989`.

**Current evidence and path.** The exact all-skipped replacement is fixed. StateProofFacet now requires the final claimed snapshot to equal the trusted threshold. updateStateSnapshotSameFork separately requires a newer snapshot, so the old bypass cannot satisfy both checks. Empty proofs cannot bypass the nonempty-snapshot and matching-length checks.

**Locations:** [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol:404–411](../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L404-L411); [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol:54–75](../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L54-L75); [test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol:167–192](../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L167-L192); [test/unit/SpectateService.test.ts:636–697](../../../test/unit/SpectateService.test.ts#L636-L697).

**Boundary:** library API and public routed Solidity contracts. Public selector routing, fraud-slashing invariants and synchronization verification-before-effect requirements. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** The helper still accepts confirmation of the threshold itself; that is not permission to replace it.

**Proof gaps.** No runtime re-execution. The routed-diamond regression test and sync regression test were read, not run.

**Next step:** no new fix for this exact claim. The existing [`FIND-MILESTONE-1-DAGAX5`](open-findings.md#find-milestone-1-dagax5) owns the resolution. Its routed-diamond and sync regression bodies cover the forged newer snapshot rejection; this reassessment did not run them.

<a id="zero-verdict"></a>

## 2. A zero proof target lets outsiders kill honest disputes

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 1 · [`FIND-SECURITY-1-6SAJ4E`](open-findings.md#find-security-1-6saj4e).

Source identity: `csf_623195021241d901f52c336c`; rule `zero-verdict`; occurrence `occ_0fa37f9753be82684d5eaa47`.

**Current evidence and path.** The zero-sentinel equality is unchanged. Any chain caller can submit a committed honest dispute during its kill period, choose a proof handler that returns zero for invalid evidence, and declare participant zero. The success branch delegates to killDispute, which slashes the real disputer and removes its commitment.

**Locations:** [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol:17–35](../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L17-L35); [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol:118–128](../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L118-L128); [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol:529–557](../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L529-L557).

**Boundary:** library API and public routed Solidity contracts. Public selector routing, fraud-slashing invariants and synchronization verification-before-effect requirements. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** The commitment and kill-period checks constrain the window. The ordinary fraud dispatcher rejects zero, but the dispute dispatcher does not.

**Proof gaps.** Static only; preserve committed-dispute and active kill-period prerequisites.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-1-6SAJ4E`](open-findings.md#find-security-1-6saj4e). Reject zero targets and require a nonzero verdict that matches both the proof target and the dispute's disputer before killing. Preserve the preconditions and limits above. Required regression work:

- Submit every invalid dispute proof type with zero target and verify no honest commitment or slash state changes.
- Retain positive tests for valid nonzero fraud verdicts.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

**Specification / implementation owners:** [fraud-slashing requirements and planned tests](../specification/enforcement/fraud-slashing.md); [DisputeFraudProofFacet source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md). The relevant obligation is that only proven misconduct can slash an honest participant; no new protocol meaning is selected here.

<a id="unbound-snapshot"></a>

## 3. Unlinked previous-state input can falsely slash an honest signer

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 2 · [`FIND-SECURITY-2-J3J60V`](open-findings.md#find-security-2-j3j60v).

Source identity: `csf_dc2174473e0ce47f18083689`; rule `unbound-snapshot`; occurrence `occ_a309c1b71540c059223ff617`.

**Current evidence and path.** The early fork mismatch still returns a valid signer verdict before binding the supplied previous snapshot to the signed block. An external caller holding an honest signed block can supply a different-fork previous snapshot and target its eligible signer through the routed applyFraudProofs entrypoint.

**Locations:** [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:109–145](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L109-L145); [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:11–27](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L11-L27).

**Boundary:** library API and public routed Solidity contracts. Public selector routing, fraud-slashing invariants and synchronization verification-before-effect requirements. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** The channel check and signer recovery remain, but neither authenticates the caller-supplied previous snapshot. Target eligibility is required.

**Proof gaps.** Static only; no asset-transfer claim.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-2-J3J60V`](open-findings.md#find-security-2-j3j60v). Bind the previous snapshot to the signed block's predecessor before interpreting its fields. Unlinked evidence must be rejected, not treated as participant fraud. Preserve the preconditions and limits above. Required regression work:

- An honest block plus arbitrary previous snapshot/fork must never slash its signer.
- Cover genesis and non-genesis predecessor binding and the nested dispute proof route.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

**Specification / implementation owners:** [fraud-slashing requirements and planned tests](../specification/enforcement/fraud-slashing.md); [FraudProofFacet source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md). The relevant obligation is that only proven misconduct can slash an honest participant; no new protocol meaning is selected here.

<a id="pruned-inbound"></a>

## 4. Pruned genuine inbound history can falsely slash honest authors

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 3 · [`FIND-SECURITY-3-REDPJW`](open-findings.md#find-security-3-redpjw).

Source identity: `csf_f664a2f1629d842430826ec3`; rule `pruned-inbound`; occurrence `occ_60d59b4ec6fb0b8576e03989`.

**Current evidence and path.** The forged-inbound handler still equates absence from the live map with forgery. Normal snapshot adoption deletes the consumed inbound head and its ancestors. After a later head is adopted, a retained honest signed block containing an earlier genuine head can satisfy the false-fraud verdict.

**Locations:** [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:330–362](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L330-L362); [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol:196–205](../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L196-L205).

**Boundary:** library API and public routed Solidity contracts. Public selector routing, fraud-slashing invariants and synchronization verification-before-effect requirements. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** The current snapshot head is exempt. The attack needs an older pruned head and an author who remains eligible; proof of inclusion and signature authenticity still apply.

**Proof gaps.** Static only; construct the two successive legitimate inbound heads in a future regression test.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-3-REDPJW`](open-findings.md#find-security-3-redpjw). Preserve authenticated historical inclusion evidence or constrain proofs with an authenticated history/finality rule. Absence from prunable storage must not prove forgery. Preserve the preconditions and limits above. Required regression work:

- After advancing from genuine inbound A to B and pruning A, a forgery proof using A must not slash its author.
- Keep rejection of genuinely uncommitted inbound blocks with authenticated evidence.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

**Specification / implementation owners:** [fraud-slashing requirements and planned tests](../specification/enforcement/fraud-slashing.md); [FraudProofFacet source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md). The relevant obligation is that only proven misconduct can slash an honest participant; no new protocol meaning is selected here.

<a id="open-deadline"></a>

## 5. Expired opening signatures still authorize channel creation

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** medium · **confirmed rank:** 6 · [`FIND-SECURITY-4-02DYWZ`](open-findings.md#find-security-4-02dywz).

Source identity: `csf_a21953f8b0820513c80b2cad`; rule `open-deadline`; occurrence `occ_3ddb6fa24937a6e8e0ab73a6`.

**Current evidence and path.** The proxy opening path is unchanged: it verifies participant signatures and passes deadlineTimestamp to the consumer deposit path without checking expiry. The SDK clears the attempt after the signed window. A negotiating peer can retain signatures and later open using the bundled consumer behavior.

**Locations:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol:218–238](../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L218-L238); [src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts:679–718](../../../src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L679-L718); [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol:40–48](../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L40-L48).

**Boundary:** library API and public routed Solidity contracts. Public selector routing, fraud-slashing invariants and synchronization verification-before-effect requirements. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** An application consumer may enforce the deadline itself. Bundled asset methods are placeholders, so this report claims expired channel authorization, not asset theft.

**Proof gaps.** Static only; check the real deployed consumer before assigning asset impact.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-4-02DYWZ`](open-findings.md#find-security-4-02dywz). Enforce `OpenChannel.deadlineTimestamp` in `open` before deposits or state changes, consistently with the direct join deadline check. Preserve the preconditions and limits above. Required regression work:

- Test direct open before, at and after deadline.
- Submit retained opening signatures after SDK expiry and verify the contract rejects them.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

**Owners:** [admission and funds](../specification/enforcement/admission-and-funds.md), [lifecycle](../specification/settlement/lifecycle.md), [proxy source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md). Keep the real consumer's deadline behavior explicit.

<a id="sync-inbound"></a>

## 6. Peer sync can make an honest node sign fabricated inbound data

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 5 · [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx).

Source identity: `csf_237e0d0f589b22bf18c348fb`; rule `sync-inbound`; occurrence `occ_482d7e145268e00610d5142b`.

**Current evidence and path.** The new linked-window check excludes unrelated windows and does not persist the already-adopted prefix. It still skips reduction-input validation for a chain-final window that starts at the current chain fork and has not yet been adopted. persistSyncPayload stores that remaining window's inboundMessageBlocksAppliedInReduce unconditionally. A fabricated successor can become the local inbound tip and be signed during block production.

**Locations:** [src/rpc/network/services/spectate/SpectateService.ts:241–329](../../../src/rpc/network/services/spectate/SpectateService.ts#L241-L329); [src/rpc/network/services/spectate/SpectateService.ts:488–501](../../../src/rpc/network/services/spectate/SpectateService.ts#L488-L501); [src/rpc/network/services/spectate/SpectateService.ts:967–978](../../../src/rpc/network/services/spectate/SpectateService.ts#L967-L978); [src/storage/MessageBlockStorage.ts:36–57](../../../src/storage/MessageBlockStorage.ts#L36-L57); [src/stateManager/block/BlockProductionService.ts:57–108](../../../src/stateManager/block/BlockProductionService.ts#L57-L108).

**Boundary:** library API and public routed Solidity contracts. Public selector routing, fraud-slashing invariants and synchronization verification-before-effect requirements. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** Already-adopted prefix windows are now omitted. Nonfinal windows execute reduction. The surviving attack needs a finalized-but-unadopted window, a lagging signing participant, and a fabricated successor that passes chain-shape/balance checks.

**Proof gaps.** Static only; runtime regression must exercise the finalized-but-unadopted branch, not the now-excluded prefix.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx). Do not persist unused peer-provided reduction inputs from finalized windows. Reconstruct authoritative chain data or validate each object before it enters trusted inbound storage. Preserve the preconditions and limits above. Required regression work:

- Change only a finalized window's ignored inbound list and assert no trusted head changes.
- Verify a syncing participant never signs the injected successor.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

**Owners:** [synchronization requirements and planned tests](../specification/peer-communication/synchronization.md), [SpectateService source report](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md), [current sync test mapping](../verification/tests/test/unit/SpectateService.test.ts.md). The tip-promotion component also relates to [`FIND-STORAGE-2-NK2XBF`](open-findings.md#find-storage-2-nk2xbf); this report preserves the distinct end-to-end sync-to-signing claim.

<a id="sync-genesis-time"></a>

## 7. Peer sync can replace genesis time and induce a slashable first block

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 4 · [`FIND-SECURITY-6-884TAJ`](open-findings.md#find-security-6-884taj).

Source identity: `csf_01e69b761bddfdcbeac64472`; rule `sync-genesis-time`; occurrence `occ_0c51cce0dbb06ddacb658c01`.

**Current evidence and path.** The new isSameForkRegression check does not close the timestamp-only case. UtilityFacet.isSnapshotNewer returns true for two different height-zero snapshots when the current one is genesis. Time-blind genesis validation and an empty milestone proof then pass; persistence stores the altered genesis. First-block production hashes that snapshot, while WrongGenesis compares the full on-chain genesis hash.

**Locations:** [src/rpc/network/services/spectate/SpectateService.ts:332–366](../../../src/rpc/network/services/spectate/SpectateService.ts#L332-L366); [src/rpc/network/services/spectate/SpectateService.ts:1079–1095](../../../src/rpc/network/services/spectate/SpectateService.ts#L1079-L1095); [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol:268–284](../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L268-L284); [src/rpc/network/services/spectate/SpectateService.ts:979–988](../../../src/rpc/network/services/spectate/SpectateService.ts#L979-L988); [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:294–299](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L294-L299).

**Boundary:** library API and public routed Solidity contracts. Public selector routing, fraud-slashing invariants and synchronization verification-before-effect requirements. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** An advanced chain snapshot or already-stored block zero blocks the simple case. The victim must sync before its first block, with otherwise correct genesis data. The old report's multicall explanation is obsolete: that helper was removed.

**Proof gaps.** Static only; test a timestamp-only mutation against the new regression helper.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-6-884TAJ`](open-findings.md#find-security-6-884taj). Bind the full genesis snapshot, including timestamp, to authoritative chain state or authenticated reduction history before persistence. Preserve the preconditions and limits above. Required regression work:

- Reject same-fork genesis sync with only timestamp changed.
- Cover empty proofs before block zero and reduced-genesis canonical timestamp.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

**Owners:** [synchronization requirements and planned tests](../specification/peer-communication/synchronization.md), [SpectateService source report](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md), [current sync test mapping](../verification/tests/test/unit/SpectateService.test.ts.md). The new regression helper is not a full genesis authentication check.

<a id="host-input"></a>

## 8. Docker workload filtering omits worker-host services

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** low · **confirmed rank:** 9 · [`FIND-SECURITY-7-SKBT55`](open-findings.md#find-security-7-skbt55).

Source identity: `csf_6eed22aa96514ee57ddf2190`; rule `host-input`; occurrence `occ_3eb4bef4a6924cd99f4c5d34`.

**Current evidence and path.** The Linux backend still installs the host-CIDR deny rules only through DOCKER-USER. Container-to-host traffic uses INPUT, so a guest can reach a listening host service unless an independent INPUT policy blocks it. README explicitly promises Linux worker-host blocking, establishing the supported boundary.

**Locations:** [scripts/e2e-parallel/distributed/egressPolicy.js:88–112](../../../scripts/e2e-parallel/distributed/egressPolicy.js#L88-L112); [scripts/e2e-parallel/distributed/isolatedEnvironment.js:498–507](../../../scripts/e2e-parallel/distributed/isolatedEnvironment.js#L498-L507).

**Boundary:** authenticated developer infrastructure. README explicitly promises Linux worker-host egress blocking. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** Forwarded private traffic is filtered; Docker Desktop is explicitly weaker. A host service and missing independent INPUT protection are prerequisites. Host code execution is not established.

**Proof gaps.** Static only; Linux bridge and sentinel-host-service reproduction remains needed.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-7-SKBT55`](open-findings.md#find-security-7-skbt55). Install and maintain filtering on the container-to-host INPUT path as well as forwarded egress. Test against a known listening host sentinel. Preserve the preconditions and limits above. Required regression work:

- With a listening bridge-host sentinel, assert guest TCP is denied.
- Cover policy setup, container reuse and cleanup for INPUT and forwarding paths.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

<a id="log-queue"></a>

## 9. Guest log output can exhaust the worker supervisor

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** medium · **confirmed rank:** 7 · [`FIND-SECURITY-8-J2S8H3`](open-findings.md#find-security-8-j2s8h3).

Source identity: `csf_a62e0fe543a39012e6a874cf`; rule `log-queue`; occurrence `occ_2b5242d4c9e42b81fc5798f5`.

**Current evidence and path.** Guest preparation output still reaches independently scheduled async handlers. Each outbound send allocates buffers before joining an unbounded writeChain. An admitted orchestrator can arrange noisy preparation, stop draining outbound data, and keep inbound heartbeats alive; queued buffers consume supervisor memory outside guest limits.

**Locations:** [scripts/e2e-parallel/distributed/server.js:372–375](../../../scripts/e2e-parallel/distributed/server.js#L372-L375); [scripts/e2e-parallel/distributed/server.js:1287–1293](../../../scripts/e2e-parallel/distributed/server.js#L1287-L1293); [scripts/e2e-parallel/distributed/protocol.js:265–289](../../../scripts/e2e-parallel/distributed/protocol.js#L265-L289).

**Boundary:** authenticated developer infrastructure. README documents isolated guest workloads and worker resource ceilings. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** Authentication, per-frame limits and guest memory limits remain. They do not impose an aggregate host-side log queue bound. The attacker needs pool admission and control over preparation/read pace.

**Proof gaps.** Static only; quantify host memory growth and lease behavior before setting a production resource threshold.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-8-J2S8H3`](open-findings.md#find-security-8-j2s8h3). Bound per-connection queued bytes and propagate backpressure to guest control input, or stop over-budget producers. Bound stalled-output duration separately from inbound heartbeat. Preserve the preconditions and limits above. Required regression work:

- A slow-reading orchestrator plus continuous preparation output must stay within a host queue budget.
- Verify isolation/cleanup without affecting other worker leases.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

<a id="publication-journal"></a>

## 10. Review clients can overwrite shared publication history

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** medium · **confirmed rank:** 8 · [`FIND-SECURITY-9-R9W4MP`](open-findings.md#find-security-9-r9w4mp).

Source identity: `csf_bed946f1d1cab3ad7562ef4f`; rule `publication-journal`; occurrence `occ_190a5e602b6ad6c28fe7f6e4`.

**Current evidence and path.** A completed ordinary review delivery still authorizes publication load/save without checking CI publication authority. The journal is keyed only by repository and PR. The caller can read its digest and replace states with an empty array. The documented boundary says mode binds CI-only publication; the implemented operation does not enforce that distinction.

**Locations:** [scripts/bot/server.js:226–248](../../../scripts/bot/server.js#L226-L248); [scripts/bot/publication-store.js:13–18](../../../scripts/bot/publication-store.js#L13-L18); [scripts/bot/publication-store.js:56–81](../../../scripts/bot/publication-store.js#L56-L81).

**Boundary:** authenticated developer infrastructure. scripts/bot/README.md documents CI-only publication and a separate publisher token. The claimed input crosses the stated authorization, evidence-integrity or isolation boundary under the listed preconditions.

**Counterevidence and limits.** Compare-and-swap prevents stale writes, not unauthorized current writes. Live CI/head/thread checks still guard final approval; this finding does not claim unconditional GitHub autoapproval.

**Proof gaps.** Static only; if all admitted clients are intentionally authorized to publish every PR, document that different trust model before closing the finding.

**Fix handoff (proposed, not implemented):** Use `$codex-security:fix-finding` for [`FIND-SECURITY-9-R9W4MP`](open-findings.md#find-security-9-r9w4mp). Require a separate publication capability bound to repository, PR, head and CI execution. Validate journal/receipt mutations against worker-owned results and preserve caller authority in shared state. Preserve the preconditions and limits above. Required regression work:

- An ordinary local review client cannot mutate the CI publication journal or receipts.
- Authorized publisher mutations must remain bound to the reviewed result and exact PR/head.

These are proposed regression obligations, not evidence of passing tests. Before implementing, update the owning plans and exact test mappings in the same pass.

<a id="harness-eval"></a>

## 11. Test harness exposes code execution before peer authentication

**Verdict:** `needs_review` · **Confidence:** medium · **Original severity:** low · **needs_review rank:** 1.

Source identity: `csf_9ab7cede3f992354ca5b0bd8`; rule `harness-eval`; occurrence `occ_fc2c43256bb7546b44e4e279`.

**Current evidence and path.** The code condition remains: the default test manifest intentionally has no guards and scenario.exec evaluates a received body. The loopback listener has no Origin check and installs the transport before handshake completion. However, this is a deliberately code-executing test fixture, not the production manifest; an actual lower-trust browser-to-harness path was not established.

**Locations:** [test/fixtures/customRpc/harnessControl/services/scenario/ScenarioService.ts:16–24](../../../test/fixtures/customRpc/harnessControl/services/scenario/ScenarioService.ts#L16-L24); [test/fixtures/customRpc/harnessControl/services/scenario/ScenarioRpcMethods.ts:30–42](../../../test/fixtures/customRpc/harnessControl/services/scenario/ScenarioRpcMethods.ts#L30-L42).

**Boundary:** test/fixture. Fixture/development comments establish intended trusted use; browser boundary support remains unclear. A supported lower-trust crossing is not established.

**Counterevidence and limits.** Same-user local processes are not a security boundary. The listener is temporary and browser local-network/mixed-content policy may block access. The fixture comment explicitly requests pre-handshake access.

**Proof gaps.** Determine whether untrusted browser origins can reach this listener in a supported developer setup and whether the harness promises isolation from them. Then validate a local-only execution guard without breaking required probes.

**Next step:** resolve the specific boundary question above before treating this as a security fix. No fix-finding handoff is issued yet.

<a id="registry-null"></a>

## 12. Malformed registration can stop the local discovery registry

**Verdict:** `needs_review` · **Confidence:** medium · **Original severity:** low · **needs_review rank:** 2.

Source identity: `csf_638ea73947731f98d7f29fdf`; rule `registry-null`; occurrence `occ_e21fa134630b24544d8b0877`.

**Current evidence and path.** The parser defect remains: JSON null parses successfully, then parsed.port throws outside the catch. The registry defaults to loopback and has no Origin check. Its security impact depends on an untrusted browser being allowed to connect, or a supported externally bound deployment.

**Locations:** [scripts/infra/local-discovery-registry.js:26–36](../../../scripts/infra/local-discovery-registry.js#L26-L36); [scripts/infra/local-discovery-registry.js:5–10](../../../scripts/infra/local-discovery-registry.js#L5-L10).

**Boundary:** local developer service. Fixture/development comments establish intended trusted use; browser boundary support remains unclear. A supported lower-trust crossing is not established.

**Counterevidence and limits.** A trusted same-user caller can already stop its own development process. Browser reachability and intended support for hostile clients were not established. Socket error handling does not catch this application exception.

**Proof gaps.** Confirm a supported lower-trust caller path. Independently, non-null object validation is a straightforward robustness fix; no runtime crash test was run.

**Next step:** resolve the specific boundary question above before treating this as a security fix. No fix-finding handoff is issued yet.

## Running security review for GitHub PRs

For connected repositories with Codex Security Review access, choose the repository in **Codex settings**, turn on **Review security vulnerabilities → Auto security review**, set **Review → All PRs**, and choose **Trigger → On every push** (or **On PR open** for opening-only review). A previous full scan is optional. This is a focused PR security review, not a repeat of a full repository scan. See [official Security Review setup](https://learn.chatgpt.com/docs/security/security-review).

For a versioned CI check with JSON/SARIF artifacts and an optional severity gate, follow [official Codex Security CI guidance](https://learn.chatgpt.com/docs/security/cli/ci). It uses the standalone CLI, a scan-step-scoped API key, base/head history and a trusted executable installed outside the checkout. The documented credentialed example runs for same-repository trusted PRs; do not extend that credential boundary to arbitrary forks. Access is still required. Start advisory and decide the severity gate after observing results.

This repository already runs a custom [PR Review Bot workflow](../../../.github/workflows/review.yml) on opened, synchronized and reopened same-repository PRs. That is not proof that Codex Security Review is enabled. No GitHub setting, secret or workflow was changed in this task.
