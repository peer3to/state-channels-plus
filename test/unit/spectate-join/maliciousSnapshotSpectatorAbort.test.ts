import { hash } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import {
    decodeMathState,
    encodeMathState,
    type MathStateDecoded
} from "@test/utils/mathHarnessAbi";
import { Status } from "@/types";
import { expect } from "chai";
import { waitFor } from "@test/utils/waitFor";
import type { SnapshotDataStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { covers } from "./domain";

describe("spectate-join / maliciousSnapshotSpectatorAbort", function () {
    // TODO(separate-PR): the test BODY passes, but the afterEach hook hits the
    // known product teardown bug `onStateSnapshotUpdated: unknown snapshot while
    // status=4` (EventHandler.apply) — a slashed/disputed peer (status=4)
    // receiving an unknown snapshot after resolution, same class as the deferred
    // E2E-Spectate case4 teardown. Not a harness-conversion issue; fix product
    // side (status=4 unknown-snapshot handling).
    it(
        "colluded inflated stateMachineState balance → updateStateSnapshotSameFork succeeds, spectator aborts on balance invariant",
        covers(
            {
                syncMode: "spectating",
                payloadVerification: "balance-invariant-fail"
            },
            async function () {
                const h = TestSession.getHarness();

                await h.lifecycle.start(3, 1, {
                    timeConfig: {
                        p2pTime: 5,
                        agreementTime: 2,
                        chainFallbackTime: 2,
                        evidenceTime: 4
                    }
                });

                // Read the seed state-machine bytes host-side (latest block → its
                // snapshot → its state-machine state).
                const encodedStatemachineState = await h.execOnHost(
                    h.getPeer(0),
                    (sm, args) => {
                        const block = sm.storage.blocks.getLatestBlock(
                            args.forkId
                        );
                        if (!block) throw new Error("no latest block");
                        const snapshot =
                            sm.storage.stateSnapshots.getStateSnapshotByHash(
                                block.stateSnapshotHash
                            );
                        if (!snapshot)
                            throw new Error("seed snapshot not found");
                        const encoded =
                            sm.storage.stateMachineStates.getStateMachineState(
                                snapshot.stateMachineStateHash
                            );
                        return encoded === undefined ? null : String(encoded);
                    },
                    { forkId: h.activeForkId! }
                );
                if (!encodedStatemachineState) {
                    throw new Error("seed encoded state not found");
                }

                const decodedStateMachineState = decodeMathState(
                    encodedStatemachineState
                );

                // Inflate balance
                const inflatedDecoded: MathStateDecoded = {
                    ...decodedStateMachineState,
                    // increase the balance of the first participant by 1
                    balances: decodedStateMachineState.balances.map((b, i) =>
                        i === 0 ? b + 1n : b
                    )
                };
                const inflatedEncodedState = encodeMathState(inflatedDecoded);
                const inflatedHash = hash(inflatedEncodedState);

                await h.transition.advanceState();
                await h.byzantine.postFraudulentSnapshot({
                    poster: 0,
                    mutate: ({ originalSnapshotData }) => {
                        const newSnapshotData: SnapshotDataStruct = {
                            ...originalSnapshotData,
                            stateMachineStateHash: inflatedHash
                        };
                        return {
                            snapshotData: newSnapshotData,
                            encodedStateMachineStateOverride:
                                inflatedEncodedState
                        };
                    }
                });

                // Sanity: the on-chain snapshot now has the colluded hash.
                const onChainSnapshot = await h.channelManager.getStateSnapshot(
                    h.channelId
                );
                expect(
                    onChainSnapshot.snapshotData.stateMachineStateHash
                ).to.equal(
                    inflatedHash,
                    "on-chain snapshot must commit to the inflated stateMachineStateHash"
                );

                // The spectator fetches stateMachine bytes via p2p, keyed by on-chain
                // hash; every peer must serve the inflated bytes for the spectator to
                // reach the balance-invariant check.
                // Every peer must serve the inflated bytes for the spectator to reach
                // the balance-invariant check — store them host-side on each peer.
                await Promise.all(
                    h.peers.map((p) =>
                        h.execOnHost(
                            p,
                            (sm, args) => {
                                sm.storage.stateMachineStates.storeStateMachineState(
                                    args.encoded,
                                    { hash: args.hash }
                                );
                            },
                            {
                                encoded: inflatedEncodedState,
                                hash: inflatedHash
                            }
                        )
                    )
                );

                // Add the spectator without waiting for sync so we can install the
                // abort-recording stub host-side before sync starts. Re-fetch via
                // getPeer to recover the harness's typed peer handle.
                const added = await h.join.addSpectator();
                const spectator = h.getPeer(added.index);
                await h
                    .control(spectator)
                    .stub.stubRecordSpectateAbort()
                    .request();

                // Wait for abort.
                await waitFor(
                    () =>
                        h
                            .control(spectator)
                            .stub.wasSpectateAbortCalled()
                            .request(),
                    5000
                );
                expect(
                    await h
                        .control(spectator)
                        .stub.wasSpectateAbortCalled()
                        .request()
                ).to.equal(true, "SpectateService.abort must be called");

                expect(
                    await h.control(spectator).query.getStatus().request()
                ).to.not.equal(Status.SYNCED);
                expect(
                    await h
                        .control(spectator)
                        .query.getOpenConnectionCount()
                        .request()
                ).to.equal(
                    0,
                    "spectator should have 0 open connections after aborting on balance invariant"
                );
            }
        )
    );
});
