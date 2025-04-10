import { ExecutionFlags } from "@/DataTypes";
import { ValidationContext, ValidationResult, ValidationStep } from "./types";
import { AgreementFlag } from "@/AgreementManager";
import { ethers } from "hardhat";
import { SignatureLike } from "ethers";

export const checkManagerReadiness: ValidationStep = async ({
    stateManager
}: ValidationContext): Promise<ValidationResult> =>
    stateManager.getForkCnt() === -1
        ? { executionFlag: ExecutionFlags.NOT_READY }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkBlockValidity: ValidationStep = async ({
    stateManager,
    signedBlock
}: ValidationContext): Promise<ValidationResult> =>
    (await stateManager.isValidBlock(signedBlock))
        ? { executionFlag: ExecutionFlags.SUCCESS }
        : { executionFlag: ExecutionFlags.DISCONNECT };

export const checkForkDisputeStatus: ValidationStep = async ({
    stateManager,
    block
}: ValidationContext): Promise<ValidationResult> =>
    stateManager.disputeHandler.isForkDisputed(
        Number(block.transaction.header.forkCnt)
    )
        ? { executionFlag: ExecutionFlags.PAST_FORK }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkBlockForkStatus: ValidationStep = async ({
    stateManager,
    block
}: ValidationContext): Promise<ValidationResult> =>
    Number(block.transaction.header.forkCnt) < stateManager.getForkCnt()
        ? { executionFlag: ExecutionFlags.PAST_FORK }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkDuplicateBlock: ValidationStep = async ({
    stateManager,
    block
}: ValidationContext): Promise<ValidationResult> =>
    stateManager.agreementManager.isBlockDuplicate(block)
        ? { executionFlag: ExecutionFlags.DUPLICATE }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkBlockIsFuture: ValidationStep = async ({
    stateManager,
    block
}: ValidationContext): Promise<ValidationResult> =>
    Number(block.transaction.header.forkCnt) > stateManager.getForkCnt() ||
    Number(block.transaction.header.transactionCnt) >
        stateManager.getNextTransactionCnt()
        ? { executionFlag: ExecutionFlags.NOT_READY }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkParticipantInFork: ValidationStep = async ({
    stateManager,
    block
}: ValidationContext): Promise<ValidationResult> =>
    stateManager.agreementManager.isParticipantInLatestFork(
        block.transaction.header.participant
    )
        ? { executionFlag: ExecutionFlags.SUCCESS }
        : { executionFlag: ExecutionFlags.DISCONNECT };

export const checkPastBlockCurrentFork: ValidationStep = async ({
    stateManager,
    signedBlock,
    block
}: ValidationContext): Promise<ValidationResult> => {
    if (
        Number(block.transaction.header.transactionCnt) <
        stateManager.getNextTransactionCnt()
    ) {
        const agreementFlag =
            stateManager.agreementManager.checkBlock(signedBlock);
        if (
            agreementFlag === AgreementFlag.DOUBLE_SIGN ||
            agreementFlag === AgreementFlag.INCORRECT_DATA
        ) {
            return {
                executionFlag: ExecutionFlags.DISPUTE,
                agreementFlag
            };
        }

        throw new Error(
            "StateManager - OnSignedBlock - current fork in the past - INTERNAL ERROR"
        );
    }
    return { executionFlag: ExecutionFlags.SUCCESS };
};

export const checkBlockTimestamp: ValidationStep = async ({
    stateManager,
    block
}: ValidationContext): Promise<ValidationResult> =>
    (await stateManager.isGoodTimestampNonDeterministic(block))
        ? { executionFlag: ExecutionFlags.SUCCESS }
        : // This is a non-deterministic race – raise dispute
          {
              executionFlag: ExecutionFlags.DISPUTE,
              agreementFlag: AgreementFlag.INCORRECT_DATA
          };

/**
 * Renamed from `isEnoughTimeToPlayMyTransactionSubjective`.
 * Return SUCCESS if okay, or NOT_READY/DISPUTE/etc. if not.
 */
export const checkEnoughTimeSubjective: ValidationStep = async ({
    stateManager,
    signedBlock
}: ValidationContext): Promise<ValidationResult> => {
    const flag =
        await stateManager.isEnoughTimeToPlayMyTransactionSubjective(
            signedBlock
        );
    // If the function returns SUCCESS, keep going; otherwise return that flag
    if (flag !== ExecutionFlags.SUCCESS) {
        return { executionFlag: flag };
    }
    return { executionFlag: ExecutionFlags.SUCCESS };
};

export const checkCorrectBlockProducer: ValidationStep = async ({
    stateManager,
    block
}: ValidationContext): Promise<ValidationResult> => {
    const nextToWrite = await stateManager.stateMachine.getNextToWrite();
    if (block.transaction.header.participant !== nextToWrite) {
        return {
            executionFlag: ExecutionFlags.DISPUTE,
            agreementFlag: AgreementFlag.INCORRECT_DATA
        };
    }
    return { executionFlag: ExecutionFlags.SUCCESS };
};

export const verifyStateTransition: ValidationStep = async ({
    stateManager,
    block,
    signedBlock
}: ValidationContext): Promise<ValidationResult> => {
    // Capture current state hash
    const previousStateHash = await stateManager.getEncodedStateKecak256();

    // Apply the transaction
    const { success, encodedState, successCallback } =
        await stateManager.applyTransaction(block.transaction);

    // Compare resulting state hash with block’s stateHash
    const isStateHashValid =
        ethers.keccak256(encodedState) === block.stateHash &&
        previousStateHash === block.previousStateHash;

    if (!success || !isStateHashValid) {
        return {
            executionFlag: ExecutionFlags.DISPUTE,
            agreementFlag: AgreementFlag.INCORRECT_DATA
        };
    }

    // Add the block to the manager
    stateManager.agreementManager.addBlock(
        block,
        signedBlock.signature as SignatureLike,
        encodedState
    );

    // Fire success callback asynchronously
    setTimeout(() => {
        if (!stateManager.isDisposed) {
            successCallback();
        }
    }, 0);

    return { executionFlag: ExecutionFlags.SUCCESS };
};
