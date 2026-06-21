import { LogUploader } from "../LogUploader";

export class BrowserLogUploader extends LogUploader {
    private onWindowError?: (e: ErrorEvent) => void;
    private onWindowUnhandledRejection?: (e: PromiseRejectionEvent) => void;

    protected attachListeners(): void {
        if (typeof window === "undefined") return;

        this.onWindowError = (e: ErrorEvent) => {
            if (e.error) {
                this.uploadLogs(e.error);
            }
        };
        window.addEventListener("error", this.onWindowError);

        this.onWindowUnhandledRejection = (e: PromiseRejectionEvent) => {
            this.uploadLogs(
                e.reason instanceof Error
                    ? e.reason
                    : new Error(String(e.reason))
            );
        };
        window.addEventListener(
            "unhandledrejection",
            this.onWindowUnhandledRejection
        );
    }

    protected detachListeners(): void {
        if (typeof window === "undefined") return;

        if (this.onWindowError) {
            window.removeEventListener("error", this.onWindowError);
            this.onWindowError = undefined;
        }

        if (this.onWindowUnhandledRejection) {
            window.removeEventListener(
                "unhandledrejection",
                this.onWindowUnhandledRejection
            );
            this.onWindowUnhandledRejection = undefined;
        }
    }
}
