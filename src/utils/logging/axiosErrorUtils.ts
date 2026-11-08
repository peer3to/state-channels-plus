import type { AxiosError } from "axios";

/**
 * axios's own `isAxiosError` check, without loading axios: a thread loads it
 * only once it uploads.
 */
export function isAxiosError(error: unknown): error is AxiosError {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { isAxiosError?: unknown }).isAxiosError === true
    );
}

export function getAxiosRetrySummary(uploadError: unknown) {
    if (!isAxiosError(uploadError)) {
        return { code: undefined, status: undefined };
    }

    return {
        code: uploadError.code,
        status: uploadError.response?.status
    };
}

export function sanitizeAxiosErrorForLogging(uploadError: unknown): void {
    if (!isAxiosError(uploadError) || !uploadError.config) {
        return;
    }

    delete (uploadError.config as any).data;
}

export function getAxiosFailureSummary(uploadError: unknown) {
    if (!isAxiosError(uploadError)) {
        return {
            code: undefined,
            status: undefined,
            statusText: undefined,
            timeout: undefined,
            requestUploadId: undefined,
            responseUploadId: undefined
        };
    }

    return {
        code: uploadError.code,
        status: uploadError.response?.status,
        statusText: uploadError.response?.statusText,
        timeout: uploadError.config?.timeout,
        requestUploadId: uploadError.config?.headers?.["x-upload-id"],
        responseUploadId: uploadError.response?.headers?.["x-upload-id"]
    };
}
