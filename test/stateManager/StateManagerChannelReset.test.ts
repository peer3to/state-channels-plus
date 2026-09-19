import type StateManager from "@/stateManager";
import { Status } from "@/types";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

// Host-side projection of everything the reset must return to its initial
// value. Shipped as source by execOnHost, so it stays closure-free.
const runtimeState = (
    sm: StateManager<HarnessControlRpc>,
    { forkId }: { forkId: string }
) => ({
    channelId: String(sm.channelId),
    forkId: String(sm.forkId),
    status: sm.status,
    isDisposed: sm.isDisposed,
    isLeaving: sm.leaveChannelService.isLeaving,
    forceExit: sm.storage.forceExit.getForceExit(),
    openConnections: sm.p2pManager.openConnections.length,
    signerAddress: String(sm.signerAddress),
    hasBlocks: sm.storage.blocks.getNextBlockHeight(forkId) > 0,
    genesis: !!sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId),
    queued: sm.storage.queues.tryDequeueAt(forkId, 0).length,
    disputed: sm.storage.disputes.didIDispute(forkId)
});

describe("StateManager.resetChannel", function () {
    it("returns a participating runtime to its pre-channel state", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const leaver = h.getPeer(1);
        const forkId = String(
            await h.control(leaver).query.getForkId().request()
        );
        let exit: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            exit = leaver.p2pInstance.p2pContractInstance.leaveChannel();
        });
        const leave = leaver.p2pInstance.leaveChannel();
        await h.transition.advanceState();
        await h.event.waitForPeers("onLeaveTurn", [leaver.index], 1);
        await exit;
        // Read while the leave is still settling: the stores are populated and
        // the force-exit marker is set, which is what the reset has to undo.
        const before = await h.execOnHost(leaver, runtimeState, { forkId });
        await leave;
        const after = await h.execOnHost(leaver, runtimeState, { forkId });

        expect({ before, after }).to.deep.equal({
            before: {
                ...before,
                channelId: String(h.channelId),
                forkId,
                isDisposed: false,
                isLeaving: true,
                forceExit: true,
                hasBlocks: true,
                genesis: true
            },
            after: {
                channelId: ethers.ZeroHash,
                forkId: ethers.ZeroHash,
                status: Status.NOT_OPENED,
                isDisposed: false,
                isLeaving: false,
                forceExit: false,
                openConnections: 0,
                signerAddress: before.signerAddress,
                hasBlocks: false,
                genesis: false,
                queued: 0,
                disputed: false
            }
        });
    });

    it("keeps rejecting channel work while the leave is still pending", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const leaver = h.getPeer(1);
        let exit: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            exit = leaver.p2pInstance.p2pContractInstance.leaveChannel();
        });
        const leave = leaver.p2pInstance.leaveChannel();
        await h.event.waitUntilLeavePhase(leaver.index, "awaiting-exit");

        await expect(
            leaver.p2pInstance.p2pSigner.connectToChannel(
                ethers.id("reset-pending-target")
            )
        ).to.be.rejectedWith("channel leave is pending");

        await h.transition.advanceState();
        await h.event.waitForPeers("onLeaveTurn", [leaver.index], 1);
        await exit;
        await leave;
    });

    it("accepts another channel selection once the leave has settled", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const leaver = h.getPeer(1);
        await h.lifecycle.leaveWithAuthoredExit(leaver.index);

        const nextChannelId = ethers.id("reset-then-select");
        // No autoOpen: selection is the subject, so the still-unopened target
        // binds the ID and reports false rather than starting discovery. The
        // same call before the reset would have thrown on the owned channel.
        const connected =
            await leaver.p2pInstance.p2pSigner.connectToChannel(nextChannelId);

        expect({
            connected,
            channelId: await h.control(leaver).query.getChannelId().request()
        }).to.deep.equal({ connected: false, channelId: nextChannelId });
    });

    it("releases the leave operation once the reset completes", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        // An unbound runtime owes no departure, so each leave settles and
        // resets at once; the second must start its own operation rather than
        // hand back the first one's settled promise.
        const result = await h.execOnHost(h.getPeer(0), async (sm) => {
            const first = sm.leaveChannelService.leaveChannel();
            await first;
            const leavingBetween = sm.leaveChannelService.isLeaving;
            const second = sm.leaveChannelService.leaveChannel();
            await second;
            return {
                leavingBetween,
                sameOperation: first === second,
                leavingAfter: sm.leaveChannelService.isLeaving
            };
        });

        expect(result).to.deep.equal({
            leavingBetween: false,
            sameOperation: false,
            leavingAfter: false
        });
    });

    it("retires the old fork before the reset first yields", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        // Everything below runs in one host turn: resetChannel runs
        // synchronously up to its first await, which is exactly the window an
        // old-channel log handler can resume into.
        const result = await h.execOnHost(h.getPeer(2), async (sm) => {
            const oldForkId = sm.forkId;
            const reset = sm.resetChannel();
            const activeDuringReset = sm.isActiveFork(oldForkId);
            const reduction = await sm.reductionManager.tryReduce(oldForkId);
            await reset;
            return {
                activeDuringReset,
                reductionStarted: reduction !== undefined
            };
        });

        expect(result).to.deep.equal({
            activeDuringReset: false,
            reductionStarted: false
        });
    });

    it("rejects a channel reset on a disposed runtime", async function () {
        const h = TestSession.getHarness();
        // Unopened runtimes are enough for a guard check; two is the harness minimum.
        await h.setup(2, {
            autoConnect: false,
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const { sm } = runtimeEndpointFor(h.getPeer(0).p2pInstance);
        await sm.dispose();

        await expect(sm.resetChannel()).to.be.rejectedWith("disposed runtime");
    });
});
