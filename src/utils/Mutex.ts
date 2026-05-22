import type { Logger } from "./logging/Logger";
import Clock from "@/Clock";

export type MutexLockOptions = { taskName?: string; logMeta?: any };
export type MutexUnlockOptions = { scheduleNextAsMacroTask?: boolean };

export class Mutex {
    private isLocked: boolean;
    private queue: (() => void)[];
    private lockedAtMs?: number;
    private taskName?: string;
    private logMeta?: any;
    private logger?: Logger;

    constructor(logger?: Logger) {
        this.isLocked = false;
        this.queue = [];
        this.logger = logger;
    }

    public lock(options?: MutexLockOptions): Promise<void> {
        const queuedAt = Clock.getTimeInSeconds();
        const queuedAtMs = Date.now();
        return new Promise((resolve) => {
            const acquire = () => {
                const acquiredAtMs = Date.now();
                this.isLocked = true;
                this.lockedAtMs = acquiredAtMs;
                this.taskName = options?.taskName;
                this.logMeta = options?.logMeta;
                this.logger?.verbose("Mutex acquired", {
                    ...options?.logMeta,
                    taskName: options?.taskName,
                    queuedAt,
                    waitMs: acquiredAtMs - queuedAtMs,
                    waitingTasks: this.queue.length
                });
                resolve();
            };

            if (this.isLocked) {
                this.queue.push(acquire);
            } else {
                acquire();
            }
        });
    }

    public unlock(options?: MutexUnlockOptions): void {
        if (this.lockedAtMs !== undefined) {
            this.logger?.verbose("Mutex released", {
                ...this.logMeta,
                taskName: this.taskName,
                occupiedMs: Date.now() - this.lockedAtMs,
                waitingTasks: this.queue.length
            });
        }
        this.lockedAtMs = undefined;
        this.taskName = undefined;
        this.logMeta = undefined;

        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                if (options?.scheduleNextAsMacroTask) {
                    this.scheduleMacroTask(next);
                } else {
                    next();
                }
            }
        } else {
            this.isLocked = false;
        }
    }

    private scheduleMacroTask(task: () => void): void {
        setTimeout(task, 0);
    }
}
