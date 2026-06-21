import axios from "axios";

export function getAxiosRetrySummary(uploadError: unknown) {
    if (!axios.isAxiosError(uploadError)) {
        return { code: undefined, status: undefined };
    }

    return {
        code: uploadError.code,
        status: uploadError.response?.status
    };
}

export function sanitizeAxiosErrorForLogging(uploadError: unknown): void {
    if (!axios.isAxiosError(uploadError) || !uploadError.config) {
        return;
    }

    delete (uploadError.config as any).data;
}

export function getAxiosFailureSummary(uploadError: unknown) {
    if (!axios.isAxiosError(uploadError)) {
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
