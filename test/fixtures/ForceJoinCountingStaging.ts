// @spec-test-coverage-ignore: force-join and join-check staging shared by the join unit and E2E cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { LeaveChannelState } from "@/stateManager/membership/LeaveChannelService";
import type StateManager from "@/stateManager/StateManager";
import type { JoinRecord } from "@/storage/ForceJoinStorage";
import type { Status } from "@/types";
import type { ForkId } from "@/types/types";
import { waitFor } from "@test/utils/waitFor";

type HarnessPeer = ReturnType<MathPeerTestHarness["getPeer"]>;

/** This runtime's tracked join, as `storage.forceJoin` holds it. */
export type TrackedJoin = JoinRecord;

/** The peer's tracked join, read on its host; null when no join is tracked. */
export async function readTrackedJoin(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<TrackedJoin | null> {
    return await h.execOnHost(peer, (sm) => {
        return sm.storage.forceJoin.getJoin() ?? null;
    });
}

/** Whether the peer's submitted join is not observed on chain yet and can still land. */
export async function isJoinPending(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<boolean> {
    const join = await readTrackedJoin(h, peer);
    return join !== null && join.countingStartsAt === undefined;
}

/** Whether a join check of the peer waits behind the one running (`ChannelJoinService`'s queued check). */
export async function isJoinCheckQueued(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<boolean> {
    return await h.execOnHost(
        peer,
        (sm) => Reflect.get(sm.channelJoinService, "isCheckQueued") === true
    );
}

/** Until the peer's queued join checks (`ChannelJoinService`'s serialized `checks`) have settled. */
export async function waitForJoinChecks(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<void> {
    await h.execOnHost(peer, async (sm) => {
        await Reflect.get(sm.channelJoinService, "checks");
        return true;
    });
}

/**
 * Wait until the pending joiner observed its own join on chain and its own
 * clock passed the agreementTime grace after that observation: blocks the
 * joiner commits from then on count toward the force-join block bound.
 */
export async function waitForceJoinCountingStarted(
    h: MathPeerTestHarness,
    joinerIndex: number
): Promise<void> {
    const joiner = h.getPeer(joinerIndex);
    let countingStartsAt: number | null = null;
    await waitFor(async () => {
        countingStartsAt =
            (await readTrackedJoin(h, joiner))?.countingStartsAt ?? null;
        return countingStartsAt !== null;
    }, h.event.protocolEventTimeoutMs());
    await waitFor(
        async () =>
            (await h.control(joiner).query.getClockTimeInSeconds().request()) >=
            countingStartsAt!,
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * Keep the writer slot alive until the pending joiner has committed its
 * first block that counts toward the force-join bound. Idling through the
 * agreementTime grace after the join would leave the slot idle past
 * p2pTime + agreementTime, and the subjective time check would reject the
 * next block. Returns the joiner's tracking: the dispute fires on block
 * `countingFromHeight + participantCount + 1`.
 */
export async function authorUntilForceJoinCountingStarted(
    h: MathPeerTestHarness,
    joinerIndex: number,
    writers: number[]
) {
    const joiner = h.getPeer(joinerIndex);
    await h.transition.keepAuthoringUntil({
        until: async () =>
            (await readTrackedJoin(h, joiner))?.countingFromHeight !==
            undefined,
        waitForPeers: [...writers, joinerIndex],
        maximumBlocks: 20
    });
    // The wait above ends once the joiner counts the last block, maybe
    // before every writer stores it. A writer behind the tip would author
    // a stale height that the SDK drops, and the caller's next blocks
    // would fall short of the bound.
    await h.assert.sync.peersInSyncWait({
        peerIndices: [...writers, joinerIndex]
    });
    return await readForceJoinBounds(h, joiner);
}

/** The joiner's force-join tracking, read on its host. */
export async function readForceJoinBounds(
    h: MathPeerTestHarness,
    joiner: HarnessPeer
) {
    return await h.execOnHost(joiner, async (sm) => {
        const join = sm.storage.forceJoin.getJoin();
        return {
            submissionHeight: join?.submissionHeight ?? null,
            countingStartsAt: join?.countingStartsAt ?? null,
            countingFromHeight: join?.countingFromHeight ?? null,
            disputeStarted: join?.isDisputeStarted ?? false,
            latestBlockHeight: sm.storage.blocks.getLatestBlockHeight(
                sm.forkId
            ),
            timeConfig: { ...sm.timeConfig },
            participantCount: (await sm.diamondStateMachine.getParticipants())
                .length
        };
    });
}

/**
 * The joiner's force-join check run on its latest committed block, as its
 * commit runs it, settled; returns whether the dispute started and the
 * join is still tracked.
 */
export async function checkForceJoinOnLatestBlock(
    h: MathPeerTestHarness,
    joiner: HarnessPeer
) {
    return await h.execOnHost(joiner, async (sm) => {
        const service = sm.channelJoinService;
        service.onBlockCommitted(
            sm.storage.blocks.getLatestBlock(sm.forkId)!.height
        );
        await Reflect.get(service, "checks");
        const join = sm.storage.forceJoin.getJoin();
        return {
            disputeStarted: join?.isDisputeStarted ?? false,
            markerRetained: join !== undefined
        };
    });
}

/**
 * The real force-join block bound, end to end on one joiner. Three founders
 * omit a spectator's landed join; the joiner observes it on chain itself,
 * which starts the agreementTime grace. The founders author two blocks
 * inside that grace, then, once the joiner's clock is past it, the
 * participants + 1 blocks just below the bound, then one block at it. The
 * joiner's dispute submission is recorded only.
 *
 * `holdJoinSubmission`: the join's submission is held first and the
 * joiner's force-join check runs while the join is not on chain
 * (`beforeLanding`). A repeated check after the bound cannot submit twice.
 *
 * Returns the joiner's tracking after each phase, the first block authored
 * after the grace and the recorded submission counts.
 */
export async function runForceJoinBlockBound(
    h: MathPeerTestHarness,
    options: {
        holdJoinSubmission?: boolean;
    } = {}
) {
    const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
    const joiner = h.getPeer(prepared.joiner.index);
    const founders = [0, 1, 2];
    const authors = [...founders, joiner.index];
    const restores = await Promise.all(
        founders.map((index) => h.byzantine.stubPendingInboundInclusion(index))
    );
    const recorder = await h.rpcStub.recordDisputeSubmissions(joiner.index);
    const releaseSubmission = options.holdJoinSubmission
        ? await h.rpcStub.holdMembershipSubmission(joiner.index, "joinChannel")
        : undefined;
    const submissions = async () => (await recorder.submissions()).length;
    try {
        const join = prepared.joiner.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        let beforeLanding:
            | {
                  disputeStarted: boolean;
                  markerRetained: boolean;
                  submissions: number;
              }
            | undefined;
        if (releaseSubmission) {
            await waitFor(
                async () =>
                    (await h
                        .control(joiner)
                        .stub.getHeldMembershipReceiptCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            beforeLanding = {
                ...(await checkForceJoinOnLatestBlock(h, joiner)),
                submissions: await submissions()
            };
            await releaseSubmission();
        }
        if (!(await join)) throw new Error("staging: the join did not land");
        await waitFor(
            async () =>
                (await readForceJoinBounds(h, joiner)).countingStartsAt !==
                null,
            h.event.protocolEventTimeoutMs()
        );

        // fast blocks inside the grace
        await h.transition.advanceState({ count: 2, waitForPeers: authors });
        const clockAfterGraceBlocks = await h
            .control(joiner)
            .query.getClockTimeInSeconds()
            .request();
        const afterGraceBlocks = await readForceJoinBounds(h, joiner);
        if (clockAfterGraceBlocks >= afterGraceBlocks.countingStartsAt!)
            throw new Error(
                "staging: the grace ended before its blocks were committed"
            );

        await waitForceJoinCountingStarted(h, joiner.index);
        const firstCountedHeight = afterGraceBlocks.latestBlockHeight + 1;
        // the blocks before the bound: the first counted one and N - 1 more
        const bound = afterGraceBlocks.participantCount + 1;
        await h.transition.advanceState({
            count: bound,
            waitForPeers: authors
        });
        const belowBound = await readForceJoinBounds(h, joiner);
        const submissionsBelowBound = await submissions();

        await h.transition.advanceState({ waitForPeers: authors });
        await waitFor(
            async () => (await submissions()) > 0,
            h.event.protocolEventTimeoutMs()
        );
        const atBound = await readForceJoinBounds(h, joiner);
        const submissionsAtBound = await submissions();
        await checkForceJoinOnLatestBlock(h, joiner);
        return {
            beforeLanding,
            afterGraceBlocks,
            firstCountedHeight,
            bound,
            belowBound,
            submissionsBelowBound,
            atBound,
            submissionsAtBound,
            submissionsAfterRecheck: await submissions()
        };
    } finally {
        await releaseSubmission?.();
        await recorder.restore();
        await Promise.all(restores.map((restore) => restore()));
    }
}

/**
 * Hold delivery of the first real membership read of one join check after it
 * answered; later reads retain their normal behavior.
 */
export type HeldForceJoinMembershipRead = {
    entered: () => Promise<boolean>;
    /** The held read's real answer; null until a read is held. */
    answer: () => Promise<boolean | null>;
    release: () => Promise<boolean>;
};

/**
 * `check`: the join check whose chain-membership read is held, the
 * force-join dispute (the default) or the join expiry check
 * (`checkJoinLanded`). The read is held only while that check runs.
 *
 * `releaseOnDispose`: the runtime's disposal releases the held read right
 * after it marks the runtime disposed, so the held check continues into the
 * disposed runtime.
 */
export async function holdForceJoinMembershipRead(
    h: MathPeerTestHarness,
    joinerIndex: number,
    options: {
        check?: "forceJoinDispute" | "joinExpiry";
        releaseOnDispose?: boolean;
    } = {}
): Promise<HeldForceJoinMembershipRead> {
    const peer = h.getPeer(joinerIndex);
    await h.execOnHost(
        peer,
        (sm, hostArgs) => {
            const owner = sm.membershipService;
            const original = owner.isSignerOnChain.bind(owner);
            const joinService = sm.channelJoinService;
            const checkMethod = hostArgs.checkMethod;
            const runCheck = Reflect.get(joinService, checkMethod) as (
                ...args: unknown[]
            ) => Promise<void>;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let held = false;
            // counts the running checks of the held kind: other callers'
            // reads are not held
            let runningChecks = 0;
            Reflect.set(joinService, checkMethod, (...args: unknown[]) => {
                runningChecks += 1;
                const check = runCheck.apply(joinService, args);
                return check.finally(() => {
                    runningChecks -= 1;
                });
            });
            if (hostArgs.releaseOnDispose) {
                // the custom RPC's dispose hook opens the runtime's release
                const localRpc = sm.p2pManager.localRpc;
                const dispose = localRpc.dispose.bind(localRpc);
                localRpc.dispose = () => {
                    const disposing = dispose();
                    release();
                    return disposing;
                };
            }
            Object.defineProperties(owner, {
                forceJoinReadEntered: {
                    value: false,
                    writable: true,
                    configurable: true
                },
                forceJoinReadAnswer: {
                    value: null,
                    writable: true,
                    configurable: true
                },
                releaseForceJoinRead: { value: release, configurable: true },
                restoreForceJoinRead: {
                    configurable: true,
                    value: () =>
                        Reflect.deleteProperty(joinService, checkMethod)
                },
                isSignerOnChain: {
                    configurable: true,
                    value: async () => {
                        const isHeld = runningChecks > 0 && !held;
                        if (isHeld) held = true;
                        const answer = await original();
                        if (isHeld) {
                            Reflect.set(owner, "forceJoinReadAnswer", answer);
                            Reflect.set(owner, "forceJoinReadEntered", true);
                            await gate;
                        }
                        return answer;
                    }
                }
            });
            return true;
        },
        {
            checkMethod:
                options.check === "joinExpiry"
                    ? "checkJoinLanded"
                    : "startForceJoinDispute",
            releaseOnDispose: options.releaseOnDispose ?? false
        }
    );
    return {
        entered: () =>
            h.execOnHost(
                peer,
                (sm) =>
                    Reflect.get(
                        sm.membershipService,
                        "forceJoinReadEntered"
                    ) === true
            ),
        answer: () =>
            h.execOnHost(
                peer,
                (sm) =>
                    (Reflect.get(sm.membershipService, "forceJoinReadAnswer") ??
                        null) as boolean | null
            ),
        release: () =>
            h.execOnHost(peer, (sm) => {
                Reflect.get(sm.membershipService, "releaseForceJoinRead")?.();
                Reflect.get(sm.membershipService, "restoreForceJoinRead")?.();
                for (const key of [
                    "isSignerOnChain",
                    "restoreForceJoinRead",
                    "forceJoinReadEntered",
                    "forceJoinReadAnswer",
                    "releaseForceJoinRead"
                ])
                    Reflect.deleteProperty(sm.membershipService, key);
                return true;
            })
    };
}

/** Observe the real dispute request boundary without changing its behavior. */
export async function observeDisputeRequests(
    h: MathPeerTestHarness,
    peerIndex: number
) {
    const peer = h.getPeer(peerIndex);
    await h.execOnHost(peer, (sm) => {
        const owner = sm.disputeManager;
        if (Object.getOwnPropertyDescriptor(owner, "requestDispute"))
            throw new Error("A dispute request observer is already installed");
        const original = owner.requestDispute.bind(owner);
        const requests: string[] = [];
        Reflect.set(owner, "observedDisputeRequests", requests);
        Object.defineProperty(owner, "requestDispute", {
            configurable: true,
            value: (forkId: ForkId) => {
                requests.push(String(forkId));
                original(forkId);
            }
        });
        return true;
    });
    return {
        requests: () =>
            h.execOnHost(
                peer,
                (sm) =>
                    [
                        ...Reflect.get(
                            sm.disputeManager,
                            "observedDisputeRequests"
                        )
                    ] as string[]
            ),
        restore: () =>
            h.execOnHost(peer, (sm) => {
                Reflect.deleteProperty(sm.disputeManager, "requestDispute");
                Reflect.deleteProperty(
                    sm.disputeManager,
                    "observedDisputeRequests"
                );
                return true;
            })
    };
}

/** The joiner's host state right after it emitted `onLeftChannel`. */
export type MembershipEndObservation = {
    status: Status;
    trackedJoin: TrackedJoin | null;
    leaveState: LeaveChannelState | null;
    /** Whether the last read of the installed local state before the event listed the signer; null without a read. */
    isSignerInLocalState: boolean | null;
};

/**
 * Record-only: on the retained inline host (see `runtimeEndpointFor`),
 * records the answer of each real read of the installed local state's
 * participants (every membership drop decides on one) and, once the runtime
 * emits `onLeftChannel` and its synchronous subscribers ran, the host state.
 * The record stays readable after the runtime disposes itself.
 */
export function observeMembershipEnd(sm: StateManager) {
    const diamond = sm.diamondStateMachine;
    const readParticipants = diamond.getParticipants.bind(diamond);
    let isSignerInLocalState: boolean | null = null;
    let atLeft: MembershipEndObservation | undefined;
    Object.defineProperty(diamond, "getParticipants", {
        configurable: true,
        value: async () => {
            const participants = await readParticipants();
            isSignerInLocalState = participants.includes(sm.signerAddress);
            return participants;
        }
    });
    sm.events.on("p2pEventHooks", "onLeftChannel", () => {
        queueMicrotask(() => {
            atLeft ??= {
                status: sm.status,
                trackedJoin: sm.storage.forceJoin.getJoin() ?? null,
                leaveState: sm.leaveChannelService.state ?? null,
                isSignerInLocalState
            };
        });
    });
    return { atLeft: () => atLeft };
}
