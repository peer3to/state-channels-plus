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
import * as sinon from "sinon";
import type {
    MessageBlockStruct,
    BalanceStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

describe("E2E: Malicious updateSnapshot", function () {
    it("colluded over-withdrawal → updateStateSnapshotSameFork reverts with CantWithdrawMoreThanDeposits", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);

        const initialBalance = h.options.initialBalance!;
        const totalDeposits = BigInt(initialBalance) * BigInt(h.peers.length);
        const inflatedAmount = totalDeposits + 500n;
        const recipient = h.getPeer(0).address;

        const restore = h.tamper.colludeOnFraudulentSnapshot({
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
                    data: encodeExitChannelData(recipient, fraudulentBalance)
                };

                const block: MessageBlockStruct = {
                    previousBlockHash,
                    blockHeight: newHeight,
                    messages: [fakeMessage],
                    totalBalance: fraudulentBalance,
                    timestamp: BigInt(blockTimestamp)
                };
                const blockHash = hash(Codec.encode(block, Type.MessageBlock));
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

        // One transition: every  peer's storage now holds the fraudulent snapshot + outbound block.
        await h.transition.advanceState();
        restore();

        let revertError: unknown;
        try {
            await h.transition.postSnapshotWait({ peerIndex: 0 });
            expect.fail(
                "expected updateStateSnapshotSameFork to revert with CantWithdrawMoreThanDeposits"
            );
        } catch (e) {
            revertError = e;
        }

        const customError = tryDecodeCustomError(revertError);
        expect(customError, "expected decodable custom error").to.not.be.null;
        expect(customError!.errorDescription.name).to.equal(
            "CantWithdrawMoreThanDeposits"
        );
    });

    it("colluded inflated stateMachineStateHash → updateStateSnapshotSameFork succeeds, spectator aborts on balance invariant", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(3, 1, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 4
            }
        });

        const block = h
            .getPeer(0)
            .stateManager.storage.blocks.getLatestBlock(h.activeForkId!)!;
        const snapshot = h
            .getPeer(0)
            .stateManager.storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            )!;
        const encodedStatemachineState = h
            .getPeer(0)
            .stateManager.storage.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            );
        if (!encodedStatemachineState) {
            throw new Error("seed encoded state not found");
        }

        const decodedStateMachineState = decodeMathState(
            encodedStatemachineState as string
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

        const restore = h.tamper.colludeOnFraudulentSnapshot({
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

        // One colluded transition. After this, every peer's storage:
        //   - has a snapshot whose stateMachineStateHash = keccak(inflatedEncoded)
        //   - has the inflated bytes stored under that hash
        await h.transition.advanceState();
        restore();

        // Push the colluded snapshot on-chain. await the receipt; call expected to succeed.
        await h.transition.postSnapshotWait({ peerIndex: 0 });

        // Sanity: the on-chain snapshot now has the colluded hash.
        const onChainSnapshot = await h.channelManager.getStateSnapshot(
            h.channelId
        );
        expect(onChainSnapshot.snapshotData.stateMachineStateHash).to.equal(
            inflatedHash,
            "on-chain snapshot must commit to the inflated stateMachineStateHash"
        );

        // Spectator joins. Each peer serves the inflated bytes.

        // We add the spectator via the private `addSpectator` so we can install spies
        // before sync starts and observe the abort directly.
        const spectator = await (
            h.join as unknown as {
                addSpectator: (typeof h.join)["addSpectatorWait"];
            }
        ).addSpectator();

        // Spy on the abort method directly
        const spectateService =
            spectator.stateManager.p2pManager.localRpc.spectateService;
        const abortSpy = sinon.spy(spectateService, "abort");

        // Wait for abort.
        await h.eventCountsBarrier.waitFor(() => abortSpy.callCount > 0, {
            timeoutMs: 5000,
            timeoutMessage:
                "expected SpectateService.abort to fire on the inflated-state spectator within 5000ms"
        });

        expect(abortSpy.callCount).to.be.greaterThan(
            0,
            "SpectateService.abort must be called"
        );

        expect(spectator.stateManager.getStatus()).to.not.equal(Status.SYNCED);
        expect(
            spectator.stateManager.p2pManager.openConnections.length
        ).to.equal(
            0,
            "spectator should have 0 open connections after aborting on balance invariant"
        );
    });
});
