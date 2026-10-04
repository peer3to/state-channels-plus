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
| `open-deadline`     | confirmed      | medium            | 6          | [Expired opening signatures still authorize channel creation](#open-deadline) · [`FIND-SECURITY-4-02DYWZ`](open-findings.md#find-security-4-02dywz)               |
| `sync-inbound`      | confirmed      | high              | 5          | [Peer sync can make an honest node sign fabricated inbound data](#sync-inbound) · [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx)             |
| `sync-genesis-time` | confirmed      | high              | 4          | [Peer sync can replace genesis time and induce a slashable first block](#sync-genesis-time) · [`FIND-SECURITY-6-884TAJ`](open-findings.md#find-security-6-884taj) |

Ranks are unique within the confirmed queue and follow the class that each item's Boundary paragraph names:

- **Unauthenticated on-chain paths (ranks 1–3):** any chain account can use them.
- **Peer-assisted signing paths (ranks 4–5):** the attacker must be the sync responder that the victim selected.
- **On-chain path that needs participant-issued credentials (rank 6):** only a counterparty that holds every participant's opening signatures can use it, and its original severity is medium.

The fixed item has no rank. All 7 protocol inputs are retained here, including the fixed claim.

<a id="milestone-skip"></a>

## 1. Skipped milestones allow unsigned channel snapshot replacement

**Verdict:** `not_actionable` · **Confidence:** high · **Original severity:** high.

Source identity: `csf_8a972993ab889a6f4a696895`; rule `milestone-skip`; occurrence `occ_cad859aa82ba1b122a359989`.

**Current evidence and path.** The exact all-skipped replacement is fixed. A same-fork snapshot update now needs the one state-proof walk to be valid and the walk's finalized snapshot to equal the new snapshot; the snapshot must also be newer than the on-chain one, so only a threshold-proven milestone can supply it. A proof whose milestones are all dropped below the on-chain snapshot finalizes only the on-chain snapshot, so it cannot replace it. updateStateSnapshotSameFork separately requires a newer snapshot. Empty proofs cannot bypass the nonempty-snapshot check.

**Locations:** [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol:139–157](../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L140-L158); [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol:54–77](../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L54-L77); [test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol:167–183](../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L167-L183); [test/unit/SpectateService.test.ts:549–565](../../../test/unit/SpectateService.test.ts#L549-L565).

**Boundary:** any chain account, with no credential, through the routed `updateStateSnapshotSameFork` entrypoint. Ranking class: unauthenticated on-chain path; it has no rank because the path is fixed.

**Counterevidence and limits.** A proof that only holds the on-chain snapshot proves no threshold point and is refused; it never confirms or replaces the snapshot.

**Proof gaps.** No runtime re-execution. The routed-diamond regression test and sync regression test were read, not run.

**Next step:** no new fix for this exact claim. The existing [`FIND-MILESTONE-1-DAGAX5`](open-findings.md#find-milestone-1-dagax5) owns the resolution. Its routed-diamond and sync regression bodies cover the forged newer snapshot rejection; this reassessment did not run them.

<a id="zero-verdict"></a>

## 2. A zero proof target lets outsiders kill honest disputes

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 1 · [`FIND-SECURITY-1-6SAJ4E`](open-findings.md#find-security-1-6saj4e).

Source identity: `csf_623195021241d901f52c336c`; rule `zero-verdict`; occurrence `occ_0fa37f9753be82684d5eaa47`.

**Current evidence and path.** The zero-sentinel equality is unchanged. Any chain caller can submit a committed honest dispute during its kill period, choose a proof handler that returns zero for invalid evidence, and declare participant zero. The success branch delegates to killDispute, which slashes the real disputer and removes its commitment.

**Locations:** [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol:17–35](../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L17-L35); [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol:118–128](../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L118-L128); [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol:529–557](../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L530-L558).

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

**Locations:** [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:330–362](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L333-L365); [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol:196–205](../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L197-L206).

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

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** medium · **confirmed rank:** 6 · [`FIND-SECURITY-4-02DYWZ`](open-findings.md#find-security-4-02dywz).

Source identity: `csf_a21953f8b0820513c80b2cad`; rule `open-deadline`; occurrence `occ_3ddb6fa24937a6e8e0ab73a6`.

**Current evidence and path.** The proxy opening path is unchanged: it verifies participant signatures and passes deadlineTimestamp to the consumer deposit path without checking expiry. The SDK clears the attempt after the signed window. A negotiating peer can retain signatures and later open using the bundled consumer behavior.

**Locations:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol:218–238](../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L219-L239); [src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts:679–718](../../../src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L679-L718); [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol:40–48](../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L40-L48).

**Boundary:** a negotiating counterparty that holds the opening signatures of every listed participant, through the manager's `open` entrypoint. An outsider cannot produce those signatures. Ranking class: on-chain path that needs participant-issued credentials.

**Counterevidence and limits.** An application consumer may enforce the deadline itself. Bundled asset methods are placeholders, so this report claims expired channel authorization, not asset theft.

**Proof gaps.** Static only; check the real deployed consumer before assigning asset impact.

**Fix handoff (proposed, not implemented):** Enforce `OpenChannel.deadlineTimestamp` in `open` before deposits or state changes, consistently with the direct join deadline check. Preserve the preconditions and limits above. Required regression work:

- Test direct open before, at and after deadline.
- Submit retained opening signatures after SDK expiry and verify the contract rejects them.

No requirement states that `open` must reject expired terms, so these cases have no planned permutation yet. [`OQ-SPEC-OPEN-1-12RH7A` (On-chain enforcement of the opening deadline)](../specification/open-questions.md#oq-spec-open-1-12rh7a) asks the engineer for that rule. The requirement and its permutations follow the decision.

**Owners:** [admission and funds](../specification/enforcement/admission-and-funds.md), [lifecycle](../specification/settlement/lifecycle.md), [proxy source report](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md). Keep the real consumer's deadline behavior explicit.

<a id="sync-inbound"></a>

## 6. Peer sync can make an honest node sign fabricated inbound data

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 5 · [`FIND-SECURITY-5-1KP5YX`](open-findings.md#find-security-5-1kp5yx).

Source identity: `csf_237e0d0f589b22bf18c348fb`; rule `sync-inbound`; occurrence `occ_482d7e145268e00610d5142b`.

**Current evidence and path.** The new linked-window check excludes unrelated windows and does not persist the already-adopted prefix. It still skips reduction-input validation for a chain-final window that starts at the current chain fork and has not yet been adopted. persistSyncPayload stores that remaining window's inboundMessageBlocksAppliedInReduce unconditionally. A fabricated successor can become the local inbound tip and be signed during block production.

**Locations:** [src/rpc/network/services/spectate/SpectateService.ts:241–329](../../../src/rpc/network/services/spectate/SpectateService.ts#L241-L329); [src/rpc/network/services/spectate/SpectateService.ts:488–501](../../../src/rpc/network/services/spectate/SpectateService.ts#L505-L518); [src/rpc/network/services/spectate/SpectateService.ts:967–978](../../../src/rpc/network/services/spectate/SpectateService.ts#L980-L991); [src/storage/MessageBlockStorage.ts:36–57](../../../src/storage/MessageBlockStorage.ts#L36-L57); [src/stateManager/block/BlockProductionService.ts:57–108](../../../src/stateManager/block/BlockProductionService.ts#L57-L108).

**Boundary:** an authenticated peer that the victim selected as its sync responder, through the spectate sync payload. No Solidity entrypoint is crossed; the victim's node accepts and persists the payload. Ranking class: peer-assisted signing path.

**Counterevidence and limits.** Already-adopted prefix windows are now omitted. Nonfinal windows execute reduction. The surviving attack needs a finalized-but-unadopted window, a lagging signing participant, and a fabricated successor that passes chain-shape/balance checks.

**Proof gaps.** Static only; runtime regression must exercise the finalized-but-unadopted branch, not the now-excluded prefix.

**Fix handoff (proposed, not implemented):** Do not persist unused peer-provided reduction inputs from finalized windows. Reconstruct authoritative chain data or validate each object before it enters trusted inbound storage. Preserve the preconditions and limits above. Required regression work:

- Change only a finalized window's ignored inbound list and assert no trusted head changes.
- Verify a syncing participant never signs the injected successor.

Planned permutation, with no mapped test yet: [`INV-SYNC-1-XCQZ28.T1.P11`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p11). It is a regression obligation, not evidence of a passing test. The fix change maps the exact test.

**Owners:** [synchronization requirements and planned tests](../specification/peer-communication/synchronization.md), [SpectateService source report](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md), [current sync test mapping](../verification/tests/test/unit/SpectateService.test.ts.md). The tip-promotion component also relates to [`FIND-STORAGE-2-NK2XBF`](open-findings.md#find-storage-2-nk2xbf); this report preserves the distinct end-to-end sync-to-signing claim.

<a id="sync-genesis-time"></a>

## 7. Peer sync can replace genesis time and induce a slashable first block

**Verdict:** `confirmed` · **Confidence:** high · **Original severity:** high · **confirmed rank:** 4 · [`FIND-SECURITY-6-884TAJ`](open-findings.md#find-security-6-884taj).

Source identity: `csf_01e69b761bddfdcbeac64472`; rule `sync-genesis-time`; occurrence `occ_0c51cce0dbb06ddacb658c01`.

**Current evidence and path.** The new isSameForkRegression check does not close the timestamp-only case. UtilityFacet.isSnapshotNewer returns true for two different height-zero snapshots when the current one is genesis. Time-blind genesis validation and an empty milestone proof then pass; persistence stores the altered genesis. First-block production hashes that snapshot, while WrongGenesis compares the full on-chain genesis hash.

**Locations:** [src/rpc/network/services/spectate/SpectateService.ts:332–366](../../../src/rpc/network/services/spectate/SpectateService.ts#L332-L373); [src/rpc/network/services/spectate/SpectateService.ts:1079–1095](../../../src/rpc/network/services/spectate/SpectateService.ts#L1127-L1143); [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol:268–284](../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L268-L284); [src/rpc/network/services/spectate/SpectateService.ts:979–988](../../../src/rpc/network/services/spectate/SpectateService.ts#L992-L1001); [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol:294–299](../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L297-L302).

**Boundary:** an authenticated peer that the victim selected as its sync responder, through the spectate sync payload. No Solidity entrypoint is crossed; the victim's node accepts and persists the payload. Ranking class: peer-assisted signing path.

**Counterevidence and limits.** An advanced chain snapshot or already-stored block zero blocks the simple case. The victim must sync before its first block, with otherwise correct genesis data. The old report's multicall explanation is obsolete: that helper was removed.

**Proof gaps.** Static only; test a timestamp-only mutation against the new regression helper.

**Fix handoff (proposed, not implemented):** Bind the full genesis snapshot, including timestamp, to authoritative chain state or authenticated reduction history before persistence. Preserve the preconditions and limits above. Required regression work:

- Reject same-fork genesis sync with only timestamp changed.
- Cover empty proofs before block zero and reduced-genesis canonical timestamp.

Planned permutations, with no mapped test yet: [`INV-SYNC-1-XCQZ28.T1.P12`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p12) and [`INV-SYNC-1-XCQZ28.T1.P13`](../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28.t1.p13). They are regression obligations, not evidence of passing tests. The fix change maps the exact tests.

**Owners:** [synchronization requirements and planned tests](../specification/peer-communication/synchronization.md), [SpectateService source report](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md), [current sync test mapping](../verification/tests/test/unit/SpectateService.test.ts.md). The new regression helper is not a full genesis authentication check.
