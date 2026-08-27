import { Logger } from "@/utils/logging/Logger";
import { LogStore } from "@/utils/logging/logStore";

class NoOpLogger extends Logger {
    constructor() {
        super({}, {}, undefined, new LogStore(0, false));
    }

    // itself, so it stays out of the parent/child graph where a self-parent
    // would loop rootLogger
    public child(): Logger {
        return this;
    }

    public debug(): void {}
    public info(): void {}
    public warn(): void {}
    public error(): void {}
    public verbose(): void {}
    public logEntry(): void {}
    public group(): void {}
    public groupEnd(): void {}

    protected createChild(): Logger {
        return this;
    }

    protected write(): void {}

    protected createPerformanceMonitor(): () => void {
        return () => {};
    }
}

const noOpLogger: Logger = new NoOpLogger();

export default noOpLogger;
