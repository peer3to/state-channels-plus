import { LogUploader } from "../LogUploader";

export class BrowserLogUploader extends LogUploader {
    private onError?: (e: ErrorEvent) => void;
    private onUnhandledRejection?: (e: PromiseRejectionEvent) => void;

    /** the page's window or a worker's own scope: both raise these events */
    protected attachListeners(): void {
        if (typeof addEventListener !== "function") return;

        this.onError = (e: ErrorEvent) => {
            if (e.error) {
                this.captureUnhandled(e.error, "error");
            }
        };
        addEventListener("error", this.onError);

        this.onUnhandledRejection = (e: PromiseRejectionEvent) => {
            this.captureUnhandled(e.reason, "unhandledrejection");
        };
        addEventListener("unhandledrejection", this.onUnhandledRejection);
    }

    protected detachListeners(): void {
        if (typeof removeEventListener !== "function") return;

        if (this.onError) {
            removeEventListener("error", this.onError);
            this.onError = undefined;
        }

        if (this.onUnhandledRejection) {
            removeEventListener(
                "unhandledrejection",
                this.onUnhandledRejection
            );
            this.onUnhandledRejection = undefined;
        }
    }
}
