import { Codec, Type, hash, tryDecodeCustomError } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import {
    MESSAGE_TYPE_EXIT,
    encodeExitChannelData
} from "@test/utils/mathHarnessAbi";
import { expect } from "chai";
import type {
    MessageBlockStruct,
    BalanceStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { covers } from "./domain";

describe("snapshot-upload / maliciousUpdateSnapshot", function () {
    it(
        "colluded over-withdrawal → updateStateSnapshotSameFork reverts with CantWithdrawMoreThanDeposits",
        covers(
            {
                totalWithdrawals: "inflated"
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
        )
    );

    it(
        "outbound block messages sum exceeds snapshot.totalWithdrawals → updateStateSnapshotSameFork reverts with ErrorOutboundMessageBlocksInvalid",
        covers(
            {
                latestOutboundMessageBlockHash: "not-in-chain"
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
        )
    );

    // what: a snapshot claims the outbound chain is one block taller than it proves.
    it(
        "snapshot.latestOutboundMessageBlockHeight skips ahead of the single outbound block → updateStateSnapshotSameFork reverts with ErrorOutboundMessageBlocksInvalid",
        covers(
            {
                latestOutboundMessageBlockHeight: "mismatch"
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
                                data: encodeExitChannelData(
                                    recipient,
                                    validBalance
                                )
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
                                latestOutboundMessageBlockHeight:
                                    blockHeight + 1n
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
        )
    );
});
