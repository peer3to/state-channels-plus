import { ErrorDescription, Signer, ethers } from "ethers";
import { errorAbis } from "./GeneratedArtifacts";
import { TransactionResponse } from "ethers";
import { Logger } from "./logging";

export type RaceConditionErrorName =
    | "RaceConditionChannelAlreadyOpen"
    | "RaceConditionBlockCalldataTimestampTooLate"
    | "RaceConditionSnapshotForkMismatch"
    | "RaceConditionBlockHeightTooOld"
    | "RaceConditionJoinChannelExpired"
    | "RaceConditionDisputeEvidencePeriodExpired"
    | "RaceConditionDisputeKillPeriodNotExpired"
    | "RaceConditionDisputeAlreadyReduced"
    | "RaceConditionDisputeAuditingRequired"
    | "RaceConditionDisputeTimeoutCalldataPosted"
    | "RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch"
    | "RaceConditionDisputeTimeoutNotMinTimestamp"
    | "RaceConditionUnexpectedBlockCalldataPosted"
    | "RaceConditionGenesisTimestampNotAvailable";

export type RaceConditionErrorHandlers = Partial<
    Record<RaceConditionErrorName, () => void>
>;

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

export function tryDecodeCustomError(error: any): CustomEvmError | null {
    if (isCustomEvmError(error)) {
        return error;
    }
    let errorData = error.data || error.error?.data || null;
    if (!errorData && error.execResult?.returnValue)
        errorData = ethers.hexlify(error.execResult.returnValue);

    if (!errorData || errorData.length < 10) return null;

    const errorDescription = errorInterface.parseError(errorData);
    if (!errorDescription) return null;
    return new CustomEvmError(errorDescription, error);
}

export function isCustomEvmError(error: any): error is CustomEvmError {
    return !!error && error.isCustomError === true;
}

export type HandleEvmErrorOptions = {
    tx?: TransactionResponse;
    logger?: Logger;
    handlers?: RaceConditionErrorHandlers;
    signer?: Signer;
};

export async function tryHandleEvmError(
    error: any,
    options: HandleEvmErrorOptions = {}
): Promise<boolean> {
    return _tryHandleEvmError(error, options, 0);
}

async function _tryHandleEvmError(
    error: any,
    options: HandleEvmErrorOptions,
    recursionDepth: number = 0
): Promise<boolean> {
    const { tx, logger, handlers, signer } = options;
    if (!error) return false;

    const customError = tryDecodeCustomError(error);

    if (customError) {
        const handler =
            handlers?.[customError.name as keyof RaceConditionErrorHandlers];
        if (handler) {
            logger?.info(`Handling custom EVM error: ${customError.name}`);
            handler();
            return true;
        }
        // unhandled custom error
        logger?.error("Unhandled custom EVM error", {
            name: customError.name,
            args: customError.errorDescription.args,
            txHash: tx?.hash
        });
        return false;
    }

    // tx.wait() path | tx exists but revert data missing
    if (tx && !recursionDepth && signer) {
        try {
            logger?.info(
                "tryHandleEvmError - preflight and retrying transaction"
            );
            // This peforms a preflight call and then resends the transaction if the preflight succeeds otehrwise reverts with error data
            const txResponse = await signer.sendTransaction({
                to: tx.to!,
                from: tx.from,
                data: tx.data!,
                value: tx.value
            });
            logger?.info("tryHandleEvmError - sendTransaction succeeded");
            await txResponse.wait();
            logger?.info("tryHandleEvmError - wait succeeded");
            return true;
        } catch (callError) {
            // if call reverts, do nothing here
            return _tryHandleEvmError(callError, options, recursionDepth + 1);
        }
    }

    // not a custom error
    logger?.error("Non-custom EVM error encountered", {
        error: error,
        txHash: tx?.hash
    });
    return false;
}
