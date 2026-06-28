import { Codec, Type, hash, tryDecodeCustomError } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import {
    MESSAGE_TYPE_EXIT,
    decodeMathState,
    encodeExitChannelData,
    encodeMathState,
    type MathStateDecoded
} from "@test/utils/mathHarnessAbi";
import { Status } from "@/types";
import { expect } from "chai";
import { waitFor } from "@test/utils/waitFor";
import type {
    MessageBlockStruct,
    BalanceStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { scenario } from "@test/harness/scenario";

describe("E2E: Malicious updateSnapshot", function () {
    scenario(
        "colluded over-withdrawal → updateStateSnapshotSameFork reverts with CantWithdrawMoreThanDeposits",
        {
            invariant: "conservation",
            target: "SnapshotData.totalWithdrawals:inflated"
        },
        async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const initialBalance = h.options.initialBalance!;
            const totalDeposits =
                BigInt(initialBalance) * BigInt(h.peers.length);
            const inflatedAmount = totalDeposits + 500n;
            const recipient = h.getPeer(0).address;

            let revertError: unknown;
            try {
                await h.byzantine.postFraudulentSnapshot({
                    poster: 0,
                    mutate: ({ originalSnapshotData, blockTimestamp }) => {
                        const previousBlockHash =
                            originalSnapshotData.latestOutboundMessageBlockHash as string;
                        const newHeight =
                            BigInt(
                                originalSnapshotData.latestOutboundMessageBlockHeight
                            ) + 1n;
                        const fraudulentBalance: BalanceStruct = {
                            amount: inflatedAmount,
                            data: "0x"
                        };
                        const fakeMessage = {
                            messageType: MESSAGE_TYPE_EXIT,
                            participant: recipient,
                            balance: fraudulentBalance,
                            data: encodeExitChannelData(
                                recipient,
                                fraudulentBalance
                            )
                        };

                        const block: MessageBlockStruct = {
                            previousBlockHash,
                            blockHeight: newHeight,
                            messages: [fakeMessage],
                            totalBalance: fraudulentBalance,
                            timestamp: BigInt(blockTimestamp)
                        };
                        const blockHash = hash(
                            Codec.encode(block, Type.MessageBlock)
                        );
                        const newSnapshotData: SnapshotDataStruct = {
                            ...originalSnapshotData,
                            totalWithdrawals: fraudulentBalance,
                            latestOutboundMessageBlockHash: blockHash,
                            latestOutboundMessageBlockHeight: newHeight
                        };
                        return {
                            snapshotData: newSnapshotData,
                            outboundMessageBlock: block
                        };
                    }
                });
                expect.fail(
                    "expected updateStateSnapshotSameFork to revert with CantWithdrawMoreThanDeposits"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError, "expected decodable custom error").to.not.be
                .null;
            expect(customError!.errorDescription.name).to.equal(
                "CantWithdrawMoreThanDeposits"
            );
        }
    );

    scenario(
        "outbound block messages sum exceeds snapshot.totalWithdrawals → updateStateSnapshotSameFork reverts with ErrorOutboundMessageBlocksInvalid",
        {
            invariant: "conservation",
            target: "SnapshotData.latestOutboundMessageBlockHash:not-in-chain"
        },
        async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const initialBalance = h.options.initialBalance!;
            const totalDeposits =
                BigInt(initialBalance) * BigInt(h.peers.length);
            const inflatedAmount = totalDeposits + 500n;
            const recipient = h.getPeer(0).address;

            let revertError: unknown;
            try {
                await h.byzantine.postFraudulentSnapshot({
                    poster: 0,
                    mutate: ({ originalSnapshotData, blockTimestamp }) => {
                        const previousBlockHash =
                            originalSnapshotData.latestOutboundMessageBlockHash as string;
                        const newHeight =
                            BigInt(
                                originalSnapshotData.latestOutboundMessageBlockHeight
                            ) + 1n;
                        const fraudulentBalance: BalanceStruct = {
                            amount: inflatedAmount,
                            data: "0x"
                        };
                        const fakeMessage = {
                            messageType: MESSAGE_TYPE_EXIT,
                            participant: recipient,
                            balance: fraudulentBalance,
                            data: encodeExitChannelData(
                                recipient,
                                fraudulentBalance
                            )
                        };

                        const block: MessageBlockStruct = {
                            previousBlockHash,
                            blockHeight: newHeight,
                            messages: [fakeMessage],
                            totalBalance: fraudulentBalance,
                            timestamp: BigInt(blockTimestamp)
                        };
                        const blockHash = hash(
                            Codec.encode(block, Type.MessageBlock)
                        );
                        const newSnapshotData: SnapshotDataStruct = {
                            ...originalSnapshotData,
                            latestOutboundMessageBlockHash: blockHash,
                            latestOutboundMessageBlockHeight: newHeight
                        };
                        return {
                            snapshotData: newSnapshotData,
                            outboundMessageBlock: block
                        };
                    }
                });
                expect.fail(
                    "expected updateStateSnapshotSameFork to revert with ErrorOutboundMessageBlocksInvalid"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError, "expected decodable custom error").to.not.be
                .null;
            expect(customError!.errorDescription.name).to.equal(
                "ErrorOutboundMessageBlocksInvalid"
            );
        }
    );

    // what: a snapshot claims the outbound chain is one block taller than it proves.
    scenario(
        "snapshot.latestOutboundMessageBlockHeight skips ahead of the single outbound block → updateStateSnapshotSameFork reverts with ErrorOutboundMessageBlocksInvalid",
        {
            invariant: "attacker-pays",
            target: "SnapshotData.latestOutboundMessageBlockHeight:mismatch"
        },
        async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            // small withdrawal that stays within deposits, so the balance-invariant
            // and sum checks pass and the only failing condition is the height
            const withdrawAmount = 100n;
            const recipient = h.getPeer(0).address;

            let revertError: unknown;
            try {
                await h.byzantine.postFraudulentSnapshot({
                    poster: 0,
                    mutate: ({ originalSnapshotData, blockTimestamp }) => {
                        const previousBlockHash =
                            originalSnapshotData.latestOutboundMessageBlockHash as string;
                        // one valid outbound block at the correct next height
                        const blockHeight =
                            BigInt(
                                originalSnapshotData.latestOutboundMessageBlockHeight
                            ) + 1n;
                        const validBalance: BalanceStruct = {
                            amount: withdrawAmount,
                            data: "0x"
                        };
                        const fakeMessage = {
                            messageType: MESSAGE_TYPE_EXIT,
                            participant: recipient,
                            balance: validBalance,
                            data: encodeExitChannelData(recipient, validBalance)
                        };

                        const block: MessageBlockStruct = {
                            previousBlockHash,
                            blockHeight,
                            messages: [fakeMessage],
                            totalBalance: validBalance,
                            timestamp: BigInt(blockTimestamp)
                        };
                        const blockHash = hash(
                            Codec.encode(block, Type.MessageBlock)
                        );
                        // skip the snapshot height one past what the single block
                        // justifies -> expectedHeight (lower+1) != snapshot height
                        const newSnapshotData: SnapshotDataStruct = {
                            ...originalSnapshotData,
                            totalWithdrawals: validBalance,
                            latestOutboundMessageBlockHash: blockHash,
                            latestOutboundMessageBlockHeight: blockHeight + 1n
                        };
                        return {
                            snapshotData: newSnapshotData,
                            outboundMessageBlock: block
                        };
                    }
                });
                expect.fail(
                    "expected updateStateSnapshotSameFork to revert with ErrorOutboundMessageBlocksInvalid"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError, "expected decodable custom error").to.not.be
                .null;
            expect(customError!.errorDescription.name).to.equal(
                "ErrorOutboundMessageBlocksInvalid"
            );
        }
    );

    // TODO(separate-PR): the test BODY passes, but the afterEach hook hits the
    // known product teardown bug `onStateSnapshotUpdated: unknown snapshot while
    // status=4` (EventHandler.apply) — a slashed/disputed peer (status=4)
    // receiving an unknown snapshot after resolution, same class as the deferred
    // E2E-Spectate case4 teardown. Not a harness-conversion issue; fix product
    // side (status=4 unknown-snapshot handling).
    scenario(
        "colluded inflated stateMachineState balance → updateStateSnapshotSameFork succeeds, spectator aborts on balance invariant",
        {
            invariant: "no-honest-loss",
            target: "SnapshotData.stateMachineStateHash:mismatch"
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
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("no latest block");
                    const snapshot =
                        sm.storage.stateSnapshots.getStateSnapshotByHash(
                            block.stateSnapshotHash
                        );
                    if (!snapshot) throw new Error("seed snapshot not found");
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
                        encodedStateMachineStateOverride: inflatedEncodedState
                    };
                }
            });

            // Sanity: the on-chain snapshot now has the colluded hash.
            const onChainSnapshot = await h.channelManager.getStateSnapshot(
                h.channelId
            );
            expect(onChainSnapshot.snapshotData.stateMachineStateHash).to.equal(
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
                        { encoded: inflatedEncodedState, hash: inflatedHash }
                    )
                )
            );

            // Add the spectator without waiting for sync so we can install the
            // abort-recording stub host-side before sync starts. Re-fetch via
            // getPeer to recover the harness's typed peer handle.
            const added = await h.join.addSpectator();
            const spectator = h.getPeer(added.index);
            await h.control(spectator).stub.stubRecordSpectateAbort().request();

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
    );
});
