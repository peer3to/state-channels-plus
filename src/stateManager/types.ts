import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import StateManager from "./StateManager";
import { ExecutionFlags } from "@/DataTypes";
import { AgreementFlag } from "@/AgreementManager";

export interface ValidationContext {
    stateManager: StateManager;
    signedBlock: SignedBlockStruct;
    block: BlockStruct;
}

/**
 * A validator can return either SUCCESS or a failure-type ExecutionFlag.
 * We also allow it to optionally specify an AgreementFlag (like INCORRECT_DATA, etc).
 */
export interface ValidationResult {
    executionFlag: ExecutionFlags;
    agreementFlag?: AgreementFlag;
}

/**
 * Signature for each validator function.
 */
export type ValidationStep = (
    context: ValidationContext
) => Promise<ValidationResult>;
