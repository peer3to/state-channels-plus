// @spec-test-coverage-ignore: harness helper contract test; the helper is test infrastructure with no specification or implementation IDs
import { expect } from "chai";

import { sleep } from "@/utils";
import { Status } from "@/types";
import {
    MathTestSession as TestSession,
    resolveTestTimeConfig
} from "@test/harness";

describe("JoinActions spectator spawn helper", function () {
    it("counts a slow authoring completion inside the next keep-alive window", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const windowMs =
            resolveTestTimeConfig(h.options.timeConfig).p2pTime * 1000;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let authored = 0;
        let firstFinished = 0;
        let gap = Infinity;
        try {
            await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 0,
                maximumBlocks: 20,
                beforeConnect: async () => gate,
                authorBlock: async () => {
                    if (authored === 1) gap = Date.now() - firstFinished;
                    await h.transition.advanceState({
                        count: 1,
                        waitForPeers: [0, 1]
                    });
                    authored += 1;
                    if (authored === 1) {
                        await sleep(windowMs);
                        firstFinished = Date.now();
                    }
                    if (authored === 2) release();
                }
            });
            expect(gap).to.be.lessThan(windowMs);
        } finally {
            release();
        }
    });

    // Every bound below is a diagnostic ceiling, not a timing assumption: a
    // spawn on a loaded farm can take several p2p windows, and the phase
    // outcome under test must surface before the bound can.
    it("rethrows a peer-creation failure unchanged and authors nothing after it", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const injected = new Error("injected creation failure");
        let thrown: unknown;
        try {
            await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 0,
                maximumBlocks: 20,
                phaseFailures: { creating: injected }
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).to.equal(injected);
        expect(h.peers.length).to.equal(2);
    });

    it("rethrows a beforeConnect failure unchanged without dispatching the connection", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const injected = new Error("injected staging failure");
        let thrown: unknown;
        let stagedPeerIndex: number | undefined;
        try {
            await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 0,
                maximumBlocks: 20,
                beforeConnect: async (peer) => {
                    stagedPeerIndex = peer.index;
                    throw injected;
                }
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).to.equal(injected);
        expect(stagedPeerIndex).to.equal(2);
        // Never connected: the peer holds no channel selection.
        expect(
            await h.control(h.getPeer(2)).query.getStatus().request()
        ).to.equal(Status.NOT_OPENED);
    });

    it("rethrows a connection-dispatch failure unchanged and reports no bound error", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const injected = new Error("injected dispatch failure");
        let thrown: unknown;
        try {
            await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 0,
                maximumBlocks: 20,
                phaseFailures: { dispatching: injected }
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).to.equal(injected);
    });

    it("keeps authoring while beforeConnect is pending and dispatches only after it releases", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let blocksWhileGated = 0;
        let statusBeforeRelease: Status | undefined;
        const result = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 0,
            maximumBlocks: 20,
            beforeConnect: async (peer) => {
                await gate;
                statusBeforeRelease = await h
                    .control(peer)
                    .query.getStatus()
                    .request();
            },
            authorBlock: async () => {
                await h.transition.advanceState({
                    count: 1,
                    waitForPeers: [0, 1]
                });
                blocksWhileGated += 1;
                if (blocksWhileGated === 2) release();
            }
        });
        expect(blocksWhileGated).to.be.greaterThanOrEqual(2);
        // Still disconnected when the gate released: no dispatch before it.
        expect(statusBeforeRelease).to.equal(Status.NOT_OPENED);
        expect(
            await h.control(result.peer).query.getStatus().request()
        ).to.equal(Status.SYNCED);
    });

    it("authors the minimum even when the spectator spawns and syncs fast", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const result = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 3,
            maximumBlocks: 20
        });
        expect(result.blocksAuthored).to.be.greaterThanOrEqual(3);
        // Block heights start at zero, so three authored blocks end at
        // height two on an initially empty fork.
        expect(result.height).to.be.greaterThanOrEqual(
            result.blocksAuthored - 1
        );
        expect(
            await h.control(result.peer).query.getStatus().request()
        ).to.equal(Status.SYNCED);
    });

    it("installs a beforeConnect stub before the first real sync request runs", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        let restore: (() => Promise<void>) | undefined;
        const result = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 1,
            maximumBlocks: 20,
            beforeConnect: async (peer) => {
                restore = await h.rpcStub.recordSpectateSync(peer.index, {
                    forward: true
                });
            }
        });
        try {
            expect(
                await h.rpcStub.spectateSyncCallCount(result.peer.index)
            ).to.be.greaterThanOrEqual(1);
            expect(
                await h.control(result.peer).query.getStatus().request()
            ).to.equal(Status.SYNCED);
        } finally {
            await restore?.();
        }
    });

    it("spawn-only keeps blocks flowing and leaves the spectator OPENED", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        // Participants record sync requests without serving them, so the
        // spectator connects but never syncs.
        const restores = await Promise.all(
            [0, 1].map((index) =>
                h.rpcStub.recordSpectateSync(index, { forward: false })
            )
        );
        try {
            const result = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 2,
                maximumBlocks: 20,
                waitForSynced: false
            });
            expect(result.blocksAuthored).to.be.greaterThanOrEqual(2);
            await h.event.waitUntilPeerStatus(result.peer.index, Status.OPENED);
            expect(
                await h.control(result.peer).query.getStatus().request()
            ).to.equal(Status.OPENED);
        } finally {
            await Promise.all(restores.map((restoreSync) => restoreSync()));
        }
    });
});
