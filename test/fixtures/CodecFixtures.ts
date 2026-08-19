// @spec-test-coverage-ignore: shared factory-built Codec inputs; no executable test behavior
import { expect } from "chai";
import { ethers } from "ethers";

import { Codec, Type } from "@/utils/Codec";
import * as factory from "../factory";

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
        milestones: [{ blockConfirmations: [factory.blockConfirmation()] }],
        signedBlocks: [factory.signedBlock()]
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
        outboundMessageBlocksOfTheLatestFork: [factory.messageBlock()]
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
    disputeInvalidStateProof: () => ({ auditingData: auditingData() }),
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
        blockIndexInUnfinalizedPartOfStateProof: 2n
    }),
    invalidDisputeReasonProof: () => ({ latestStateSnapshot: snapshot() }),
    disputeInvalidBlockStructureProof: () => ({
        blockIndexInUnfinalizedPartOfStateProof: 2n
    }),
    disputeBlockAuthorNotParticipantProof: () => ({
        blockIndexInUnfinalizedPartOfStateProof: 2n,
        previousBlock: factory.signedBlock(),
        previousStateSnapshot: snapshot(),
        resultingStateSnapshot: snapshot()
    })
};

export const codecTestAddress = "0x0000000000000000000000000000000000000001";

export function expectCodecRoundTrip(
    original: unknown,
    encoded: ethers.BytesLike,
    decoded: unknown
): void {
    expect(decoded).to.deep.equal(original);
    expect(ethers.isHexString(encoded)).to.equal(true);
}
