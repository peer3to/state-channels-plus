// @spec-test-coverage-ignore: shared factory-built Codec inputs; no executable test behavior
import * as factory from "../factory";
import { Codec, Type } from "@/utils/Codec";
import type { BlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";
import { ethers } from "ethers";

const snapshot = () => factory.stateSnapshot().toStruct();
const signedDispute = () => ({
    encodedDispute: Codec.encode(factory.dispute(), Type.Dispute),
    signature: factory.signature()
});
const auditingData = () => ({
    genesisStateSnapshotData: factory.snapshotData(),
    latestStateSnapshot: snapshot(),
    milestoneSnapshots: [snapshot()],
    latestFinalizedStateStateMachineState: factory.hexString(),
    inboundMessageBlocks: [factory.messageBlock()],
    outboundMessageBlocks: [factory.messageBlock()]
});

export const codecValues = {
    block: () => factory.block().blockStruct,
    blockCommitment: () => ({
        signedBlock: factory.signedBlock(),
        timestamp: 17
    }),
    joinChannel: () => factory.joinChannel(),
    signedJoinChannel: () => ({
        encodedJoinChannel: Codec.encode(
            factory.joinChannel(),
            Type.JoinChannel
        ),
        signature: factory.signature()
    }),
    joinChannelConfirmation: () => ({
        signedJoinChannel: codecValues.signedJoinChannel(),
        signatures: [factory.signature(), factory.signature()]
    }),
    openChannel: () => ({
        channelId: factory.hash(),
        participants: [factory.randomAddress(), factory.randomAddress()],
        balances: [
            { amount: 20n, data: "0x" },
            { amount: 30n, data: factory.hexString(4) }
        ],
        deadlineTimestamp: 41n,
        isAtomic: true,
        data: factory.hexString(3)
    }),
    blockConfirmation: () => factory.blockConfirmation(),
    transaction: () => factory.transaction(),
    dispute: () => factory.dispute(),
    disputeConfirmation: () => ({
        signedDispute: signedDispute(),
        signatures: [factory.signature()]
    }),
    stateSnapshot: snapshot,
    snapshotData: () => factory.snapshotData(),
    joinChannelBlock: () => ({
        previousBlockHash: factory.hash(),
        joinChannels: [factory.joinChannel()]
    }),
    exitChannelBlock: () => ({
        exitChannels: [codecValues.exitChannel()],
        previousBlockHash: factory.hash()
    }),
    exitChannel: () => ({
        participant: factory.randomAddress(),
        balance: { amount: 29n, data: factory.hexString(3) }
    }),
    disputeAuditingData: auditingData,
    messageBlock: () =>
        factory.messageBlock({
            messages: [
                {
                    messageType: factory.hash(),
                    participant: factory.randomAddress(),
                    balance: { amount: 11n, data: "0x" },
                    data: factory.hexString(2)
                }
            ]
        }),
    balance: () => ({ amount: 43n, data: factory.hexString(5) }),
    signedBlock: () => factory.signedBlock(),
    stateProof: () => ({
        milestones: [{ blockConfirmations: [factory.blockConfirmation()] }]
    }),
    syncPayload: () => ({
        disputeWindows: [
            {
                disputeConfirmations: [codecValues.disputeConfirmation()],
                forkId: factory.hash(),
                latestStateSnapshot: snapshot(),
                latestEncodedStateMachineState: factory.hexString(4),
                inboundMessageBlocksAppliedInReduce: [factory.messageBlock()],
                reducedForkId: factory.hash()
            }
        ],
        latestForkGenesisSnapshot: snapshot(),
        latestForkGenesisEncodedState: factory.hexString(4),
        stateProof: codecValues.stateProof(),
        milestoneSnapshots: [snapshot()],
        latestFinalizedEncodedState: factory.hexString(4),
        outboundMessageBlocksUpToLatestGenesis: [factory.messageBlock()],
        outboundMessageBlocksOfTheLatestFork: [factory.messageBlock()],
        chainBlock: 7n
    }),
    blockDoubleSignProof: () => ({
        block1: factory.signedBlock(),
        block2: factory.signedBlock()
    }),
    blockInvalidStateTransitionProof: () => ({
        invalidBlock: factory.signedBlock(),
        previousBlock: factory.signedBlock(),
        previousBlockStateSnapshot: snapshot(),
        previousStateStateMachineState: factory.hexString(4)
    }),
    invalidTimestampProof: () => ({
        invalidBlock: factory.signedBlock(),
        previousBlock: factory.signedBlock(),
        previousStateSnapshot: snapshot(),
        participantSignatureOnPreviousBlock: factory.signature(),
        previousBlockOnChainTimestamp: 71n
    }),
    wrongGenesisProof: () => ({
        invalidBlock: factory.signedBlock(),
        genesisSnapshot: snapshot()
    }),
    forgedInboundMessageBlockProof: () => ({
        invalidBlock: factory.signedBlock(),
        forgedInboundMessageBlock: factory.messageBlock()
    }),
    disputeNotLatestStateProof: () => factory.signedBlock(),
    disputeInvalidOutputStateProof: () => ({
        latestStateSnapshot: snapshot(),
        latestStateMachineState: factory.hexString(4),
        inboundMessageBlocks: [factory.messageBlock()]
    }),
    disputeInvalidStateProof: () => ({
        milestoneIndex: 2n,
        hasBlockIndex: true,
        blockIndex: 1n,
        auditingData: auditingData(),
        previousStateSnapshot: snapshot(),
        resultingStateSnapshot: snapshot()
    }),
    disputeInvalidBalanceInvariantProof: () => ({
        latestStateSnapshot: snapshot(),
        latestStateMachineState: factory.hexString(4)
    }),
    booleanProof: () => ({ __: true }),
    timeoutThresholdProof: () => ({
        thresholdBlock: factory.blockConfirmation(),
        latestStateSnapshot: snapshot(),
        thresholdStateSnapshot: snapshot()
    }),
    timeoutCalldataPostedProof: () => ({
        genesisStateSnapshotData: factory.snapshotData(),
        latestStateSnapshot: snapshot(),
        latestStateStateMachineState: factory.hexString(4),
        postedBlock: factory.signedBlock(),
        onChainTimestamp: 79n,
        previousBlockOnChainTimestamp: 73n,
        previousBlockcalldata: factory.signedBlock()
    }),
    timeoutParticipantNotNextProof: () => ({
        latestStateSnapshot: snapshot(),
        latestStateStateMachineState: factory.hexString(4)
    }),
    timeoutTooEarlyProof: () => ({
        genesisStateSnapshotData: factory.snapshotData(),
        previousBlockOnChainTimestamp: 83n
    }),
    disputeInvalidBlockApplyFraudProof: () => ({
        fraudProof: {
            proofType: 1n,
            participant: factory.randomAddress(),
            encodedProof: factory.hexString(4)
        },
        blockIndex: 2n
    }),
    invalidDisputeReasonProof: () => ({ latestStateSnapshot: snapshot() }),
    disputeInvalidBlockStructureProof: () => ({
        blockIndex: 2n
    }),
    disputeBlockAuthorNotParticipantProof: () => ({
        blockIndex: 2n,
        previousBlock: factory.signedBlock(),
        previousStateSnapshot: snapshot(),
        resultingStateSnapshot: snapshot()
    }),
    proofWalkInput: () => ({
        channelId: factory.hash(),
        forkId: factory.hash(),
        stateProof: codecValues.stateProof(),
        genesisStateSnapshotData: factory.snapshotData(),
        milestoneSnapshots: [snapshot()]
    }),
    disputeInboundAnchorBehindLatestStateProof: () => ({
        latestStateSnapshot: snapshot()
    }),
    timeoutSupersededByFinalStateProof: () => ({
        finalProof: codecValues.proofWalkInput()
    }),
    disputeConflictsWithFinalStateProof: () => ({
        finalProof: codecValues.proofWalkInput(),
        milestoneIndex: 1n,
        blockIndex: 2n
    }),
    disputeInvalidOutboundRunProof: () => ({
        auditingData: auditingData()
    })
};

export const codecTestAddress = "0x0000000000000000000000000000000000000001";

/**
 * Shared differential corpus for the canonical block-encoding boundary: one
 * real factory block with a nonempty dynamic body and a nested message, its
 * canonical encoding, and the noncanonical/malformed mutations both the
 * UtilityFacet decoder and `Codec.decode(..., Type.Block)` must agree on.
 * Pure data, no executable test behavior: each `it` declaration below calls
 * this factory and feeds the identical bytes to both sides.
 */
export function canonicalBlockCorpus() {
    const base = codecValues.block();
    const blockValue: BlockStruct = {
        ...base,
        transaction: {
            header: base.transaction.header,
            body: { data: "0x123456" }
        },
        messageBlocks: [codecValues.messageBlock()]
    };
    const encodedCanonical = ethers.hexlify(
        Codec.encode(blockValue, Type.Block)
    );
    const word = ethers.toBeHex(64, 32);
    const hex = encodedCanonical.slice(2);
    const paddingAt = hex.indexOf("123456" + "00".repeat(29));
    if (paddingAt < 0) throw new Error("fixture padding not located");
    return {
        blockValue,
        encodedCanonical,
        encodedTrailingWord: encodedCanonical + "00".repeat(32),
        encodedTrailingByte: encodedCanonical + "00",
        encodedOffsetGap:
            "0x" + word.slice(2) + "00".repeat(32) + encodedCanonical.slice(66),
        encodedDirtyPadding:
            "0x" +
            hex.slice(0, paddingAt + 6) +
            "01" +
            hex.slice(paddingAt + 8),
        encodedTruncated: encodedCanonical.slice(0, -2),
        encodedEmpty: "0x"
    };
}

export function expectCodecRoundTrip(
    original: unknown,
    encoded: ethers.BytesLike,
    decoded: unknown
): void {
    expect(decoded).to.deep.equal(original);
    expect(ethers.isHexString(encoded)).to.equal(true);
}
