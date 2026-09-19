import type StateManager from "@/stateManager";
import { Status } from "@/types";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";
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

    it("shuts the runtime down and rejects the leave when the reset cannot drain", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const peer = h.getPeer(0);
        // Single-use fault: chain-log work that outlives the drain bound.
        await h.execOnHost(peer, (sm) => {
            sm.stateChannelEventListener.drain = async () => false;
        });

        await expect(peer.p2pInstance.leaveChannel()).to.be.rejectedWith(
            "cannot be reused"
        );

        expect(
            await new TargetedChannelJoinFixture(h).isDisposed(peer)
        ).to.equal(true);
    });

    it("fails a pending join wait instead of leaving it hanging across the reset", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const join = sm.p2pManager.localRpc.joinChannelService;
                // A threshold participant that never connects: only the
                // wait's own timer, or the reset, can settle it.
                const waiting = join["waitForThresholdReachability"](
                    [args.absentParticipant],
                    String(sm.signerAddress)
                ).then(
                    () => "resolved",
                    (error: Error) => error.message
                );
                await sm.resetChannel();
                // Time is the oracle: settling promptly is the property, the
                // wait's own timeout is far longer than this bound.
                return await Promise.race([
                    waiting,
                    new Promise<string>((resolve) =>
                        setTimeout(() => resolve("still pending"), 5000)
                    )
                ]);
            },
            { absentParticipant: ethers.Wallet.createRandom().address }
        );

        expect(result).to.include("the runtime left the channel");
    });

    it("keeps blacklist verdicts across the reset and forgets every other peer", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const result = await h.execOnHost(
            h.getPeer(2),
            async (sm, args) => {
                sm.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    args.banned
                );
                const profiles = sm.p2pManager.profileManager;
                const before = !!profiles.getProfileByEvmAddress(args.other);
                await sm.resetChannel();
                return {
                    otherKnownBefore: before,
                    bannedStillBlacklisted: sm.p2pManager.isBlacklisted(
                        args.banned
                    ),
                    otherKnownAfter: !!profiles.getProfileByEvmAddress(
                        args.other
                    )
                };
            },
            { banned: h.getPeer(0).address, other: h.getPeer(1).address }
        );

        expect(result).to.deep.equal({
            otherKnownBefore: true,
            bannedStillBlacklisted: true,
            otherKnownAfter: false
        });
    });

    it("stops a reduction submit already in flight from reaching the chain after the reset", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const writes = await h.execOnHost(h.getPeer(0), async (sm) => {
            // Monkey-patching typed contract members needs the casts. The
            // submit is parked on its gas-limit read, its last await before
            // the chain write, and the reset lands while it waits there.
            const contract = sm.stateChannelManagerContract as unknown as {
                getGasLimit: () => Promise<bigint>;
                multicall: (...args: unknown[]) => unknown;
            };
            const gasLimit = contract.getGasLimit.bind(contract);
            const multicall = contract.multicall.bind(contract);
            let writeCount = 0;
            let release: () => void = () => undefined;
            contract.getGasLimit = () =>
                new Promise<bigint>((resolve) => {
                    release = () => resolve(1_000_000n);
                });
            contract.multicall = (...args: unknown[]) => {
                writeCount += 1;
                return multicall(...args);
            };
            try {
                const executor = sm.reductionManager["reductionExecutor"];
                executor["submitDetached"](sm.forkId, {} as never, {
                    calldata: []
                });
                await new Promise((resolve) => setTimeout(resolve, 50));
                await sm.resetChannel();
                release();
                // Let the parked write resume and land, if it is going to.
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return writeCount;
            } finally {
                contract.getGasLimit = gasLimit;
                contract.multicall = multicall;
            }
        });

        expect(writes).to.equal(0);
    });

    it("does not join the channel it is leaving when the signatures arrive late", async function () {
        const { h, channelId, targeted } =
            await TargetedChannelJoinFixture.unopened("reset-late-join", 3);
        await targeted.openWithPeers(channelId, [0, 1]);
        const joiner = h.getPeer(2);
        // A synced observer is the state a join starts from.
        expect(await targeted.connect(joiner, channelId)).to.equal(true);

        const result = await h.execOnHost(
            joiner,
            async (sm, args) => {
                const join = sm.p2pManager.localRpc.joinChannelService;
                const prepare = join.prepareJoinChannelConfirmation.bind(join);
                // Single-use hold: the signature round trip is where a leave
                // can settle underneath an in-flight connectToChannel.
                let release: () => void = () => undefined;
                const held = new Promise<void>((resolve) => {
                    release = resolve;
                });
                let hold: () => void = () => undefined;
                const holding = new Promise<void>((resolve) => {
                    hold = resolve;
                });
                join.prepareJoinChannelConfirmation = async (...callArgs) => {
                    const prepared = await prepare(...callArgs);
                    // Signal the hold rather than sleep: the reset has to land
                    // after the last of the join's own round trips, or the join
                    // fails on a cut transport instead of on the fence.
                    hold();
                    await held;
                    return prepared;
                };
                const membership = sm.membershipService;
                const joinChannel = membership.joinChannel.bind(membership);
                let joinCalls = 0;
                membership.joinChannel = (...callArgs) => {
                    joinCalls += 1;
                    return joinChannel(...callArgs);
                };
                try {
                    const connect = sm.p2pManager.p2pSigner.connectToChannel(
                        args.channelId,
                        { shouldJoin: true }
                    );
                    await holding;
                    await sm.resetChannel();
                    release();
                    return { connected: await connect, joinCalls };
                } finally {
                    join.prepareJoinChannelConfirmation = prepare;
                    membership.joinChannel = joinChannel;
                }
            },
            { channelId }
        );

        expect(result).to.deep.equal({ connected: false, joinCalls: 0 });
    });

    it("does not penalise a peer for an acknowledgement that outlived its channel", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const result = await h.execOnHost(
            h.getPeer(2),
            async (sm, args) => {
                const forkAck = sm.p2pManager.localRpc.isForkDisputedService;
                const p2p = sm.p2pManager;
                const ban =
                    p2p.disconnectAndBlacklistPeerByEvmAddress.bind(p2p);
                let bans = 0;
                p2p.disconnectAndBlacklistPeerByEvmAddress = (address) => {
                    bans += 1;
                    return ban(address);
                };
                try {
                    // No peer answers a fork nobody disputed, so every request
                    // fails: without the fence each failure bans its peer.
                    forkAck.requestDisputeAcknowledgment(
                        sm.channelId,
                        args.forkId
                    );
                    await sm.resetChannel();
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    return {
                        bans,
                        blacklisted: p2p.isBlacklisted(args.peer)
                    };
                } finally {
                    p2p.disconnectAndBlacklistPeerByEvmAddress = ban;
                }
            },
            { forkId: ethers.id("ack-fork"), peer: h.getPeer(0).address }
        );

        expect(result).to.deep.equal({ bans: 0, blacklisted: false });
    });

    it("records no verdict while the channel is being released", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const result = await h.execOnHost(
            h.getPeer(2),
            async (sm, args) => {
                const drain = sm.stateChannelEventListener.drain.bind(
                    sm.stateChannelEventListener
                );
                // Park the reset mid-flight and try to earn a verdict there.
                let release: () => void = () => undefined;
                const held = new Promise<void>((resolve) => {
                    release = resolve;
                });
                sm.stateChannelEventListener.drain = async () => {
                    await held;
                    return drain();
                };
                const reset = sm.resetChannel();
                await new Promise((resolve) => setTimeout(resolve, 50));
                sm.p2pManager.disconnectAndBlacklistPeerByEvmAddress(args.peer);
                const duringReset = sm.p2pManager.isBlacklisted(args.peer);
                release();
                await reset;
                sm.stateChannelEventListener.drain = drain;
                return {
                    duringReset,
                    afterReset: sm.p2pManager.isBlacklisted(args.peer)
                };
            },
            { peer: h.getPeer(0).address }
        );

        expect(result).to.deep.equal({
            duringReset: false,
            afterReset: false
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
