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

//  decode custom errors from transaction receipt errors (like tx.wait() failures)
export function decodeTransactionError(error: any): CustomEvmError | null {
    const errorData =
        error?.data ||
        error?.error?.data ||
        error?.receipt?.data ||
        error?.transaction?.data ||
        null;

    if (errorData) {
        const customError = decodeCustomError(errorData);
        if (customError) {
            return new CustomEvmError(customError, error);
        }
    }

    if (error?.message) {
        const match = error.message.match(/custom error '(\w+)\(\)'/);
        if (match) {
            const errorName = match[1];
            // Create a mock ErrorDescription for known errors
            const mockErrorDescription: ErrorDescription = {
                name: errorName,
                args: [] as any,
                signature: `${errorName}()`,
                selector: "0x00000000", // placeholder
                fragment: null as any // placeholder
            };
            return new CustomEvmError(mockErrorDescription, error);
        }
    }

    return null;
}

export function isCustomEvmError(error: any): error is CustomEvmError {
    return !!error && error.isCustomError === true;
}

export function decodeErrorProxy<T extends object>(contract: T) {
    return new Proxy(contract, {
        get(target, prop, receiver) {
            const originalProperty = Reflect.get(target, prop, receiver);

            if (typeof originalProperty !== "function") {
                return originalProperty;
            }

            const isAsync =
                originalProperty.constructor.name === "AsyncFunction";

            if (isAsync) {
                // Wrap async functions with error handling
                return async function (...args: any[]) {
                    try {
                        return await Reflect.apply(
                            originalProperty,
                            target,
                            args
                        );
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
            // For synchronous functions, wrap with sync error handling
            return function (...args: any[]) {
                try {
                    return Reflect.apply(originalProperty, target, args);
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
