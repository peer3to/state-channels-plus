// Block confirmation pipeline, StateManager.onBlockConfirmation under each validation strategy.
//
// The struct matrices are the DRIVERS (concrete corruptions a test builds
// and ingests); the reactions product is the OUTCOME space (which strategy
// hook fires and what it does).

import { FraudProofType } from "../../../src/types/sol-enums";
import { defineDomain, product, variants } from "../framework/domain";

// `satisfies` keeps the literal tuple for typing while compile-checking every
// name against the real enum - no .sol parsing, no drift.
const FRAUD_PROOF_TYPES = [
    "BlockDoubleSign",
    "BlockInvalidStateTransition",
    "WrongGenesis",
    "InvalidTimestamp",
    "ForgedInboundMessageBlock"
] as const satisfies readonly (keyof typeof FraudProofType)[];

export const domain = defineDomain({
    subsystem: "block-confirmation",
    matrices: {
        // strategy x hook: every reachable pair needs a test asserting that
        // strategy's reaction (queue / disconnect / fraud-proof + dispute /
        // continue). CalldataCommitted cells marked unreachable are negative
        // invariants - the strategy THROWS "should not be called"; assert
        // that in a dedicated invariant test, not as coverage cells.
        reactions: product({
            desc: "validation-strategy reaction per fault hook",
            axes: {
                strategy: [
                    "block-validation",
                    "spectating",
                    "dispute-validation",
                    "calldata-committed"
                ],
                hook: [
                    "authenticateBlockFailed",
                    "wrongChannel",
                    "channelNotOpened",
                    "blockAuthorIsNotParticipant",
                    "doubleSignDetected",
                    "conflictingButNotLinkedBlockDetected",
                    "wrongGenesisDetected",
                    "blockForkIsDisputed",
                    "blockIsNotNextAndIsInTheFuture",
                    "blockIsNotLinkedAndIsNotFirstBlock",
                    "invalidStateTransitionDetected",
                    "forgedInboundMessageBlockDetected",
                    "notAllSingersAreParticipants"
                ]
            },
            unreachable: [
                {
                    match: {
                        strategy: "calldata-committed",
                        hook: "wrongChannel"
                    },
                    reason: "CalldataCommittedStrategy throws 'should not be called' - a negative invariant, not a reaction"
                },
                {
                    match: {
                        strategy: "calldata-committed",
                        hook: "blockAuthorIsNotParticipant"
                    },
                    reason: "CalldataCommittedStrategy throws 'should not be called' - a negative invariant, not a reaction"
                },
                {
                    match: {
                        strategy: "calldata-committed",
                        hook: "notAllSingersAreParticipants"
                    },
                    reason: "CalldataCommittedStrategy throws 'should not be called' - a negative invariant, not a reaction"
                }
            ]
        }),

        // When a block ARRIVES, how the peer judges its lateness
        // (ValidationService.validateTimeLogic)
        timing: variants({
            desc: "how an arriving block's lateness is judged",
            fields: {
                arrival: [
                    // received within agreementTime of its claimed timestamp -
                    // the normal fast path, no on-chain post needed
                    "in-agreement-window",
                    // received late and not posted on-chain -> not accepted
                    // (NOT_ENOUGH_TIME; the subjective check only applies to
                    // the participating/block-validation strategy)
                    "late-not-posted-rejected",
                    // received late but the author posted it on-chain within
                    // previous + p2pTime + agreementTime + chainFallbackTime
                    // -> accepted on the objective clock
                    "late-posted-in-time-accepted",
                    // posted on-chain AFTER that deadline -> InvalidTimestamp
                    // fraud proof against the author
                    "posted-too-late-fraud",
                    // the on-chain lookup for the block (or its predecessor)
                    // is still in flight -> defer and requeue (NOT_READY)
                    "onchain-lookup-pending-defer"
                ]
            }
        }),

        // success-path: does the peer sign? (previous ∪ resulting participant
        // union). The other success side effects - gossip, author-self
        // on-chain post scheduling, self-left exit - are owned by their own
        // subsystems (e2e composition / participant-lifecycle).
        success: variants({
            desc: "post-success signing decision",
            fields: {
                shouldSign: ["signs", "skips"]
            }
        }),

        block: variants({
            desc: "Block body (driver matrix)",
            fields: {
                // apply-fails = the STF rejects it · double-signed = author signs two conflicting blocks at one height
                transaction: ["valid", "apply-fails", "double-signed"],
                // mismatch = committed resulting snapshot != the re-run STF output
                stateSnapshotHash: ["valid", "mismatch"],
                // broken-chain = doesn't link to the actual previous block · wrong-genesis = height-0 block links to the wrong genesis snapshot
                previousBlockHash: ["valid", "broken-chain", "wrong-genesis"],
                // forged-inbound = an inbound message block not in the real inbound chain
                messageBlocks: ["valid", "forged-inbound", "broken-chain"]
            }
        }),

        transactionHeader: variants({
            desc: "TransactionHeader of a block (driver matrix)",
            fields: {
                // injected = a block from another channel spliced in
                channelId: ["valid", "injected"],
                // wrong-leader = author isn't the scheduled next writer · non-participant-author = signer outside the channel
                participant: [
                    "valid",
                    "wrong-leader",
                    "non-participant-author"
                ],
                // wrong-genesis = height-0 block's forkId points at the wrong genesis
                forkId: ["valid", "injected", "wrong-genesis"],
                transactionCnt: ["valid", "duplicate", "out-of-order"],
                // out-of-range = too far ahead of the previous block
                timestamp: ["valid", "out-of-range", "before-previous"]
            },
            unreachable: [
                {
                    field: "transactionCnt",
                    option: "duplicate",
                    reason: "not independently reachable - collapses into block.transaction:double-signed"
                },
                {
                    field: "transactionCnt",
                    option: "out-of-order",
                    reason: "not independently reachable - collapses into transactionHeader.participant:wrong-leader"
                },
                {
                    field: "forkId",
                    option: "injected",
                    reason: "no dedicated branch - a mismatched forkId surfaces as not-linked / wrong-genesis handling"
                }
            ]
        }),

        queue: variants({
            desc: "ingest, timeout, merge, and attribution branches",
            fields: {
                // wrong-channel splits by sender: a known sender is cut, an
                // unknown (locally-discovered) one just drops the block
                ingestOutcome: [
                    "not-authentic",
                    "already-stored-merge",
                    "wrong-channel-known-sender",
                    "wrong-channel-unknown-sender",
                    "fork-disputed-clear",
                    "queued"
                ],
                queueTimeoutOutcome: [
                    "fork-disputed-clear",
                    "now-stored-merge",
                    // junk future blocks are free to forge - eviction IS the defense
                    "future-request-sync-evict",
                    "next-execute"
                ],
                signatureMerge: [
                    "fresh-copy",
                    "duplicate-signer",
                    // stray signature stripped, its supplier punished
                    "non-participant-strip",
                    "merged-onchain-timestamp"
                ],
                attribution: [
                    "supplier-punished",
                    "honest-relayer-spared",
                    // nobody to slash: discard block, cut signers
                    "author-outside-union"
                ],
                rescheduleGate: ["within-agreement-time", "beyond"],
                signedBlock: ["valid", "duplicate", "future"]
            }
        }),

        fraudProofAcceptance: variants({
            desc: "each constructed fraud proof accepted on-chain and slashing the author",
            fields: {
                proofType: FRAUD_PROOF_TYPES
            }
        }),

        fraudProofConstruction: variants({
            desc: "construct-from-storage branches of the fraud proofs",
            fields: {
                previousState: ["previous-block", "genesis-snapshot"],
                // InvalidTimestamp only - which evidence anchors the proof
                timestampEvidence: [
                    "author-signed-previous",
                    "previous-onchain-timestamp",
                    "genesis"
                ]
            }
        }),

        blockConfirmation: variants({
            desc: "BlockConfirmation signatures as delivered to a peer (driver matrix)",
            fields: {
                // invalid-signature = doesn't recover to any signer.
                // (the signedBlock duplicate/future variants are QUEUE
                // phenomena - they live in block-queue, as does the
                // merged-on-chain-timestamp merge behavior)
                signatures: [
                    "valid",
                    "non-participant",
                    "invalid-signature",
                    "duplicate"
                ]
            }
        })
    }
});

export const covers = domain.covers;
