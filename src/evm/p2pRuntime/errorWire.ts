import { ethers } from "ethers";

import {
    getErrorPeerAddress,
    maybeStampErrorWithPeerAddress
} from "@/utils/errorPeerAddress";
import type { EventLoopDelayDetails } from "@/utils/logging/performanceMonitorInternal";
import type { SerializedError } from "./types";

/**
 * The one error codec for every isolation boundary: the contract-executor
 * worker's detached-error message and the runtime host's `hostError`. An
 * `Error` sent through `postMessage` keeps only its standard slots, so the
 * watchdog's `eventLoopDelay`, a contract revert's `data`, and ethers'
 * classification metadata are projected here before the hop and restored
 * after it.
 */

function extractRevertData(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const e = error as {
        data?: unknown;
        error?: { data?: unknown };
        info?: { error?: { data?: unknown } };
        cause?: { data?: unknown };
        originalError?: unknown;
        execResult?: { returnValue?: unknown };
    };
    const candidate =
        e.data ?? e.error?.data ?? e.info?.error?.data ?? e.cause?.data;
    if (typeof candidate === "string") return candidate;
    if (e.originalError !== undefined) {
        const originalErrorData = extractRevertData(e.originalError);
        if (originalErrorData !== undefined) return originalErrorData;
    }
    if (e.execResult?.returnValue !== undefined) {
        try {
            return ethers.hexlify(e.execResult.returnValue as ethers.BytesLike);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function serializeEthersErrorMetadata(error: Error) {
    // Project ethers' extra error fields into structured-clone-safe values for
    // the client to restore on its local Error instance.
    const ethersError = error as Error & {
        code?: string;
        shortMessage?: string;
        info?: unknown;
        action?: string;
        reason?: string;
        transaction?: unknown;
        receipt?: unknown;
    };
    return {
        code: ethersError.code,
        shortMessage: ethersError.shortMessage,
        info: cloneSerializableErrorField(ethersError.info),
        action: ethersError.action,
        reason: ethersError.reason,
        transaction: cloneSerializableErrorField(ethersError.transaction),
        receipt: cloneSerializableErrorField(ethersError.receipt)
    };
}

function cloneSerializableErrorField(value: unknown): unknown {
    if (value === undefined) return undefined;
    // This runs inside the uncaught-error funnel: a metadata object whose
    // `toJSON` throws must not replace the original error with its own.
    try {
        let candidate = value;
        if (
            typeof value === "object" &&
            value !== null &&
            "toJSON" in value &&
            typeof value.toJSON === "function"
        ) {
            candidate = value.toJSON();
        }
        return globalThis.structuredClone(candidate);
    } catch {
        return undefined;
    }
}

function extractEventLoopDelay(
    error: unknown
): EventLoopDelayDetails | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const details = (error as { eventLoopDelay?: unknown }).eventLoopDelay;
    if (typeof details !== "object" || details === null) return undefined;
    return cloneSerializableErrorField(details) as
        | EventLoopDelayDetails
        | undefined;
}

export function serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            stack: error.stack,
            data: extractRevertData(error),
            ...serializeEthersErrorMetadata(error),
            peerAddress: getErrorPeerAddress(error),
            eventLoopDelay: extractEventLoopDelay(error)
        };
    }
    return {
        message: String(error),
        data: extractRevertData(error),
        peerAddress: getErrorPeerAddress(error),
        eventLoopDelay: extractEventLoopDelay(error)
    };
}

function restoreEthersErrorMetadata(
    error: Error,
    serialized: SerializedError
): void {
    // Error's standard fields cross the port, but ethers' enumerable metadata
    // does not. Restore the plain fields callers use for error classification;
    // transaction, receipt, and info remain serializable projections.
    Object.assign(error, {
        code: serialized.code,
        shortMessage: serialized.shortMessage,
        info: serialized.info,
        action: serialized.action,
        reason: serialized.reason,
        transaction: serialized.transaction,
        receipt: serialized.receipt
    });
}

export function deserializeError(serialized: SerializedError): Error {
    const error = new Error(serialized.message);
    error.name = serialized.name ?? error.name;
    if (serialized.stack) error.stack = serialized.stack;
    // Restore a contract revert's `.data` so `tryDecodeCustomError` can decode
    // custom errors that crossed the port.
    if (serialized.data !== undefined) {
        (error as Error & { data?: string }).data = serialized.data;
    }
    restoreEthersErrorMetadata(error, serialized);
    if (serialized.eventLoopDelay !== undefined) {
        (
            error as Error & { eventLoopDelay?: EventLoopDelayDetails }
        ).eventLoopDelay = serialized.eventLoopDelay;
    }
    // Restore the originating-peer stamp (the non-enumerable in-process
    // property doesn't survive the structured-clone hop across the port).
    maybeStampErrorWithPeerAddress(error, serialized.peerAddress);
    return error;
}
