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
import EvmUtils from "@/utils/EvmUtils";

//====================================================================
// BASIC STATE VALIDATION FUNCTIONS
//====================================================================

/**
 * Validates if the state manager is ready for processing
 */
export const checkManagerReadiness = async <
    TContext extends ValidationContext
>({
    stateManager
}: TContext): Promise<ValidationResult> =>
    stateManager.getForkCnt() === -1
        ? { executionFlag: ExecutionFlags.NOT_READY }
        : { executionFlag: ExecutionFlags.SUCCESS };

/**
 * Validates the integrity of a signed block
 */
export const checkBlockValidity = async <TContext extends ValidationContext>({
    stateManager,
    signedBlock
}: TContext): Promise<ValidationResult> =>
    (await stateManager.isValidBlock(signedBlock))
        ? { executionFlag: ExecutionFlags.SUCCESS }
        : { executionFlag: ExecutionFlags.DISCONNECT };

//====================================================================
// FORK-RELATED VALIDATION FUNCTIONS
//====================================================================

/**
 * Checks if the fork associated with this block is under dispute
 */
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

/**
 * Ensures the block's fork count is current
 */
export const checkBlockForkStatus = async <TContext extends ValidationContext>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    Number(block.transaction.header.forkCnt) < stateManager.getForkCnt()
        ? { executionFlag: ExecutionFlags.PAST_FORK }
        : { executionFlag: ExecutionFlags.SUCCESS };

/**
 * Verifies the block's participant is part of the current fork
 */
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

//====================================================================
// BLOCK VALIDATION FUNCTIONS
//====================================================================

/**
 * Checks if this block has already been processed
 */
export const checkDuplicateBlock = async <TContext extends ValidationContext>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    stateManager.agreementManager.isBlockDuplicate(block)
        ? { executionFlag: ExecutionFlags.DUPLICATE }
        : { executionFlag: ExecutionFlags.SUCCESS };

/**
 * Validates if the block belongs to a future state
 */
export const checkBlockIsFuture = async <TContext extends ValidationContext>({
    stateManager,
    block
}: TContext): Promise<ValidationResult> =>
    Number(block.transaction.header.forkCnt) > stateManager.getForkCnt() ||
    Number(block.transaction.header.transactionCnt) >
        stateManager.getNextTransactionCnt()
        ? { executionFlag: ExecutionFlags.NOT_READY }
        : { executionFlag: ExecutionFlags.SUCCESS };

/**
 * Handle validation of blocks that belong to current fork but are for past transactions
 */
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

/**
 * Validates the timestamp of the block
 */
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
 * Checks if enough time has passed (subjectively) to process this transaction
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

/**
 * Verifies that the block was produced by the correct participant
 */
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

//====================================================================
// STATE TRANSITION VALIDATION
//====================================================================

/**
 * Core function that verifies the transaction and updates state
 * This function:
 * 1. Captures current state hash
 * 2. Applies the transaction
 * 3. Verifies resulting state hash matches the block's stateHash
 * 4. Adds the block to the manager if valid
 */
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

//====================================================================
// CONFIRMATION VALIDATION FUNCTIONS
//====================================================================

/**
 * Checks if we've already seen this confirmation signature
 */
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

/**
 * Ensures the block is part of the chain or attempts to process it
 */
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

/**
 * Verifies the confirmer is a participant in the current fork
 */
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
