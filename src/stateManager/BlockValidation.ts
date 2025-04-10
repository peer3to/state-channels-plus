import { BytesLike, SignatureLike, ethers } from "ethers";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "../utils/EvmUtils";
import { ValidationContext, ValidationStep } from "./types";
import { AgreementFlag } from "@/AgreementManager";
import { ExecutionFlags } from "@/DataTypes";

/**
 * Validates if a signed block is valid based on channel ID and signature
 *
 * @param signedBlock - The signed block to validate
 * @param channelId - The channel ID to validate against
 * @returns True if the block is valid, false otherwise
 */
export function isValidBlock(
    signedBlock: SignedBlockStruct,
    channelId: BytesLike
): boolean {
    try {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        // Verify channel ID
        if (block.transaction.header.channelId !== channelId) return false;

        // Verify signature
        const blockHash = ethers.keccak256(signedBlock.encodedBlock);
        const retrievedAddress = ethers.verifyMessage(
            ethers.getBytes(blockHash),
            signedBlock.signature as SignatureLike
        );

        return retrievedAddress === block.transaction.header.participant;
    } catch (e) {
        return false;
    }
}

export async function runValidationPipeline(
    validators: ValidationStep[],
    context: ValidationContext
): Promise<{ executionFlag: ExecutionFlags; agreementFlag?: AgreementFlag }> {
    for (const validator of validators) {
        const result = await validator(context);
        if (result.executionFlag !== ExecutionFlags.SUCCESS) {
            // Immediately return on failure
            return result;
        }
    }
    // If we get here, all validators returned SUCCESS
    return { executionFlag: ExecutionFlags.SUCCESS };
}
