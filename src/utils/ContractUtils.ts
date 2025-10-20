import { BaseContract } from "ethers";

export interface ContractCallResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Makes a read-only contract call using the provider
 * @param contract - The contract instance
 * @param functionName - Name of the function to call
 * @param args - Arguments to pass to the function
 * @returns Promise with the call result or error
 */
export async function makeContractCall<T = any>(
    contract: BaseContract,
    functionName: string,
    args: any[] = []
): Promise<ContractCallResult<T>> {
    try {
        // Encode the function call data
        const callData = contract.interface.encodeFunctionData(
            functionName,
            args
        );

        // Get the provider from the contract
        const provider = contract.runner?.provider;
        if (!provider) {
            return {
                success: false,
                error: "No provider available for contract call"
            };
        }

        // Make the call
        const result = await provider.call({
            to: await contract.getAddress(),
            data: callData
        });

        // Decode the result
        const decodedResult = contract.interface.decodeFunctionResult(
            functionName,
            result
        );

        return {
            success: true,
            data: decodedResult as T
        };
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        console.log(`Contract call failed for ${functionName}:`, errorMessage);

        return {
            success: false,
            error: `Failed to call ${functionName}: ${errorMessage}`
        };
    }
}

export async function makeContractCallOrThrow<T = any>(
    contract: BaseContract,
    functionName: string,
    args: any[] = []
): Promise<T> {
    const result = await makeContractCall<T>(contract, functionName, args);

    if (!result.success) {
        throw new Error(result.error || `Failed to call ${functionName}`);
    }

    return result.data!;
}
