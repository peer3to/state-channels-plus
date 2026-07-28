import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: Persistence restart", function () {
    it("holds recovered-state publication behind the storage barrier", async function () {
        this.timeout(90_000);

        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({
            waitForPeers: [0],
            waitForFinalization: false
        });

        const result = await h.execOnHost(h.getPeer(0), async (sm) => {
            const block = sm.storage.blocks.getLatestBlock(sm.forkId)!;
            const snapshot = sm.storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            )!;
            const encodedState =
                sm.storage.stateMachineStates.getStateMachineState(
                    snapshot.stateMachineStateHash
                )!;
            const storage = sm.storage;
            const hostStateManager = sm as any;
            const originalFlush = storage.flush.bind(storage);
            const originalSetStatus = hostStateManager.setStatus.bind(sm);
            let release!: () => void;
            let entered!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const flushEntered = new Promise<void>((resolve) => {
                entered = resolve;
            });
            let statusPublications = 0;
            storage.flush = async () => {
                entered();
                await held;
            };
            hostStateManager.setStatus = (...args: unknown[]) => {
                statusPublications += 1;
                return originalSetStatus(...args);
            };

            try {
                const update = sm.unsafeSetLatestState(
                    snapshot.toStruct(),
                    encodedState
                );
                await flushEntered;
                const callsBeforeRelease = statusPublications;
                release();
                await update;
                return {
                    callsBeforeRelease,
                    callsAfterRelease: statusPublications
                };
            } finally {
                release();
                storage.flush = originalFlush;
                hostStateManager.setStatus = originalSetStatus;
            }
        });

        expect(result.callsBeforeRelease).to.equal(0);
        expect(result.callsAfterRelease).to.equal(1);
    });

    it("restores persisted state before attaching the channel listener", async function () {
        this.timeout(90_000);

        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({
            waitForPeers: [0],
            waitForFinalization: false
        });

        const result = await h.execOnHost(h.getPeer(0), async (sm) => {
            const stateMachine = (sm as any).diamondStateMachine;
            const listener = (sm as any).stateChannelEventListener;
            const originalSetState = stateMachine.setState.bind(stateMachine);
            const originalSetChannelId = listener.setChannelId.bind(listener);
            let release!: () => void;
            let restoreEntered!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const entered = new Promise<void>((resolve) => {
                restoreEntered = resolve;
            });
            let listenerCalls = 0;
            stateMachine.setState = async (...args: unknown[]) => {
                restoreEntered();
                await held;
                return originalSetState(...args);
            };
            listener.setChannelId = async (...args: unknown[]) => {
                listenerCalls += 1;
                return originalSetChannelId(...args);
            };

            try {
                const channelSetup = sm.setChannelId(sm.channelId);
                await entered;
                const callsBeforeRestore = listenerCalls;
                release();
                await channelSetup;
                return {
                    callsBeforeRestore,
                    callsAfterRestore: listenerCalls
                };
            } finally {
                release();
                stateMachine.setState = originalSetState;
                listener.setChannelId = originalSetChannelId;
            }
        });

        expect(result.callsBeforeRestore).to.equal(0);
        expect(result.callsAfterRestore).to.equal(1);
    });
});
