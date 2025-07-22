import { ErrorDescription, ethers } from "ethers";
import { errorAbis } from "./ContractErrors";
import { Bytes } from "@/types/types";

// interface for parsing errors
const errorInterface = new ethers.Interface(errorAbis);

export interface CustomError {
    name: string;
    args: any[];
    signature: string;
}

/**
 * Custom error class that extends Error and includes decoded Solidity error information
 */
export class CustomContractError extends Error {
    public readonly errorDescription: ErrorDescription;
    public readonly isCustomError = true;
    public readonly originalError: any;

    constructor(customError: ErrorDescription, originalError: any) {
        super(
            `${customError.name}${customError.args.length > 0 ? ` (args: ${customError.args.join(", ")})` : ""}`
        );
        this.name = customError.name;
        this.errorDescription = customError;
        this.originalError = originalError;
    }
}

function decodeCustomError(errorData: Bytes): ErrorDescription | null {
    if (!errorData || errorData.length < 10) return null;

    return errorInterface.parseError(errorData);
}

export function isCustomContractError(
    error: any
): error is CustomContractError {
    return !!error && error.isCustomError === true;
}

export async function call<T>(contractCall: () => Promise<T>): Promise<T> {
    try {
        return await contractCall();
    } catch (error: any) {
        const customError = error.data ? decodeCustomError(error.data) : null;

        if (customError) {
            throw new CustomContractError(customError, error);
        }

        throw error;
    }
}
