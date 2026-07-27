export interface RetryAttemptToken {
    readonly attempt: number;
    readonly generation: number;
    readonly failed: boolean;
    isCurrent(): boolean;
    failOnce(callback: () => void): boolean;
}

export class RetryLifecycle {
    private pendingTimer?: ReturnType<typeof setTimeout>;
    private generation = 0;
    private attempt = 0;
    private failedGeneration?: number;
    private disposed = false;

    public beginAttempt(): RetryAttemptToken {
        this.cancelRetry();

        if (!this.disposed) {
            this.generation++;
            this.attempt++;
            this.failedGeneration = undefined;
        }

        const generation = this.generation;
        const attempt = this.attempt;
        const isFailed = () => this.failedGeneration === generation;
        return {
            attempt,
            generation,
            get failed() {
                return isFailed();
            },
            isCurrent: () => this.isCurrentGeneration(generation),
            failOnce: (callback) => {
                if (
                    !this.isCurrentGeneration(generation) ||
                    this.failedGeneration === generation
                ) {
                    return false;
                }
                this.failedGeneration = generation;
                callback();
                return true;
            }
        };
    }

    public scheduleRetry(
        token: RetryAttemptToken,
        callback: () => void,
        delayMs: number
    ): boolean {
        if (!token.isCurrent() || this.pendingTimer !== undefined) {
            return false;
        }

        this.pendingTimer = setTimeout(() => {
            this.pendingTimer = undefined;
            if (token.isCurrent()) {
                callback();
            }
        }, delayMs);
        return true;
    }

    public cancelRetry(token?: RetryAttemptToken): boolean {
        if (token && !token.isCurrent()) {
            return false;
        }
        if (this.pendingTimer === undefined) {
            return false;
        }
        clearTimeout(this.pendingTimer);
        this.pendingTimer = undefined;
        return true;
    }

    public retireAttempt(token: RetryAttemptToken): boolean {
        if (!token.isCurrent()) {
            return false;
        }
        this.cancelRetry(token);
        this.generation++;
        this.failedGeneration = undefined;
        return true;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.cancelRetry();
        this.disposed = true;
        this.generation++;
        this.failedGeneration = undefined;
    }

    private isCurrentGeneration(generation: number): boolean {
        return !this.disposed && generation === this.generation;
    }
}
