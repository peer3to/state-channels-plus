import { ExecutionFlags } from "@/DataTypes";
import {
    ConfirmationContext,
    ConfirmationStep,
    ValidationContext,
    ValidationResult
} from "./types";
import { AgreementFlag } from "@/AgreementManager";
import { ethers } from "hardhat";
import { SignatureLike } from "ethers";
import { EvmUtils } from "..";

export const checkManagerReadiness = async <
    TContext extends ValidationContext
>({
    stateManager
}: TContext): Promise<ValidationResult> =>
    stateManager.getForkCnt() === -1
        ? { executionFlag: ExecutionFlags.NOT_READY }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkBlockValidity = async <TContext extends ValidationContext>({
    stateManager,
    signedBlock
}: TContext): Promise<ValidationResult> =>
    (await stateManager.isValidBlock(signedBlock))
        ? { executionFlag: ExecutionFlags.SUCCESS }
        : { executionFlag: ExecutionFlags.DISCONNECT };

export const checkForkDisputeStatus = async <
    TContext extends ValidationContext
>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    stateManager.disputeHandler.isForkDisputed(
        Number(block.transaction.header.forkCnt)
    )
        ? { executionFlag: ExecutionFlags.PAST_FORK }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkBlockForkStatus = async <TContext extends ValidationContext>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    Number(block.transaction.header.forkCnt) < stateManager.getForkCnt()
        ? { executionFlag: ExecutionFlags.PAST_FORK }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkDuplicateBlock = async <TContext extends ValidationContext>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    stateManager.agreementManager.isBlockDuplicate(block)
        ? { executionFlag: ExecutionFlags.DUPLICATE }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkBlockIsFuture = async <TContext extends ValidationContext>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    Number(block.transaction.header.forkCnt) > stateManager.getForkCnt() ||
    Number(block.transaction.header.transactionCnt) >
        stateManager.getNextTransactionCnt()
        ? { executionFlag: ExecutionFlags.NOT_READY }
        : { executionFlag: ExecutionFlags.SUCCESS };

export const checkParticipantInFork = async <
    TContext extends ValidationContext
>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    stateManager.agreementManager.isParticipantInLatestFork(
        block.transaction.header.participant
    )
        ? { executionFlag: ExecutionFlags.SUCCESS }
        : { executionFlag: ExecutionFlags.DISCONNECT };

export const checkPastBlockCurrentFork = async <
    TContext extends ValidationContext
>({
    stateManager,
    signedBlock,
    block
}: TContext): Promise<ValidationResult> => {
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

export const checkBlockTimestamp = async <TContext extends ValidationContext>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    (await stateManager.isGoodTimestampNonDeterministic(block))
        ? { executionFlag: ExecutionFlags.SUCCESS }
        : // This is a non-deterministic race – raise dispute
          {
              executionFlag: ExecutionFlags.DISPUTE,
              agreementFlag: AgreementFlag.INCORRECT_DATA
          };

/**
 * Return SUCCESS if okay, or NOT_READY/DISPUTE/etc. if not.
 */
export const checkEnoughTimeSubjective = async <
    TContext extends ValidationContext
>({
    stateManager,
    signedBlock
}: TContext): Promise<ValidationResult> => {
    const flag =
        await stateManager.isEnoughTimeToPlayMyTransactionSubjective(
            signedBlock
        );
    return { executionFlag: flag };
};

export const checkCorrectBlockProducer = async <
    TContext extends ValidationContext
>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> => {
    const nextToWrite = await stateManager.stateMachine.getNextToWrite();
    if (block.transaction.header.participant !== nextToWrite) {
        return {
            executionFlag: ExecutionFlags.DISPUTE,
            agreementFlag: AgreementFlag.INCORRECT_DATA
        };
    }
    return { executionFlag: ExecutionFlags.SUCCESS };
};

export const verifyStateTransition = async <
    TContext extends ValidationContext
>({
    stateManager,
    block,
    signedBlock
}: TContext): Promise<ValidationResult> => {
    // Capture current state hash
    const previousStateHash = await stateManager.getEncodedStateKecak256();

    // Apply the transaction
    const { success, encodedState, successCallback } =
        await stateManager.applyTransaction(block.transaction);

    // Compare resulting state hash with block's stateHash
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

export const checkDuplicateConfirmationSignature: ConfirmationStep = async ({
    stateManager,
    block,
    confirmationSignature
}: ConfirmationContext): Promise<ValidationResult> => {
    if (
        stateManager.agreementManager.doesSignatureExist(
            block,
            confirmationSignature as SignatureLike
        )
    ) {
        return { executionFlag: ExecutionFlags.DUPLICATE };
    }
    return { executionFlag: ExecutionFlags.SUCCESS };
};

export const ensureBlockInChainOrProcessIt: ConfirmationStep = async ({
    stateManager,
    signedBlock,
    block
}: ConfirmationContext): Promise<ValidationResult> => {
    // If block isn't yet in the chain...
    if (!stateManager.agreementManager.isBlockInChain(block)) {
        const flag = await stateManager.onSignedBlock(signedBlock);

        if (flag === ExecutionFlags.DUPLICATE) {
            // Possibly it has become part of the chain now
            if (stateManager.agreementManager.isBlockInChain(block)) {
                // Great, treat as success
                return { executionFlag: ExecutionFlags.SUCCESS };
            } else {
                // Not in chain yet
                return { executionFlag: ExecutionFlags.NOT_READY };
            }
        }

        // If the processed result is anything else but SUCCESS, we must abort
        if (flag !== ExecutionFlags.SUCCESS) {
            return { executionFlag: flag };
        }
    }

    // If we reach here, the block is definitely in the canonical chain
    return { executionFlag: ExecutionFlags.SUCCESS };
};

export const checkConfirmerParticipantInFork: ConfirmationStep = async ({
    stateManager,
    block,
    confirmationSignature
}: ConfirmationContext): Promise<ValidationResult> => {
    const retrievedAddress = EvmUtils.retrieveSignerAddressBlock(
        block,
        confirmationSignature as SignatureLike
    );
    if (
        !stateManager.agreementManager.isParticipantInLatestFork(
            retrievedAddress
        )
    ) {
        return { executionFlag: ExecutionFlags.DISCONNECT };
    }
    return { executionFlag: ExecutionFlags.SUCCESS };
};
