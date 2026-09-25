# Disputes — Implementation

> **Specification subject:** [specification/disputes/disputes.md](../../../specification/disputes/disputes.md)

## System design

### Existing-window state contributions

The dispute input carries `requireExistingDisputeWindow` alongside its state proof, timeout,
on-chain slashes and self-removal claim. The upload facet checks a true flag before throttle or
window mutation: the same channel/fork window must exist, be unfinalized and be inside its evidence
period. An absent or closed window produces `RaceConditionDisputeWindowNotOpen`. False keeps the
ordinary admission rules and supplies no reason. The canonical reason validator accepts an admitted
true flag even after another dispute is killed; state, signatures and auditing data remain checked.

Construction starts with false and sets true only when the canonical reason query finds no other
reason. On the specific window-precondition refusal, DisputeManager rolls back the signing marker,
releases its mutex, and asks EventSyncService to recover on-chain slashes through its existing log
recovery. It re-enters ordinary construction only when the observed slash set changed since the
failed construction; it does not assume that every slash is eligible. Unexpected failures escape to
the existing top-level handler, including the detached-error route for background attempts. See
[`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv),
[DisputeManager](../../source/src/disputeManager/DisputeManager.ts.md),
[EventSyncService](../../source/src/stateManager/eventSync/EventSyncService.ts.md), and
[DisputeManagerFacet](../../source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md).

### 4.2 Evidence and kill period (Current semantics)

Both periods use the single `evidenceTime` configuration value
(`getEvidenceTime`, [reference/configuration.md](../operations/configuration.md)):

- **Evidence period** — from window creation; bounds _new dispute submissions_.
- **Kill period** — from the last accepted submission; bounds _challenges to committed disputes_
  and gates reduction. `_isKillPeriodExpired`:
  `now >= lastEvidenceSubmissionTimestamp + evidenceTime`.

`Current:` while the kill period is running, anyone may call `applyDisputeFraudProofs`
([`DisputeFraudProofFacet`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L15))
against committed disputes. Per proof:

- Proof **valid** (handler returns the claimed offender — for every current handler that is the
  dispute's disputer): the dispute commitment is removed from the window and the disputer is added
  to the on-chain slash set (`killDispute` → `DisputeKilled`) ([`REQ-DIS-3-C4KYSF` (An uploaded dispute records its commitment immediately)](../../../specification/disputes/disputes.md#req-dis-3-c4kysf)).
- Proof **invalid**: the submitter (`msg.sender`) is added to the slash set — but only when the
  submitter is itself dispute-eligible.
- A dispute that is no longer committed (already killed, or never uploaded) is skipped as a no-op;
  an expired kill period reverts the batch (`RaceConditionDisputeKillPeriodExpired`).

`killDispute` on `DisputeVerificationFacet` is reachable only through the
`applyDisputeFraudProofs` delegatecall — the proxy does not expose it as an external entry point
([`StateChannelManagerProxy`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L25)).

**Open question:** the intended kill-period rule needs engineer confirmation (who is slashed on a
valid vs. invalid dispute fraud proof, whether an ineligible outsider submitting an invalid proof
should escape penalty, and the exact conditions under which a kill is allowed). The behavior above
is recorded as observed implementation, not settled intent. See also
[fraud-proofs.md §5](../architecture/sdk/dispute-pipeline.md) for the mirrored open question on block fraud proofs.

**Open question:** after all commitments in a window are killed, the window stays open
indefinitely and reduction is impossible until someone posts new evidence
(`reduceAndFinalize` requires a non-empty committed set). Whether an all-killed window should
close, expire, or auto-produce a trivial successor fork is unspecified.

## Migrated concrete material

Implementation entry points:
`DisputeManagerFacet`
(upload), `DisputeVerificationFacet`
(reduction, output computation, kill),
`DisputeFraudProofFacet`
(dispute policing), `StateSnapshotFacet`
(snapshot advancement), shared helpers in
`utils/DisputeUtils.sol`
and `StateChannelCommon`.
On-chain types: `DisputeTypes.sol`,
`ProofTypes.sol`. Off-chain drivers:
`src/disputeManager/DisputeManager.ts`,
`src/stateManager/dispute/DisputeValidationService.ts`,
`src/stateManager/reduction/`. The full off-chain
pipeline is specified in ../sdk/dispute-pipeline.md.
