// @spec-test-coverage-ignore: real subscription callback after the listener stopped
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
        const schedule = sync.scheduleLog.bind(sync);
        let calls = 0;
        sync.scheduleLog = (...args) => {
            calls += 1;
            return schedule(...args);
        };
        // stop drains nothing, so the subscription callback runs while the
        // runtime is stopped and its unsubscribe has not started
        const stopping = listener.stop();
        try {
            callback(log);
            return {
                calls,
                stillSubscribed: listener["listener"] === callback
            };
        } finally {
            await stopping;
            sync.scheduleLog = schedule;
        }
    });
    expect(result).to.deep.equal({ calls: 0, stillSubscribed: true });
}

/**
 * Stops the runtime's listener, then schedules a log it has not seen (the
 * opening log under another index, as a recovery query may deliver late):
 * no dispatch starts, so nothing needs a dependency the disposal closes next.
 */
export async function assertNoDispatchAfterStop(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 0);
    const dispatched = await h.execOnHost(h.getPeer(0), async (sm) => {
        const logs = await sm.stateChannelManagerContract.queryFilter(
            sm.stateChannelManagerContract.filters.ChannelOpened(sm.channelId)
        );
        const log = logs.at(-1);
        if (!log) throw new Error("Expected the channel's opening log");
        const sync = sm.eventSyncService;
        const dispatch = sync["dispatchLog"].bind(sync);
        let calls = 0;
        sync["dispatchLog"] = async (...args: Parameters<typeof dispatch>) => {
            calls += 1;
            return dispatch(...args);
        };
        try {
            await sm.stateChannelEventListener.stop();
            const late = Object.assign(Object.create(log), {
                index: log.index + 1_000
            });
            await sync.scheduleLog(late).catch(() => undefined);
            return calls;
        } finally {
            sync["dispatchLog"] = dispatch;
        }
    });
    expect(dispatched).to.equal(0);
}
