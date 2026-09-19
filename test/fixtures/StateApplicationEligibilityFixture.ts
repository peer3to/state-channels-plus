import { buildAndEncodeBlock } from "../factory";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { MathTestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertStateApplicationCache(
    mode: "success" | "failed-read" | "failed-chain-read"
) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const observer =
        mode === "failed-chain-read"
            ? (
                  await h.join.addSpectatorAuthoring({
                      authoringPeerIndices: [0, 1],
                      minimumBlocks: 2,
                      maximumBlocks: 20
                  })
              ).peer
            : h.getPeer(0);
    const newcomer =
        mode === "failed-chain-read"
            ? observer.address
            : ethers.Wallet.createRandom().address;
    const historicalHeight =
        mode === "failed-chain-read"
            ? await h.execOnHost(
                  h.getPeer(observer.index),
                  (sm) => sm.storage.blocks.getNextBlockHeight(sm.forkId) - 1
              )
            : 0;
    await h.transition.insertParticipantOffChain(newcomer, 0n, {
        waitForPeers: [...new Set([0, 1, observer.index])],
        waitForFinalization: false
    });
    const result = await h.execOnHost(
        h.getPeer(observer.index),
        async (sm, args) =>
            sm.withMutex(
                async () => {
                    const historical = sm.storage.blocks.getBlock(
                        sm.forkId,
                        args.historicalHeight
                    )!;
                    const model =
                        sm.storage.stateSnapshots.getStateSnapshotByHash(
                            historical.stateSnapshotHash
                        )!;
                    const encodedState =
                        sm.storage.stateMachineStates.getStateMachineState(
                            model.stateMachineStateHash
                        )!;
                    const machine = sm.diamondStateMachine;
                    const before = {
                        encodedState: String(await machine.getState()),
                        eligibility:
                            sm.membershipService.getCachedSourceEligibility(
                                args.newcomer
                            ),
                        status: sm.status,
                        forkId: sm.forkId
                    };
                    const read = machine.getNextToWrite.bind(machine);
                    const readChain = sm.membershipService.isSignerOnChain.bind(
                        sm.membershipService
                    );
                    const storeSnapshot =
                        sm.storage.stateSnapshots.storeStateSnapshot.bind(
                            sm.storage.stateSnapshots
                        );
                    const storeState =
                        sm.storage.stateMachineStates.storeStateMachineState.bind(
                            sm.storage.stateMachineStates
                        );
                    let writes = 0;
                    let chainReads = 0;
                    sm.storage.stateSnapshots.storeStateSnapshot = (
                        ...args
                    ) => {
                        writes++;
                        return storeSnapshot(...args);
                    };
                    sm.storage.stateMachineStates.storeStateMachineState = (
                        ...args
                    ) => {
                        writes++;
                        return storeState(...args);
                    };
                    sm.membershipService.isSignerOnChain = async () => {
                        chainReads++;
                        if (args.mode === "failed-chain-read")
                            throw new Error(
                                "Injected chain membership read failure"
                            );
                        return readChain();
                    };
                    let failed = false;
                    machine.getNextToWrite = async () => {
                        const result = await read();
                        if (args.mode === "failed-read")
                            throw new Error(
                                "Injected post-state inspection failure"
                            );
                        return result;
                    };
                    try {
                        await sm.stateApplicationService.unsafeSetLatestState(
                            model.toStruct(),
                            encodedState
                        );
                    } catch {
                        failed = true;
                    } finally {
                        machine.getNextToWrite = read;
                        sm.membershipService.isSignerOnChain = readChain;
                        sm.storage.stateSnapshots.storeStateSnapshot =
                            storeSnapshot;
                        sm.storage.stateMachineStates.storeStateMachineState =
                            storeState;
                    }
                    return {
                        before,
                        after: {
                            encodedState: String(await machine.getState()),
                            eligibility:
                                sm.membershipService.getCachedSourceEligibility(
                                    args.newcomer
                                ),
                            status: sm.status,
                            forkId: sm.forkId
                        },
                        failed,
                        writes,
                        chainReads
                    };
                },
                { taskName: "StateApplicationEligibilityFixture" }
            ),
        { newcomer, mode, historicalHeight }
    );
    expect(result.before.eligibility).to.equal(SourceEligibility.ELIGIBLE);
    if (mode === "success") {
        expect(result.failed).to.equal(false);
        expect(result.after.eligibility).to.equal(SourceEligibility.ABSENT);
        expect(result.after.encodedState).not.to.equal(
            result.before.encodedState
        );
    } else {
        expect(result.after).to.deep.equal(result.before);
        expect(result.failed).to.equal(true);
        expect(result.writes).to.equal(0);
        if (mode === "failed-chain-read") expect(result.chainReads).to.equal(1);
    }
}

export async function assertCacheDuringSnapshotPreparation() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 0, { maxChannelParticipants: 4 });
    const retained = ethers.Wallet.createRandom().address;
    const removed = ethers.Wallet.createRandom().address;
    await h.transition.insertParticipantOffChain(retained, 0n, {
        waitForPeers: [0, 1],
        waitForFinalization: false
    });
    await h.transition.insertParticipantOffChain(removed, 0n, {
        waitForPeers: [0, 1],
        waitForFinalization: false
    });
    const observer = h.getPeer(0),
        control = h.control(observer);
    const hold = await h.rpcStub.holdBlockWork(
        observer.index,
        "stateApplicationInspection"
    );
    await control.stub.observeAdmission().request();
    const application = h.execOnHost(observer, (sm) =>
        sm.withMutex(
            async () => {
                const block = sm.storage.blocks.getBlock(sm.forkId, 0)!;
                const snapshot =
                    sm.storage.stateSnapshots.getStateSnapshotByHash(
                        block.stateSnapshotHash
                    )!;
                const encodedState =
                    sm.storage.stateMachineStates.getStateMachineState(
                        snapshot.stateMachineStateHash
                    )!;
                await sm.stateApplicationService.unsafeSetLatestState(
                    snapshot.toStruct(),
                    encodedState
                );
            },
            { taskName: "heldSnapshotPreparation" }
        )
    );
    try {
        await hold.waitUntilEntered();
        expect(
            (await control.query.getSourceEligibility(retained).request()) ===
                SourceEligibility.ELIGIBLE
        ).to.equal(true);
        expect(
            (await control.query.getSourceEligibility(removed).request()) ===
                SourceEligibility.ELIGIBLE
        ).to.equal(true);
        const encodedBlockConfirmation = await buildAndEncodeBlock(
            observer.signer,
            {
                header: {
                    channelId: h.channelId,
                    forkId: h.activeForkId!,
                    transactionCnt: 50
                }
            }
        );
        expect(
            await control.transition
                .ingestBlockConfirmation(encodedBlockConfirmation, {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: retained
                })
                .request()
        ).to.equal(true);
        expect(
            (await control.stub.getAdmissionObservation().request()).chainReads
        ).to.equal(0);
        expect(
            (await control.stub.getAdmissionObservation().request())
                .syncRequests
        ).to.equal(0);
        await hold.release();
        await application;
        expect(
            (await control.query.getSourceEligibility(retained).request()) ===
                SourceEligibility.ELIGIBLE
        ).to.equal(true);
        expect(
            (await control.query.getSourceEligibility(removed).request()) ===
                SourceEligibility.ELIGIBLE
        ).to.equal(false);
    } finally {
        await hold.release();
        await application;
        await h.execOnHost(observer, (sm) =>
            sm.blockQueueManager.clearFork(sm.forkId)
        );
        await control.stub.restoreAdmissionObservation().request();
    }
}

export async function assertReductionCache(cancelled: boolean) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const newcomer = ethers.Wallet.createRandom().address;
    await h.transition.insertParticipantOffChain(newcomer, 0n, {
        waitForPeers: [0, 1],
        waitForFinalization: false
    });
    const result = await h.execOnHost(
        h.getPeer(0),
        (sm, args) =>
            sm.withMutex(
                async () => {
                    const historical = sm.storage.blocks.getBlock(
                        sm.forkId,
                        0
                    )!;
                    const snapshot =
                        sm.storage.stateSnapshots.getStateSnapshotByHash(
                            historical.stateSnapshotHash
                        )!;
                    const encodedState =
                        sm.storage.stateMachineStates.getStateMachineState(
                            snapshot.stateMachineStateHash
                        )!;
                    const previousState =
                        await sm.diamondStateMachine.getState();
                    const before =
                        sm.membershipService.getCachedSourceEligibility(
                            args.newcomer
                        );
                    const forkBefore = sm.forkId;
                    try {
                        const applied =
                            await sm.stateApplicationService.unsafeApplyReductionGenesis(
                                {
                                    ...snapshot.toStruct(),
                                    forkId: snapshot.snapshotDataHash,
                                    blockHeight: 0
                                },
                                encodedState,
                                undefined,
                                () => !args.cancelled
                            );
                        return {
                            applied,
                            before,
                            after: sm.membershipService.getCachedSourceEligibility(
                                args.newcomer
                            ),
                            forkBefore,
                            forkAfter: sm.forkId,
                            published:
                                !!sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                                    snapshot.snapshotDataHash
                                )
                        };
                    } finally {
                        if (args.cancelled)
                            await sm.diamondStateMachine.setState(
                                previousState
                            );
                    }
                },
                { taskName: "cancelledReductionCache" }
            ),
        { newcomer, cancelled }
    );
    expect(result.applied).to.equal(!cancelled);
    expect(result.before).to.equal(SourceEligibility.ELIGIBLE);
    if (cancelled) {
        expect(result.after).to.deep.equal(result.before);
        expect(result.forkAfter).to.equal(result.forkBefore);
    } else {
        expect(result.after).to.equal(SourceEligibility.ABSENT);
        expect(result.forkAfter).not.to.equal(result.forkBefore);
    }
    expect(result.published).to.equal(!cancelled);
}
