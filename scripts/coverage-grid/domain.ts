import * as path from "path";
import type { Coord } from "./coord";

export const ECHARTS_CDN =
    "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";

export const ROOT = path.join(__dirname, "../..");
export const TYPES_DIR = path.join(ROOT, "contracts/V1/types");
export const TEST_DIRS = [
    path.join(ROOT, "test/e2e"),
    path.join(ROOT, "test/V1")
];
export const OUT_MD = path.join(ROOT, "test/V1/COVERAGE_GRID.generated.md");
export const OUT_HTML = path.join(ROOT, "test/V1/COVERAGE_GRID.generated.html");

// proof enums whose members tests reference by name (input axis)
export const INPUT_PROOF_ENUMS = ["DisputeFraudProofType", "FraudProofType"];
export const OUTCOME_ENUM = "StateProofVerification";

export const PARTITIONS: Record<string, Record<string, string[]>> = {
    Dispute: {
        // mismatched = flag value contradicts the upload entrypoint used; absent = dispute posted with no auditing-data calldata (flag false)
        postedAuditingData: ["mismatched", "absent"],
        // omits-removal = output that drops a claimed slash/removal
        outputSnapshotDataHash: ["random", "stale", "omits-removal"]
    },
    DisputeInput: {
        // wrong = nonexistent channel; cross-channel = a real other channel the disputer is in
        channelId: ["wrong", "cross-channel"],
        // unlinked = forkId != keccak(genesisData); input-only-junk = junk forkId in the input field only; uniform-junk = junk forkId in input + all proof headers; cross-fork = a different real fork's id
        forkId: ["unlinked", "input-only-junk", "uniform-junk", "cross-fork"],
        latestStateSnapshotHash: ["mismatch"],
        // zero-claim = latestInboundMessageBlockHash is bytes32(0) (claims an empty inbound chain)
        latestInboundMessageBlockHash: [
            "in-chain",
            "not-in-chain",
            "zero-claim"
        ],
        lastInboundMessageBlockHeight: ["correct", "mismatch"],
        // proof structure tampers only; carrier shape is the setup:proof axis
        stateProof: [
            // valid = proof is structurally correct; the fault is in another field
            "valid",
            // empty-last-milestone = milestones present but the last has 0 blockConfirmations
            "empty-last-milestone",
            // fully-empty = both milestones and signedBlocks arrays empty
            "fully-empty",
            // truncated-below-latest = proof's latest block is below the disputer's real latest signed block
            "truncated-below-latest",
            // both-arrays-present = milestones and signedBlocks both non-empty
            "both-arrays-present",
            // undecodable-block = a signedBlock.encodedBlock that fails to abi.decode
            "undecodable-block",
            // header-mismatch = a block header's channelId/forkId doesn't match the dispute
            "header-mismatch",
            // block-injection = a correctly-headered block injected above the honest tip (future block)
            "block-injection",
            // milestone-block-content = milestone block content doesn't match the committed milestone snapshot
            "milestone-block-content",
            // invalid-block-signature = a signedBlock signature that doesn't recover to its header author
            "invalid-block-signature",
            // first-block-nonzero-height = signedBlocks[0].transactionCnt != 0 (not anchored at genesis height 0)
            "first-block-nonzero-height",
            // first-block-wrong-anchor = signedBlocks[0].previousBlockHash != the genesis anchor
            "first-block-wrong-anchor"
        ],
        // empty = no slashes listed; non-subset = an address not in the on-chain slashed set; not-in-snapshot = an address not in latestStateSnapshot.participants; oversized = more than maxSlashCount distinct addresses
        onChainSlashes: ["empty", "non-subset", "not-in-snapshot", "oversized"],
        // linked = hash matches the provided auditing data (valid); tampered = disputer's hash != its own calldata (with-calldata upload); no-calldata = tampered hash but dispute posted without calldata; proof-mismatch = a fraud prover's reference auditing data != the dispute's committed hash
        disputeAuditingDataHash: [
            "linked",
            "tampered",
            "no-calldata",
            "proof-mismatch"
        ],
        disputer: ["participant", "non-participant", "mismatched-sender"],
        timeout: ["absent", "present"],
        selfRemoval: ["false", "true"]
    },
    Timeout: {
        // next-writer = the legitimate next block author (baseline); not-next-writer = a participant who isn't next to write
        participant: ["next-writer", "not-next-writer"],
        // mismatch = height not equal to latest+1; zero = height 0 (genesis boundary; the height-1 race check underflows here); finalized-block = height is latest+1 but that block is already fully signed
        blockHeight: ["mismatch", "zero", "finalized-block"],
        // after-wait = posted after the wait elapsed (baseline); too-early = posted before the timeout window opens
        minTimeStamp: ["after-wait", "too-early"],
        // false = normal timeout subject to race checks (baseline); true = forced timeout that skips race checks
        isForced: ["false", "true"],
        // set = the optional previousBlockProducer field is populated
        previousBlockProducer: ["set"],
        // false = claims calldata not posted when it actually was
        previousBlockProducerPostedCalldata: ["true", "false"],
        // present-but-forged = signature present but doesn't recover to the participant
        participantSignatureOnPreviousBlock: ["present", "present-but-forged"]
    },
    Block: {
        // apply-fails = transaction body the STF rejects (reverts); double-signed = author signs two conflicting blocks at the same height
        transaction: ["apply-fails", "double-signed"],
        // mismatch = block commits to a resulting snapshot that doesn't match the re-run STF output
        stateSnapshotHash: ["mismatch"],
        // broken-chain = doesn't link to the actual previous block; wrong-genesis = height-0 block links to the wrong genesis snapshot
        previousBlockHash: ["broken-chain", "wrong-genesis"],
        // forged-inbound = an inbound message block not in the real inbound chain; broken-chain = inbound message blocks not linked/sequenced
        messageBlocks: ["forged-inbound", "broken-chain"]
    },
    TransactionHeader: {
        // injected = a block from another channel spliced into the proof
        channelId: ["injected"],
        // wrong-leader = author isn't the scheduled next writer; non-participant-author = block signer is outside the channel
        participant: ["wrong-leader", "non-participant-author"],
        // injected = a block from another fork spliced in; wrong-genesis = height-0 block's forkId points to the wrong genesis
        forkId: ["injected", "wrong-genesis"],
        // duplicate = two blocks share a transactionCnt; out-of-order = transactionCnt not sequential
        transactionCnt: ["duplicate", "out-of-order"],
        // out-of-range = too far ahead of the previous block; before-previous = earlier than the previous block
        timestamp: ["out-of-range", "before-previous"]
    },
    BlockConfirmation: {
        // duplicate = the same block confirmation received again; future = a confirmation ahead of its predecessor (queued)
        signedBlock: ["duplicate", "future"],
        // non-participant = a confirmation signature from a non-participant; merged-timestamp = a duplicate confirmation merges its trusted on-chain timestamp; invalid-signature = a signature that doesn't recover to any signer; duplicate = the same signer's signature twice
        signatures: [
            "non-participant",
            "merged-timestamp",
            "invalid-signature",
            "duplicate"
        ]
    },
    SnapshotData: {
        // correct = points at the actual parent (originating) fork (baseline); wrong = self-consistent genesis whose parent fork doesn't exist on-chain
        originForkId: ["correct", "wrong"],
        // match = state hash matches the encoded state (baseline); mismatch = state hash doesn't match
        stateMachineStateHash: ["match", "mismatch"],
        // omitted = a participant dropped from the set; injected = an extra participant added
        participants: ["omitted", "injected"],
        // not-in-chain = inbound head hash not on the real inbound chain
        latestInboundMessageBlockHash: ["not-in-chain"],
        // not-in-chain = outbound head hash not on the real outbound chain
        latestOutboundMessageBlockHash: ["not-in-chain"],
        // mismatch = outbound head height doesn't match the verified outbound sequence
        latestOutboundMessageBlockHeight: ["mismatch"],
        // inflated = claims more deposits than recorded on-chain
        totalDeposits: ["inflated"],
        // deflated = totalWithdrawals below the on-chain withdrawals
        totalWithdrawals: ["inflated", "deflated"]
    },
    // top-level hash is caught at upload (ErrorAuditingDataHashMismatch); here the hash matches but the reconstructed milestone snapshots are wrong
    DisputeAuditingData: {
        // length-mismatch = non-empty but count != the number of milestone proofs
        milestoneSnapshots: [
            "inbound-divergent",
            "wrong-snapshot",
            "participants-omitted",
            "empty",
            "length-mismatch"
        ],
        // mismatch = the calldata snapshot doesn't hash to dispute.input.latestStateSnapshotHash
        latestStateSnapshot: ["mismatch"],
        // not read by any dispute validator, so no fault class applies
        latestFinalizedStateStateMachineState: [],
        inboundMessageBlocks: [],
        outboundMessageBlocks: []
    }
};

export const PARTITIONED_STRUCTS = Object.keys(PARTITIONS);

// submit*Block helper name encodes the tampered surface -> no target tag needed in the test
export const BYZANTINE_TARGET: Record<string, Coord> = {
    submitDoubleSignBlock: {
        struct: "Block",
        field: "transaction",
        cls: "double-signed"
    },
    submitWrongGenesisBlock: {
        struct: "Block",
        field: "previousBlockHash",
        cls: "wrong-genesis"
    },
    submitWrongGenesisForkIdBlock: {
        struct: "TransactionHeader",
        field: "forkId",
        cls: "wrong-genesis"
    },
    submitUnexpectedNextLeaderBlock: {
        struct: "TransactionHeader",
        field: "participant",
        cls: "wrong-leader"
    },
    submitInvalidTimestampBlock: {
        struct: "TransactionHeader",
        field: "timestamp",
        cls: "out-of-range"
    },
    submitBrokenInboundChainBlock: {
        struct: "Block",
        field: "messageBlocks",
        cls: "broken-chain"
    },
    submitBrokenChainBlock: {
        struct: "Block",
        field: "previousBlockHash",
        cls: "broken-chain"
    },
    submitForgedInboundMessageBlock: {
        struct: "Block",
        field: "messageBlocks",
        cls: "forged-inbound"
    },
    submitInvalidTransactionDataBlock: {
        struct: "Block",
        field: "transaction",
        cls: "apply-fails"
    },
    submitInvalidStateTransitionBlock: {
        struct: "Block",
        field: "stateSnapshotHash",
        cls: "mismatch"
    }
};

// per-proof carrier groups — a group is covered if any scenario for that proof hits any member;
// only proofs whose handler actually branches on carrier shape are listed
export const CARRIER_INTERACTION: Record<string, string[][]> = {
    // full 3-way: verifyStateProof / isCorrectLatestState
    DisputeInvalidStateProof: [["genesis"], ["signedblocks"], ["milestones"]],
    // sb-vs-ms: the unfinalized-block source differs; genesis has no unfinalized block to apply to
    DisputeInvalidBlockInStateProofApplyFraudProof: [
        ["signedblocks"],
        ["milestones"]
    ],
    // sb-vs-ms: _hasStateProofHeaderMismatch scans the two arrays in separate loops; genesis vacuous
    DisputeStateProofHeaderMismatch: [["signedblocks"], ["milestones"]],
    // milestones-only: _isLastMilestoneFinalByEveryone no-ops (returns true) without milestones
    DisputeLastMilestoneNotFinalAndNoAuditingData: [["milestones"]],
    // milestones-vs-not: genesis and signedblocks both hit the "forkId == hash(snapshot)" branch
    DisputeInvalidBalanceInvariant: [
        ["genesis", "signedblocks"],
        ["milestones"]
    ],
    // genesis-vs-not: signedblocks and milestones are the identical post-_getLatestBlock path
    DisputeNotLatestState: [["genesis"], ["signedblocks", "milestones"]],
    DisputeInvalidOutputState: [["genesis"], ["signedblocks", "milestones"]],
    InvalidDisputeReason: [["genesis"], ["signedblocks", "milestones"]],
    TimeoutThreshold: [["genesis"], ["signedblocks", "milestones"]],
    TimeoutCalldataPosted: [["genesis"], ["signedblocks", "milestones"]],
    TimeoutNotLinkedToLatestState: [
        ["genesis"],
        ["signedblocks", "milestones"]
    ],
    TimeoutParticipantNotNext: [["genesis"], ["signedblocks", "milestones"]],
    TimeoutTooEarly: [["genesis"], ["signedblocks", "milestones"]]
};

// per-proof calldata groups — only two handlers branch on it
export const CALLDATA_INTERACTION: Record<string, string[][]> = {
    DisputeInvalidStateProof: [["posted"], ["absent"]],
    DisputeLastMilestoneNotFinalAndNoAuditingData: [["absent"]]
};
