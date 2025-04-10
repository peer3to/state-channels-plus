import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import StateManager from "./StateManager";
import { ExecutionFlags } from "@/DataTypes";
import { AgreementFlag } from "@/AgreementManager";
import { BytesLike } from "ethers";

export interface ValidationContext {
    stateManager: StateManager;
    signedBlock: SignedBlockStruct;
    block: BlockStruct;
}

export interface ConfirmationContext extends ValidationContext {
    confirmationSignature: BytesLike;
}

/**
 * A validator can return either SUCCESS or a failure-type ExecutionFlag.
 *  optionally specify an AgreementFlag (like INCORRECT_DATA, etc).
 */
export interface ValidationResult {
    executionFlag: ExecutionFlags;
    agreementFlag?: AgreementFlag;
}

/**
 * Signature for each validator function.
 */
export type ValidationStep<TContext extends ValidationContext> = (
    context: TContext
) => Promise<ValidationResult>;

export type ConfirmationStep = (
    context: ConfirmationContext
) => Promise<ValidationResult>;
