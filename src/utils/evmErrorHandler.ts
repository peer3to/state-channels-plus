import { ErrorDescription, ethers } from "ethers";
import { errorAbis } from "./GeneratedArtifacts";
import { Bytes } from "@/types/types";

// interface for parsing errors
const errorInterface = new ethers.Interface(errorAbis);

export class CustomEvmError extends Error {
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

export function isCustomEvmError(error: any): error is CustomEvmError {
    return !!error && error.isCustomError === true;
}

export function decodeErrorProxy<T extends Object>(contract: T) {
    return new Proxy(contract, {
        get(target, prop, receiver) {
            const originalProperty = Reflect.get(target, prop, receiver);

            if (typeof originalProperty !== "function") {
                return originalProperty;
            }
            return async function (...args: any[]) {
                try {
                    return await Reflect.apply(originalProperty, target, args);
                } catch (error: any) {
                    const errorData = error.data
                        ? error.data
                        : error.execResult?.returnValue
                          ? ethers.hexlify(error.execResult.returnValue)
                          : null;

                    const customError = decodeCustomError(errorData);

                    if (customError) {
                        throw new CustomEvmError(customError, error);
                    }

                    throw error;
                }
            };
        }
    });
}
