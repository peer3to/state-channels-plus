// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { config } from "@/utils/config";
import { expect } from "chai";
import sinon from "sinon";

/** A worker-mode root that records whether its thread's monitor ran when its start began. */
class MonitorProbeRoot extends AInternalRpcRoot {
    public isMonitoredAtStart?: boolean;

    constructor(private readonly isMonitored: () => boolean) {
        super(() => {}, null, { mode: "worker" });
    }

    public async start(): Promise<void> {
        this.isMonitoredAtStart = this.isMonitored();
    }

    public dispose(): Promise<void> {
        return this.disposeRoot(() => {});
    }
}

/**
 * A worker root's event-loop monitor starts before its start only with
 * `EVENT_LOOP_MONITOR_STARTUP`; either way it runs once the root started.
 */
export async function assertWorkerMonitorStart(
    isStartupMonitored: boolean
): Promise<void> {
    const threshold = config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS;
    const isStartup = config.EVENT_LOOP_MONITOR_STARTUP;
    config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS = 3600;
    config.EVENT_LOOP_MONITOR_STARTUP = isStartupMonitored;
    // Read only once the root starts, after the spy below exists.
    const root = new MonitorProbeRoot((): boolean => starts.called);
    const starts: sinon.SinonSpy = sinon.spy(
        root.logger.attachedLogger,
        "startPerformanceMonitoring"
    );
    try {
        await root.startRuntime({ mode: "worker" });
        expect(root.isMonitoredAtStart).to.equal(isStartupMonitored);
        expect(starts.called).to.equal(true);
    } finally {
        starts.restore();
        root.logger.attachedLogger.stopPerformanceMonitoring();
        await root.dispose();
        config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS = threshold;
        config.EVENT_LOOP_MONITOR_STARTUP = isStartup;
    }
}
