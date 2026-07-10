// Dispute construction & upload - subsystem domain (test/SUBSYSTEMS.md §1).
// Seam: DisputeManager.dispute / constructDispute / getAuditingData.
//
// The assertable upload boundary is the TRANSACTION, before any peer audits:
// entrypoint choice, multicall composition, construction-time struct
// contents, and upload reverts. Anything asserting "a validator rejects
// this" is a dispute-validation test wearing a different hat (see
// test/unit/DOMAIN_REVIEW.md §c).
//
// Not axes of this seam (reviewed against constructDispute):
// - proof carrier (genesis/signedblocks/milestones) is an INPUT from
//   AgreementManager.getStateProof, not a construction branch - it's a setup
//   precondition of the cells below.
// - "linked / not-linked" has no construction branch (honest construction
//   always links); it lives in dispute-validation's stateProof variants.
// - "signature mode" has no branch anywhere in DisputeManager; it's the
//   agreement-manager's signatureCollection.

import { defineDomain, product, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "dispute-upload",
    matrices: {
        // the two real construction branches (DisputeManager.dispute):
        // entrypoint is derived - uploadDisputeWithCalldata <=>
        // !isLastMilestoneFinalByEveryone; multicall wraps applyFraudProofs
        // when local fraud proofs are pending
        uploadSpace: product({
            desc: "upload entrypoint x multicall composition, asserted on the tx/event before any audit",
            axes: {
                entrypoint: ["uploadDispute", "uploadDisputeWithCalldata"],
                multicall: ["none", "withFraudProofs"]
            }
        }),

        upload: variants({
            desc: "independent upload-path branches",
            fields: {
                timeoutStruct: ["absent", "present"],
                selfRemoval: ["false", "true"],
                uploadRevert: [
                    "clean",
                    "ErrorCantParticipateInDispute",
                    "ErrorDisputerNotMsgSender",
                    "RaceConditionDisputeEvidencePeriodExpired",
                    "ErrorDisputeThrottled",
                    "ErrorDisputeAlreadyPosted",
                    "ErrorDisputePostedAuditingDataMismatch",
                    "ErrorAuditingDataHashMismatch"
                ]
                // no auditingData full/partial field: constructDispute THROWS
                // on partial auditing data before uploading - a peer never
                // uploads it; the tampered-calldata cases are
                // dispute-validation's disputeAuditingData variants
            }
        }),

        // how the uploaded dispute's state proof is ASSEMBLED -
        // AgreementManager.getStateProof / tryBuildMilestone, driven directly
        // via query.buildStateProof (snapshot posting shares this builder).
        // Folded here from the retired agreement-manager domain: domains are
        // processes, not files, and the boss's own axis list put signature
        // mode under the dispute process.
        stateProofAssembly: variants({
            desc: "getStateProof / tryBuildMilestone assembly semantics",
            fields: {
                // change points spanned (getChangePointsInRange): one
                // finality milestone per point, early-break when finality
                // can't be proven
                participantChangePoints: ["zero", "one", "two-plus"],
                // how a milestone's threshold was met (tryBuildMilestone):
                // direct-one-block = one fully-signed block covers it
                // (blockConfirmations.length == 1) · virtual-voting =
                // signatures collected across blocks (length > 1)
                signatureCollection: ["direct-one-block", "virtual-voting"],
                // the union getMilestoneThresholdSigners builds: previous ∪
                // resulting participants - with-leaver = leaver's signature
                // still counts toward the milestone that removed it
                thresholdUnion: ["with-leaver", "with-joiner", "unchanged"]
            }
        })
    }
});

export const covers = domain.covers;
