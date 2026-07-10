import { DisputeFraudProofType } from "../../../src/types/sol-enums";
import { defineDomain, product, variants } from "../framework/domain";

// `satisfies` keeps the literal tuple for typing while compile-checking every
// name against the real enum - no .sol parsing, no drift.
const DISPUTE_FRAUD_PROOF_TYPES = [
    "DisputeNotLatestState",
    "DisputeInvalidOutputState",
    "DisputeInvalidStateProof",
    "DisputeInvalidBalanceInvariant",
    "DisputeOnChainSlashesNotSubset",
    "TimeoutThreshold",
    "TimeoutCalldataPosted",
    "TimeoutNotLinkedToLatestState",
    "TimeoutParticipantNotNext",
    "TimeoutTooEarly",
    "DisputeInvalidBlockInStateProofApplyFraudProof",
    "DisputeLastMilestoneNotFinalAndNoAuditingData",
    "InvalidDisputeReason",
    "DisputeStateProofHeaderMismatch",
    "DisputeInboundHashNotInChain"
] as const satisfies readonly (keyof typeof DisputeFraudProofType)[];

export const domain = defineDomain({
    subsystem: "dispute-validation",
    matrices: {
        dispute: variants({
            desc: "Dispute struct (the on-chain envelope)",
            fields: {
                // a MISMATCHED flag reverts at upload
                // (ErrorDisputePostedAuditingDataMismatch) - a validator never
                // sees it; that cell lives in dispute-upload's uploadRevert
                postedAuditingData: ["true", "false"],
                // omits-removal = output that drops a claimed slash/removal
                outputSnapshotDataHash: [
                    "valid",
                    "random",
                    "stale",
                    "omits-removal"
                ]
            }
        }),

        disputeInput: variants({
            desc: "DisputeInput fields (the disputer's claim)",
            fields: {
                // wrong = nonexistent channel · cross-channel = a real other channel the disputer is in
                channelId: ["valid", "wrong", "cross-channel"],
                // unlinked = forkId != keccak(genesisData) · input-only-junk = junk in the input field only · uniform-junk = junk in input + all proof headers · cross-fork = a different real fork's id
                forkId: [
                    "valid",
                    "unlinked",
                    "input-only-junk",
                    "uniform-junk",
                    "cross-fork"
                ],
                latestStateSnapshotHash: ["valid", "mismatch"],
                // zero-claim = bytes32(0), claims an empty inbound chain
                latestInboundMessageBlockHash: [
                    "in-chain",
                    "not-in-chain",
                    "zero-claim"
                ],
                lastInboundMessageBlockHeight: ["correct", "mismatch"],
                // structure tampers only - the proof's carrier SHAPE
                // (genesis/signedblocks/milestones) is the carrierInteraction
                // matrix, not a stateProof variant
                stateProof: [
                    "valid",
                    // milestones present but the last has 0 blockConfirmations
                    "empty-last-milestone",
                    // both milestones and signedBlocks arrays empty
                    "fully-empty",
                    // proof's latest block below the disputer's real latest signed block
                    "truncated-below-latest",
                    // milestones and signedBlocks both non-empty (invalid shape)
                    "both-arrays-present",
                    // a signedBlock.encodedBlock that fails to abi.decode
                    "undecodable-block",
                    // a block header's channelId/forkId doesn't match the dispute
                    "header-mismatch",
                    // a correctly-headered block injected above the honest tip
                    "block-injection",
                    // milestone block content doesn't match the committed milestone snapshot
                    "milestone-block-content",
                    // a signedBlock signature that doesn't recover to its header author
                    "invalid-block-signature",
                    // signedBlocks[0].transactionCnt != 0 (not anchored at genesis height 0)
                    "first-block-nonzero-height",
                    // signedBlocks[0].previousBlockHash != the genesis anchor
                    "first-block-wrong-anchor"
                ],
                // non-subset = an address not in the on-chain slashed set · not-in-snapshot = an address not in latestStateSnapshot.participants · oversized = more than maxSlashCount distinct addresses
                onChainSlashes: [
                    "valid",
                    "empty",
                    "non-subset",
                    "not-in-snapshot",
                    "oversized"
                ],
                // linked = hash matches the provided auditing data · tampered = disputer's hash != its own calldata (upload revert, see unreachable) · tampered-no-calldata = hash tampered but the dispute was posted WITHOUT calldata, so only the validator can catch it · proof-mismatch = a fraud prover's reference auditing data != the committed hash
                disputeAuditingDataHash: [
                    "linked",
                    "tampered",
                    "tampered-no-calldata",
                    "proof-mismatch"
                ],
                disputer: [
                    "participant",
                    "non-participant",
                    "mismatched-sender"
                ],
                timeout: ["absent", "present"],
                selfRemoval: ["false", "true"]
            },
            unreachable: [
                {
                    field: "channelId",
                    option: "wrong",
                    reason: "reverts at upload (ErrorCantParticipateInDispute) - a validator never audits it; dispute-upload's uploadRevert owns the cell"
                },
                {
                    field: "disputer",
                    option: "mismatched-sender",
                    reason: "reverts at upload (ErrorDisputerNotMsgSender) - a validator never audits it; dispute-upload's uploadRevert owns the cell"
                },
                {
                    field: "disputeAuditingDataHash",
                    option: "tampered",
                    reason: "reverts at upload (ErrorAuditingDataHashMismatch, with-calldata path) - a validator never audits it; dispute-upload's uploadRevert owns the cell"
                }
            ]
        }),

        timeout: variants({
            desc: "Timeout struct (inside a timeout dispute)",
            fields: {
                participant: ["next-writer", "not-next-writer"],
                // mismatch = not latest+1 · zero = genesis boundary (the height-1 race check underflows) · finalized-block = latest+1 but already fully signed
                blockHeight: ["valid", "mismatch", "zero", "finalized-block"],
                // too-early = posted before the timeout window opens
                minTimeStamp: ["after-wait", "too-early"],
                // true = forced timeout that skips race checks
                isForced: ["false", "true"],
                previousBlockProducer: ["unset", "set"],
                // false = claims calldata not posted when it actually was
                previousBlockProducerPostedCalldata: ["true", "false"],
                participantSignatureOnPreviousBlock: [
                    "present",
                    "absent",
                    "present-but-forged"
                ]
            }
        }),

        // SnapshotData tampers the snapshot FACET accepts - the post succeeds
        // on-chain and the fault is caught downstream by dispute/reduce, so
        // the audit is this subsystem's behavior. Post-time REJECTS live in
        // snapshot-upload (its facet-enforced snapshotData matrix).
        snapshotData: variants({
            desc: "posted-snapshot tampers caught downstream by dispute, not by the post",
            fields: {
                // the facet does not validate the hash - it commits; caught via dispute
                stateMachineStateHash: ["match", "mismatch"],
                // omitted = a participant dropped · injected = an extra added;
                // no per-participant validation at post time
                participants: ["valid", "omitted", "injected"],
                // = SnapshotData.latestInboundMessageBlockHash; named apart
                // from disputeInput's field of the same name (flat covers()
                // keys must be unambiguous within the domain)
                snapshotInboundHead: ["valid", "not-in-chain"],
                // below the real on-chain withdrawals (inflated-vs-deposits is
                // the post-time CantWithdrawMoreThanDeposits revert, owned by
                // snapshot-upload)
                totalWithdrawals: ["valid", "deflated"]
                // totalDeposits has no cell anywhere: deposits are resolved
                // on-chain (_resolveTotalDeposits), not a settable field
            }
        }),

        disputeAuditingData: variants({
            desc: "DisputeAuditingData calldata (hash matches, content wrong - a top-level hash mismatch is caught at upload)",
            fields: {
                // length-mismatch = non-empty but count != the number of milestone proofs
                milestoneSnapshots: [
                    "valid",
                    "inbound-divergent",
                    "wrong-snapshot",
                    "participants-omitted",
                    "empty",
                    "length-mismatch"
                ],
                // mismatch = doesn't hash to dispute.input.latestStateSnapshotHash
                latestStateSnapshot: ["valid", "mismatch"]
                // latestFinalizedStateStateMachineState / inboundMessageBlocks /
                // outboundMessageBlocks are not read by any dispute validator -
                // no variants apply
            }
        }),

        proofTypes: variants({
            desc: "every dispute-kill enum member asserted by at least one test (block-level fraud proofs live in block-confirmation)",
            fields: {
                proofType: DISPUTE_FRAUD_PROOF_TYPES
            }
        }),

        // the REJECTION direction of the kill-proof handlers: a byzantine
        // peer submits a corrupted DisputeFraudProof against a VALID dispute -
        // the on-chain handler must reject it and slash the SUBMITTER, never
        // the honest disputer (attacker-pays). One cell per handler with a
        // tested rejection path. (The kill direction is `proofType` above.)
        killProofRejection: variants({
            desc: "DisputeFraudProofFacet handlers rejecting corrupted kill proofs (submitter slashed)",
            fields: {
                bogusKillProof: DISPUTE_FRAUD_PROOF_TYPES
            }
        }),

        // the killing auditor's local state when it fires the fraud proof.
        // synced is the DEFAULT context of every test and carries no
        // information as a cell - only the deviation is tracked: tag
        // auditor only when the auditor is disconnected with stale local
        // data and must catch the fraud via on-chain events.
        auditor: variants({
            desc: "auditor-state deviation (synced is the untracked default)",
            fields: {
                auditor: ["disconnected-stale"]
            }
        }),

        // per-proof carrier shape: only handlers that actually branch on the
        // carrier are listed. Where the old grid grouped two carriers as
        // equivalent (the handler doesn't branch between them), the
        // non-canonical member is unreachable with the equivalence as reason -
        // if migration (PR 2) finds a test on the other member, flip the
        // canonical rather than writing a redundant test.
        // TODO(review): the equivalence prunes below are ported prose claims -
        // each needs a file:line into DisputeFraudProofFacet.sol proving
        // path-identity before it can be trusted (DOMAIN_REVIEW.md action 11).
        carrierInteraction: product({
            desc: "dispute-kill handlers exercised per state-proof carrier shape",
            axes: {
                proofType: [
                    "DisputeInvalidStateProof",
                    "DisputeInvalidBlockInStateProofApplyFraudProof",
                    "DisputeStateProofHeaderMismatch",
                    "DisputeLastMilestoneNotFinalAndNoAuditingData",
                    "DisputeInvalidBalanceInvariant",
                    "DisputeNotLatestState",
                    "DisputeInvalidOutputState",
                    "InvalidDisputeReason",
                    "TimeoutThreshold",
                    "TimeoutCalldataPosted",
                    "TimeoutNotLinkedToLatestState",
                    "TimeoutParticipantNotNext",
                    "TimeoutTooEarly"
                ],
                // what the disputed state proof contains - genesis (empty
                // proof, disputer at fork genesis) · signedblocks-only ·
                // milestones-only. "both arrays" is an invalid shape, not a
                // carrier (see disputeInput.stateProof:both-arrays-present)
                carrier: ["genesis", "signedblocks", "milestones"]
            },
            unreachable: [
                {
                    match: {
                        proofType:
                            "DisputeInvalidBlockInStateProofApplyFraudProof",
                        carrier: "genesis"
                    },
                    reason: "a genesis-only proof has no unfinalized block to apply the fraud proof to"
                },
                {
                    match: {
                        proofType: "DisputeStateProofHeaderMismatch",
                        carrier: "genesis"
                    },
                    reason: "vacuous - _hasStateProofHeaderMismatch has no arrays to scan"
                },
                {
                    match: {
                        proofType:
                            "DisputeLastMilestoneNotFinalAndNoAuditingData",
                        carrier: "genesis"
                    },
                    reason: "_isLastMilestoneFinalByEveryone no-ops (returns true) without milestones"
                },
                {
                    match: {
                        proofType:
                            "DisputeLastMilestoneNotFinalAndNoAuditingData",
                        carrier: "signedblocks"
                    },
                    reason: "_isLastMilestoneFinalByEveryone no-ops (returns true) without milestones"
                },
                {
                    // canonical: signedblocks (genesis carriers need awkward
                    // setups; the balanceInvariant test covers the required
                    // milestones member of this row)
                    match: {
                        proofType: "DisputeInvalidBalanceInvariant",
                        carrier: "genesis"
                    },
                    reason: "equivalent to signedblocks - both hit the forkId == hash(snapshot) branch"
                },
                {
                    // (the notLatestState test covers this row's GENESIS cell -
                    // its truncation empties the proof entirely)
                    match: {
                        proofType: "DisputeNotLatestState",
                        carrier: "milestones"
                    },
                    reason: "equivalent to signedblocks - identical path after _getLatestBlock"
                },
                {
                    // canonical flipped during migration: the outputState test
                    // runs on a milestones carrier (verified by
                    // expectMilestonesOnlyStateProof in the test body)
                    match: {
                        proofType: "DisputeInvalidOutputState",
                        carrier: "signedblocks"
                    },
                    reason: "equivalent to milestones - identical path after _getLatestBlock"
                },
                {
                    match: {
                        proofType: "InvalidDisputeReason",
                        carrier: "milestones"
                    },
                    reason: "equivalent to signedblocks - identical path after _getLatestBlock"
                },
                {
                    match: {
                        proofType: "TimeoutThreshold",
                        carrier: "milestones"
                    },
                    reason: "equivalent to signedblocks - identical path after _getLatestBlock"
                },
                {
                    match: {
                        proofType: "TimeoutCalldataPosted",
                        carrier: "milestones"
                    },
                    reason: "equivalent to signedblocks - identical path after _getLatestBlock"
                },
                {
                    match: {
                        proofType: "TimeoutNotLinkedToLatestState",
                        carrier: "milestones"
                    },
                    reason: "equivalent to signedblocks - identical path after _getLatestBlock"
                },
                {
                    match: {
                        proofType: "TimeoutParticipantNotNext",
                        carrier: "milestones"
                    },
                    reason: "equivalent to signedblocks - identical path after _getLatestBlock"
                },
                {
                    match: {
                        proofType: "TimeoutTooEarly",
                        carrier: "milestones"
                    },
                    reason: "equivalent to signedblocks - identical path after _getLatestBlock"
                }
            ]
        }),

        // only two handlers branch on whether auditing-data calldata was
        // posted with the dispute. The axis IS the envelope flag
        // (postedAuditingData) - no separate "calldata" name: a test claiming
        // proofType + postedAuditingData completes this product automatically
        calldataInteraction: product({
            desc: "dispute-kill handlers that branch on posted auditing-data calldata",
            axes: {
                proofType: [
                    "DisputeInvalidStateProof",
                    "DisputeLastMilestoneNotFinalAndNoAuditingData"
                ],
                postedAuditingData: ["true", "false"]
            },
            unreachable: [
                {
                    match: {
                        proofType:
                            "DisputeLastMilestoneNotFinalAndNoAuditingData",
                        postedAuditingData: "true"
                    },
                    reason: "the proof's premise is that no auditing data was posted"
                }
            ]
        })
    }
});

export const covers = domain.covers;
