import { ExecutionFlags } from "@/DataTypes";
import { AgreementFlag } from "@/AgreementManager";
import { ethers } from "hardhat";
import { SignatureLike, BytesLike } from "ethers";
import EvmUtils from "@/utils/EvmUtils";
import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import StateManager from "./StateManager";

export interface ValidationResult {
    success: boolean;
    flag: ExecutionFlags; // Standard flag used across codebase
    agreementFlag?: AgreementFlag; // Optional agreement flag for disputes
    message?: string; // Optional description for logging/debugging
}

/**
 * Creates a success result
 */
export function success(): ValidationResult {
    return { success: true, flag: ExecutionFlags.SUCCESS };
}

/**
 * Creates a failure result with the given flag
 */
export function failure(
    flag: ExecutionFlags,
    agreementFlag?: AgreementFlag,
    message?: string
): ValidationResult {
    return { success: false, flag, agreementFlag, message };
}

export async function isManagerReady(
    stateManager: StateManager
): Promise<ValidationResult> {
    return stateManager.getForkCnt() === -1
        ? failure(
              ExecutionFlags.NOT_READY,
              undefined,
              "Manager not ready (fork count is -1)"
          )
        : success();
}

export async function isBlockValid(
    stateManager: StateManager,
    signedBlock: SignedBlockStruct
): Promise<ValidationResult> {
    return (await stateManager.isValidBlock(signedBlock))
        ? success()
        : failure(
              ExecutionFlags.DISCONNECT,
              undefined,
              "Invalid block signature or format"
          );
}

export async function isForkDisputed(
    stateManager: StateManager,
    block: BlockStruct
): Promise<ValidationResult> {
    return stateManager.disputeHandler.isForkDisputed(
        Number(block.transaction.header.forkCnt)
    )
        ? failure(ExecutionFlags.PAST_FORK, undefined, "Fork is under dispute")
        : success();
}

export async function isBlockInCurrentFork(
    stateManager: StateManager,
    block: BlockStruct
): Promise<ValidationResult> {
    return Number(block.transaction.header.forkCnt) < stateManager.getForkCnt()
        ? failure(
              ExecutionFlags.PAST_FORK,
              undefined,
              "Block belongs to a past fork"
          )
        : success();
}

export async function isParticipantInFork(
    stateManager: StateManager,
    block: BlockStruct
): Promise<ValidationResult> {
    return stateManager.agreementManager.isParticipantInLatestFork(
        block.transaction.header.participant
    )
        ? success()
        : failure(
              ExecutionFlags.DISCONNECT,
              undefined,
              "Participant not in current fork"
          );
}

export async function isDuplicateBlock(
    stateManager: StateManager,
    block: BlockStruct
): Promise<ValidationResult> {
    return stateManager.agreementManager.isBlockDuplicate(block)
        ? failure(
              ExecutionFlags.DUPLICATE,
              undefined,
              "Block already processed"
          )
        : success();
}

export async function isBlockFuture(
    stateManager: StateManager,
    block: BlockStruct
): Promise<ValidationResult> {
    const isFutureFork =
        Number(block.transaction.header.forkCnt) > stateManager.getForkCnt();
    const isFutureTransaction =
        Number(block.transaction.header.transactionCnt) >
        stateManager.getNextTransactionCnt();

    return isFutureFork || isFutureTransaction
        ? failure(
              ExecutionFlags.NOT_READY,
              undefined,
              "Block is for a future state"
          )
        : success();
}

export async function validatePastBlockInCurrentFork(
    stateManager: StateManager,
    signedBlock: SignedBlockStruct,
    block: BlockStruct
): Promise<ValidationResult> {
    // Only process if it's a past transaction
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
            return failure(
                ExecutionFlags.DISPUTE,
                agreementFlag,
                "Block for past transaction has issues"
            );
        }

        throw new Error(
            "StateManager - OnSignedBlock - current fork in the past - INTERNAL ERROR"
        );
    }

    return success();
}

export async function isTimestampValid(
    stateManager: StateManager,
    block: BlockStruct
): Promise<ValidationResult> {
    return (await stateManager.isGoodTimestampNonDeterministic(block))
        ? success()
        : failure(
              ExecutionFlags.DISPUTE,
              AgreementFlag.INCORRECT_DATA,
              "Block timestamp is invalid"
          );
}

/**
 * Checks if enough time has passed (subjectively) to process this transaction
 */
export async function hasEnoughTimePassed(
    stateManager: StateManager,
    signedBlock: SignedBlockStruct
): Promise<ValidationResult> {
    const flag =
        await stateManager.isEnoughTimeToPlayMyTransactionSubjective(
            signedBlock
        );

    return flag === ExecutionFlags.SUCCESS
        ? success()
        : failure(
              flag,
              undefined,
              "Not enough time has passed for transaction"
          );
}

export async function isCorrectBlockProducer(
    stateManager: StateManager,
    block: BlockStruct
): Promise<ValidationResult> {
    const nextToWrite = await stateManager.stateMachine.getNextToWrite();

    return block.transaction.header.participant !== nextToWrite
        ? failure(
              ExecutionFlags.DISPUTE,
              AgreementFlag.INCORRECT_DATA,
              "Incorrect block producer"
          )
        : success();
}

/**
 * verifies the transaction and updates state
 * This function:
 * 1. Captures current state hash
 * 2. Applies the transaction
 * 3. Verifies resulting state hash matches the block's stateHash
 * 4. Adds the block to the manager if valid
 */
export async function processStateTransition(
    stateManager: StateManager,
    block: BlockStruct,
    signedBlock: SignedBlockStruct
): Promise<ValidationResult> {
    // Capture current state hash
    const previousStateHash = await stateManager.getEncodedStateKecak256();

    // Apply the transaction
    const {
        success: txSuccess,
        encodedState,
        successCallback
    } = await stateManager.applyTransaction(block.transaction);

    // Compare resulting state hash with block's stateHash
    const isStateHashValid =
        ethers.keccak256(encodedState) === block.stateHash &&
        previousStateHash === block.previousStateHash;

    if (!txSuccess || !isStateHashValid) {
        return failure(
            ExecutionFlags.DISPUTE,
            AgreementFlag.INCORRECT_DATA,
            "Transaction failed or state hash mismatch"
        );
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

    return success();
}

export async function isDuplicateConfirmationSignature(
    stateManager: StateManager,
    block: BlockStruct,
    confirmationSignature: BytesLike
): Promise<ValidationResult> {
    return stateManager.agreementManager.doesSignatureExist(
        block,
        confirmationSignature as SignatureLike
    )
        ? failure(
              ExecutionFlags.DUPLICATE,
              undefined,
              "Duplicate confirmation signature"
          )
        : success();
}

export async function ensureBlockInChain(
    stateManager: StateManager,
    signedBlock: SignedBlockStruct,
    block: BlockStruct
): Promise<ValidationResult> {
    // If block isn't yet in the chain...
    if (!stateManager.agreementManager.isBlockInChain(block)) {
        const flag = await stateManager.onSignedBlock(signedBlock);

        if (flag === ExecutionFlags.DUPLICATE) {
            // Possibly it has become part of the chain now
            return stateManager.agreementManager.isBlockInChain(block)
                ? success()
                : failure(
                      ExecutionFlags.NOT_READY,
                      undefined,
                      "Block not in chain yet"
                  );
        }

        // If the processed result is anything else but SUCCESS, we must abort
        if (flag !== ExecutionFlags.SUCCESS) {
            return failure(
                flag,
                undefined,
                "Failed to process block for chain"
            );
        }
    }

    // If we reach here, the block is definitely in the canonical chain
    return success();
}

export async function isConfirmerInFork(
    stateManager: StateManager,
    block: BlockStruct,
    confirmationSignature: BytesLike
): Promise<ValidationResult> {
    const confirmer = EvmUtils.retrieveSignerAddressBlock(
        block,
        confirmationSignature as SignatureLike
    );

    if (!stateManager.agreementManager.isParticipantInLatestFork(confirmer)) {
        return failure(
            ExecutionFlags.DISCONNECT,
            undefined,
            "Confirmation signer not in current fork"
        );
    }

    return success();
}
