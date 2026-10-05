# Codex Security finding reassessment

> **Status:** Current static assessment. **Engineer decision (2026-09-30):** publish this assessment now, with no fixes in this change; every finding stays open in its owner's tracker until its fix lands. No risk acceptance or fix approval is recorded.
> **Reviewed:** 2026-09-30, `dispute` at `9dc2437696fbe5d18e7a63d881c249382579f84d`.
> **Scope:** Reassess the 12 findings from Codex Security scan `b16b8056-1a2e-47ad-b510-34ef96ce1d0b` at `d0ee003884e559a50c4128fe3c3b3064bd11a53e`. This is not a fresh repository-wide scan.

## Result and handoff

**Of the 12 findings, 7 concern the protocol and are assessed here: 6 confirmed and 1 not actionable because its exact path is fixed.** Among the six confirmed findings, the original scan ratings are five high and one medium. Ratings are retained for continuity; queue rank orders exploitability separately.

The other 5 findings concern developer tooling. By engineer decision (2026-09-30), tooling findings are tracked in the tooling's own documentation, not in this specification's audit register:

- Docker workload filtering and the supervisor log queue (both confirmed): [distributed runner open security findings](../../../README.md#open-security-findings).
- Publication journal overwrite (confirmed): [review service open security findings](../../../scripts/bot/README.md#open-security-findings).
- Harness code execution before authentication (needs boundary review): [test harness open security questions](../../../test/harness/README.md#open-security-questions).
- Malformed discovery registration (needs boundary review): [local infrastructure open security questions](../../../scripts/infra/README.md#open-security-questions).

Read each item's preconditions before implementing a fix. Confirmed means the source supports the claim under those preconditions, not that an exploit was executed. No application, tests, builds or exploit probes were run during this reassessment. No source fixes were made. The completed original scan remains immutable; the current decisions are here and in [open findings](./open-findings.md#codex-security-reassessment).

The applicable SECURITY.md resolver returned no policy for the affected directories. Boundary judgments therefore use the specification, entrypoint routing, manifests and operational documentation. This report does not certify dependency security, deployed consumer facets, host firewall policy or browser local-network behavior.

## Triage queue

| Original rule       | Current result | Original severity | Queue rank | Finding / tracking                                                                                                                                                |
| ------------------- | -------------- | ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `milestone-skip`    | not_actionable | high              | —          | [Skipped milestones allow unsigned channel snapshot replacement](#milestone-skip)                                                                                 |
| `zero-verdict`      | confirmed      | high              | 1          | [A zero proof target lets outsiders kill honest disputes](#zero-verdict) · [`FIND-SECURITY-1-6SAJ4E`](open-findings.md#find-security-1-6saj4e)                    |
| `unbound-snapshot`  | confirmed      | high              | 2          | [Unlinked previous-state input can falsely slash an honest signer](#unbound-snapshot) · [`FIND-SECURITY-2-J3J60V`](open-findings.md#find-security-2-j3j60v)       |
| `pruned-inbound`    | confirmed      | high              | 3          | [Pruned genuine inbound history can falsely slash honest authors](#pruned-inbound) · [`FIND-SECURITY-3-REDPJW`](open-findings.md#find-security-3-redpjw)          |
| `open-deadline`     | fixed          | medium            | —          | [Expired opening signatures still authorize channel creation](#open-deadline) · [`FIND-SECURITY-4-02DYWZ`](open-findings.md#find-security-4-02dywz)               |
| `sync-inbound`      | fixed          | high              | —          | [Peer sync can make an honest node sign fabricated inbound data](#sync-inbound) · [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx)             |
| `sync-genesis-time` | confirmed      | high              | 4          | [Peer sync can replace genesis time and induce a slashable first block](#sync-genesis-time) · [`FIND-SECURITY-6-884TAJ`](open-findings.md#find-security-6-884taj) |

Ranks are unique within the confirmed queue and follow the class that each item's Boundary paragraph names:

- **Unauthenticated on-chain paths (ranks 1–3):** any chain account can use them.
- **Peer-assisted signing paths (rank 4; rank 5 is fixed):** the attacker must be the sync responder that the victim selected.
- **On-chain path that needs participant-issued credentials (rank 6, now fixed):** only a counterparty that holds every participant's opening signatures could use it, and its original severity is medium.

Fixed items have no rank. All 7 protocol inputs are retained here, including the fixed claims.

<a id="milestone-skip"></a>

## 1. Skipped milestones allow unsigned channel snapshot replacement

**Verdict:** `not_actionable` · **Confidence:** high · **Original severity:** high.

Source identity: `csf_8a972993ab889a6f4a696895`; rule `milestone-skip`; occurrence `occ_cad859aa82ba1b122a359989`.

**Current evidence and path.** The exact all-skipped replacement is fixed. StateProofFacet now requires the final claimed snapshot to equal the trusted threshold. updateStateSnapshotSameFork separately requires a newer snapshot, so the old bypass cannot satisfy both checks. Empty proofs cannot bypass the nonempty-snapshot and matching-length checks.

**Locations:** [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol:404–411](../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L404-L411); [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol:54–75](../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L54-L75); [test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol:167–192](../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L167-L192); [test/unit/SpectateService.test.ts:631–691](../../../test/unit/SpectateService.test.ts#L631-L691).

**Boundary:** any chain account, with no credential, through the routed `updateStateSnapshotSameFork` entrypoint. Ranking class: unauthenticated on-chain path; it has no rank because the path is fixed.

**Counterevidence and limits.** The helper still accepts confirmation of the threshold itself; that is not permission to replace it.

**Proof gaps.** No runtime re-execution. The routed-diamond regression test and sync regression test were read, not run.

**Next step:** no new fix for this exact claim. The existing [`FIND-MILESTONE-1-DAGAX5`](open-findings.md#find-milestone-1-dagax5) owns the resolution. Its routed-diamond and sync regression bodies cover the forged newer snapshot rejection; this reassessment did not run them.

<a id="zero-verdict"></a>

## 2. A zero proof target lets outsiders kill honest disputes

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 1 · [`FIND-SECURITY-1-6SAJ4E`](open-findings.md#find-security-1-6saj4e).

Source identity: `csf_623195021241d901f52c336c`; rule `zero-verdict`; occurrence `occ_0fa37f9753be82684d5eaa47`.

**Current evidence and path.** The zero-sentinel equality is unchanged. Any chain caller can submit a committed honest dispute during its kill period, choose a proof handler that returns zero for invalid evidence, and declare participant zero. The success branch delegates to killDispute, which slashes the real disputer and removes its commitment.

**Locations:** [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol:17–35](../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L17-L35); [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol:118–128](../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L118-L128); [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol:529–557](../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L529-L557).

**Boundary:** any chain account, with no credential, through the routed `applyDisputeFraudProofs` entrypoint. The caller needs only the public contents of a committed dispute. Ranking class: unauthenticated on-chain path.

**Counterevidence and limits.** The commitment and kill-period checks constrain the window. The ordinary fraud dispatcher rejects zero, but the dispute dispatcher does not.

**Proof gaps.** Static only; preserve committed-dispute and active kill-period prerequisites.

**Fix handoff (proposed, not implemented):** Reject zero targets and require a nonzero verdict that matches both the proof target and the dispute's disputer before killing. Preserve the preconditions and limits above. Required regression work:

- Submit every invalid dispute proof type with zero target and verify no honest commitment or slash state changes.
- Retain positive tests for valid nonzero fraud verdicts.

Planned permutation, with no mapped test yet: [`REQ-DIS-3-C4KYSF.T1.P22`](../specification/disputes/disputes.md#req-dis-3-c4kysf.t1.p22). It is a regression obligation, not evidence of a passing test. The fix change maps the exact test.

**Specification / implementation owners:** [fraud-slashing requirements and planned tests](../specification/enforcement/fraud-slashing.md); [DisputeFraudProofFacet source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md). The relevant obligation is that only proven misconduct can slash an honest participant; no new protocol meaning is selected here.

<a id="unbound-snapshot"></a>

## 3. Unlinked previous-state input can falsely slash an honest signer

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 2 · [`FIND-SECURITY-2-J3J60V`](open-findings.md#find-security-2-j3j60v).

Source identity: `csf_dc2174473e0ce47f18083689`; rule `unbound-snapshot`; occurrence `occ_a309c1b71540c059223ff617`.

**Current evidence and path.** The early fork mismatch still returns a valid signer verdict before binding the supplied previous snapshot to the signed block. An external caller holding an honest signed block can supply a different-fork previous snapshot and target its eligible signer through the routed applyFraudProofs entrypoint.

**Locations:** [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:109–145](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L109-L145); [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:11–27](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L11-L27).

**Boundary:** any chain account, through the routed `applyFraudProofs` entrypoint. The only material needed is one honest signed block, which every channel peer and spectator receives. Ranking class: unauthenticated on-chain path.

**Counterevidence and limits.** The channel check and signer recovery remain, but neither authenticates the caller-supplied previous snapshot. Target eligibility is required.

**Proof gaps.** Static only; no asset-transfer claim.

**Fix handoff (proposed, not implemented):** Bind the previous snapshot to the signed block's predecessor before interpreting its fields. Unlinked evidence must be rejected, not treated as participant fraud. Preserve the preconditions and limits above. Required regression work:

- An honest block plus arbitrary previous snapshot/fork must never slash its signer.
- Cover genesis and non-genesis predecessor binding and the nested dispute proof route.

Planned permutations, with no mapped test yet: [`INV-ENFFP-1-BGVZN4.T1.P12`](../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p12), [`INV-ENFFP-1-BGVZN4.T1.P13`](../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p13) and [`INV-ENFFP-1-BGVZN4.T1.P15`](../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p15). They are regression obligations, not evidence of passing tests. The fix change maps the exact tests.

**Specification / implementation owners:** [fraud-slashing requirements and planned tests](../specification/enforcement/fraud-slashing.md); [FraudProofFacet source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md). The relevant obligation is that only proven misconduct can slash an honest participant; no new protocol meaning is selected here.

<a id="pruned-inbound"></a>

## 4. Pruned genuine inbound history can falsely slash honest authors

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 3 · [`FIND-SECURITY-3-REDPJW`](open-findings.md#find-security-3-redpjw).

Source identity: `csf_f664a2f1629d842430826ec3`; rule `pruned-inbound`; occurrence `occ_60d59b4ec6fb0b8576e03989`.

**Current evidence and path.** The forged-inbound handler still equates absence from the live map with forgery. Normal snapshot adoption deletes the consumed inbound head and its ancestors. After a later head is adopted, a retained honest signed block containing an earlier genuine head can satisfy the false-fraud verdict.

**Locations:** [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:330–362](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L330-L362); [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol:196–205](../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L196-L205).

**Boundary:** any chain account, through the routed `applyFraudProofs` entrypoint. The only material needed is one retained honest signed block that includes the earlier inbound head. Ranking class: unauthenticated on-chain path.

**Counterevidence and limits.** The current snapshot head is exempt. The attack needs an older pruned head and an author who remains eligible; proof of inclusion and signature authenticity still apply.

**Proof gaps.** Static only; construct the two successive legitimate inbound heads in a future regression test.

**Fix handoff (proposed, not implemented):** Preserve authenticated historical inclusion evidence or constrain proofs with an authenticated history/finality rule. Absence from prunable storage must not prove forgery. Preserve the preconditions and limits above. Required regression work:

- After advancing from genuine inbound A to B and pruning A, a forgery proof using A must not slash its author.
- Keep rejection of genuinely uncommitted inbound blocks with authenticated evidence.

Planned permutation, with no mapped test yet: [`INV-ENFFP-1-BGVZN4.T1.P14`](../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p14). It is a regression obligation, not evidence of a passing test. The fix change maps the exact test.

**Specification / implementation owners:** [fraud-slashing requirements and planned tests](../specification/enforcement/fraud-slashing.md); [FraudProofFacet source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md). The relevant obligation is that only proven misconduct can slash an honest participant; no new protocol meaning is selected here.

<a id="open-deadline"></a>

## 5. Expired opening signatures still authorize channel creation

**Verdict:** `confirmed`, now fixed · **Confidence:** high · **Original severity:** medium · [`FIND-SECURITY-4-02DYWZ`](open-findings.md#find-security-4-02dywz).

**Fix status:** resolved in tree; engineer review pending.

Source identity: `csf_a21953f8b0820513c80b2cad`; rule `open-deadline`; occurrence `occ_3ddb6fa24937a6e8e0ab73a6`.

**Evidence and path.** The proxy opening path verified participant signatures and passed deadlineTimestamp to the consumer deposit path without checking expiry. The SDK cleared the attempt after the signed window. A negotiating peer could retain signatures and later open using the bundled consumer behavior.

**Locations:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol:189–198](../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L189-L198); [src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts:678–718](../../../src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L678-L718); [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol:40–48](../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L40-L48).

**Boundary:** a negotiating counterparty that holds the opening signatures of every listed participant, through the manager's `open` entrypoint. An outsider cannot produce those signatures. Ranking class: on-chain path that needs participant-issued credentials; it has no rank because the path is fixed.

**Counterevidence and limits.** An application consumer may enforce the deadline itself. Bundled asset methods are placeholders, so this report claimed expired channel authorization, not asset theft.

**Proof gaps.** None left for the claim: the direct after-deadline test and the E2E retained-signature test below fail without the fix. The real deployed consumer's asset impact was never assessed and is no longer reachable through a late open.

**Fix (implemented):** the engineer decided on 2026-10-04 that `open` rejects expired terms on chain ([`OQ-SPEC-OPEN-1-12RH7A` (On-chain enforcement of the opening deadline)](../specification/open-questions.md#oq-spec-open-1-12rh7a), now resolved). `open` requires `deadlineTimestamp >= block.timestamp` right after the zero-id and already-open checks, before the balance reset, the signature check and any deposit, and otherwise reverts with the new `RaceConditionOpenChannelExpired(deadline, currentTimestamp)`. The boundary is the join facet's: valid up to and including the deadline. The proxy stays under EIP-170. The SDK decodes the new error from the generated error ABI; the open path classifies only `RaceConditionChannelAlreadyOpen`, so no SDK handling changed. Regression work:

- Direct open before, at and after the deadline.
- Retained opening signatures submitted after SDK expiry are rejected by the contract.

Mapped permutations: [`REQ-ENFADM-4-2NN96F.T1.P1`](../specification/enforcement/admission-and-funds.md#req-enfadm-4-2nn96f.t1.p1), [`REQ-ENFADM-4-2NN96F.T1.P2`](../specification/enforcement/admission-and-funds.md#req-enfadm-4-2nn96f.t1.p2) and [`REQ-ENFADM-4-2NN96F.T1.P3`](../specification/enforcement/admission-and-funds.md#req-enfadm-4-2nn96f.t1.p3) ([proxy open test report](../verification/tests/test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol.md)), and [`REQ-ENFADM-4-2NN96F.T1.P4`](../specification/enforcement/admission-and-funds.md#req-enfadm-4-2nn96f.t1.p4) ([lobby E2E report](../verification/tests/test/e2e/E2E-LobbyMatching.test.ts.md)).

**Owners:** [admission and funds](../specification/enforcement/admission-and-funds.md), [lifecycle](../specification/settlement/lifecycle.md), [proxy source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md). A real consumer's own deadline behavior is no longer load-bearing for this path.

<a id="sync-inbound"></a>

## 6. Peer sync can make an honest node sign fabricated inbound data

**Verdict:** `confirmed`, now fixed · **Confidence:** high · **Original severity:** high · [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx).

**Fix status:** resolved, with one residual limit outside the inbound claim: [`FIND-SYNC-4-KGP4KF`](open-findings.md#find-sync-4-kgp4kf).

Source identity: `csf_237e0d0f589b22bf18c348fb`; rule `sync-inbound`; occurrence `occ_482d7e145268e00610d5142b`.

**Evidence and path.** The linked-window check excluded unrelated windows and did not persist the already-adopted prefix. It still skipped reduction-input validation for a chain-final window that started at the current chain fork and had not yet been adopted. persistSyncPayload stored that remaining window's inboundMessageBlocksAppliedInReduce unconditionally. A fabricated successor could become the local inbound tip and be signed during block production.

**Locations:** [src/rpc/network/services/spectate/SpectateService.ts:266–391](../../../src/rpc/network/services/spectate/SpectateService.ts#L266-L391); [src/rpc/network/services/spectate/SpectateService.ts:555–579](../../../src/rpc/network/services/spectate/SpectateService.ts#L555-L579); [src/rpc/network/services/spectate/SpectateService.ts:1039–1056](../../../src/rpc/network/services/spectate/SpectateService.ts#L1039-L1056); [src/storage/MessageBlockStorage.ts:36–57](../../../src/storage/MessageBlockStorage.ts#L36-L57); [src/stateManager/block/BlockProductionService.ts:57–108](../../../src/stateManager/block/BlockProductionService.ts#L57-L108).

**Boundary:** an authenticated peer that the victim selected as its sync responder, through the spectate sync payload. No Solidity entrypoint was crossed; the victim's node accepted and persisted the payload. Ranking class: peer-assisted signing path; it has no rank because the path is fixed.

**Counterevidence and limits.** Already-adopted prefix windows were omitted. Nonfinal windows executed reduction. The attack needed a finalized-but-unadopted window, a lagging signing participant, and a fabricated successor that passed chain-shape/balance checks. The first fix keyed the drop on the finality read alone, which left two interleavings open: a reduction landing on chain between the finality read and the window fetch, and a window that a concurrent sync had already reduced in the shared local EVM. In both, the local `reduceAndFinalize` returned early without checking the list, and the list was persisted. The current rule closes both. Residual limit, out of scope here: such a window still persists the responder's unchecked `disputeConfirmations` and `latestStateSnapshot`, tracked as [`FIND-SYNC-4-KGP4KF`](open-findings.md#find-sync-4-kgp4kf).

**Related lineage hole (fixed in the same change).** The local `reduceAndFinalize` picks its window from the first dispute's channel and fork and returns early, unchecked, when that window does not exist. A responder could serve an unreduced window whose disputes name a fork with no window; the call then committed nothing and reported false, and the sync advanced to the responder's claimed successor fork with no check. The damage was to fork lineage, not inbound storage. Sync now rejects the payload as a dispute window mismatch unless every dispute names this channel and the window's fork. A dispute naming another fork ([`INV-SYNC-1-XCQZ28.T1.P15`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p15)) and one naming the window's fork under another channel ([`INV-SYNC-1-XCQZ28.T1.P16`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p16)) are each rejected.

**Proof gaps.** None left for the inbound claim: the unit regressions for both interleavings and for the chain-final window fail without the fix, and the E2E regressions show the synced participant signs a block without the injected successor. The residual limit above is unproven either way.

**Fix (implemented):** engineer decisions (2026-10-04, refined 2026-10-05): persist a window's `inboundMessageBlocksAppliedInReduce` only when this sync's own local `reduceAndFinalize` call executed the reduction, so it validated them. The signal is the call's own result: the local diamond emits `DisputeReducedResultCommitted` only when that call commits the reduction, and an early return for an already reduced window emits nothing. persistSyncPayload skips every reduction input of a window final on chain at the finality read (`chainFinalForkIds`), and stores an inbound list only for a window in this sync's `selfReducedForkIds`. So it stores no list for a window reduced on chain between that read and the window fetch, or for one a concurrent sync already reduced in the local EVM. The peer-provided list therefore never enters trusted inbound storage unchecked. The rejected alternative validated the list against the chain's inbound hash chain. The node still gets the genuine inbound blocks of such a window from the `InboundMessagesProcessed` chain events and the event-sync log recovery for missing inbound runs. Block production never walks below the snapshot's inbound head while inbound storage lags it. No contract changed. The regression work covered:

- Changing only a finalized window's ignored inbound list leaves the trusted inbound head unchanged and stores none of the listed blocks.
- The same holds when the reduction lands on chain after the finality read and before the window fetch.
- A window a concurrent sync already reduced locally stores only that sync's genuine blocks, never the forged successor.
- A syncing participant authors and signs a block on the reduced fork, never stores the injected successor, and its block does not carry it, both when its inbound chain event is replayed and when its subscribed log is lost and chain-log recovery delivers the genuine block. The lost-log case checks only the end state: the recovery can run before the sync.
- A window this sync reduces itself with a fabricated successor in its list makes the local reduction revert, so the sync is rejected and nothing is stored.

Mapped permutations: [`INV-SYNC-1-XCQZ28.T1.P11`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p11) and [`INV-SYNC-1-XCQZ28.T1.P14`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p14) ([E2E-Spectate report](../verification/tests/test/e2e/E2E-Spectate.test.ts.md)). The storage-only case, both interleavings, and the locally reduced positive case are component permutations in the [SpectateService unit report](../verification/tests/test/unit/SpectateService.test.ts.md).

**Owners:** [synchronization requirements and planned tests](../specification/peer-communication/synchronization.md), [SpectateService source report](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md), [current sync test mapping](../verification/tests/test/unit/SpectateService.test.ts.md). The tip-promotion component also relates to [`FIND-STORAGE-2-NK2XBF`](open-findings.md#find-storage-2-nk2xbf); this report preserves the distinct end-to-end sync-to-signing claim.

<a id="sync-genesis-time"></a>

## 7. Supplied genesis timestamp and downstream use

**Current assessment:** open; impact requires recheck with the trusted-start walk.
Original finding: confirmed, high severity, rank 4;
[`FIND-SECURITY-6-884TAJ`](open-findings.md#find-security-6-884taj).
Source identity: `csf_01e69b761bddfdcbeac64472`; rule `sync-genesis-time`; occurrence `occ_0c51cce0dbb06ddacb658c01`.

The trusted walk now selects canonical final state. The prior `isSameForkRegression` helper is
removed and cannot support a current exploit argument. The payload's supplied genesis snapshot
is still stored by [SpectateService](../../../src/rpc/network/services/spectate/SpectateService.ts#L1058).
Trace every downstream consumer before deciding whether a timestamp-only mutation can affect
first-block production or another trusted state path. This review does not establish full resolution.

Remaining verification covers same-fork empty proofs before block zero and reduced-genesis
canonical time, with the relevant stored snapshot and first-block commitment observed. If an
unauthenticated timestamp can reach a trusted consumer, its binding to chain or reduction history
still needs correction. No new behavior is selected here.

Tracked regressions:
[`INV-SYNC-1-XCQZ28.T1.P12`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p12)
and [`INV-SYNC-1-XCQZ28.T1.P13`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p13).
These are obligations, not passing-test claims. Owners are the
[SpectateService report](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md)
and [synchronization](../specification/peer-communication/synchronization.md).
