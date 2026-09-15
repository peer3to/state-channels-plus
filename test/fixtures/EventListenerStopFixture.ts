// @spec-test-coverage-ignore: real subscription callback during the stop drain window
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { expect } from "chai";

export async function assertListenerStopWindow(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 0);
    const result = await h.execOnHost(h.getPeer(0), async (sm) => {
        const listener = sm.stateChannelEventListener;
        const callback = listener["listener"];
        if (!callback) throw new Error("Expected an installed chain listener");
        const logs = await sm.stateChannelManagerContract.queryFilter(
            sm.stateChannelManagerContract.filters.ChannelOpened(sm.channelId)
        );
        const log = logs.at(-1);
        if (!log) throw new Error("Expected the channel's opening log");
        const sync = sm.eventSyncService;
        const wait = sync.waitForScheduled.bind(sync);
        const schedule = sync.scheduleLog.bind(sync);
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        let calls = 0;
        sync.waitForScheduled = async (...args) => {
            await held;
            return wait(...args);
        };
        sync.scheduleLog = (...args) => {
            calls += 1;
            return schedule(...args);
        };
        const stopping = listener.stop();
        try {
            callback(log);
            return {
                calls,
                stillSubscribed: listener["listener"] === callback
            };
        } finally {
            release();
            await stopping;
            sync.waitForScheduled = wait;
            sync.scheduleLog = schedule;
        }
    });
    expect(result).to.deep.equal({ calls: 0, stillSubscribed: true });
}
