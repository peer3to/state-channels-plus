import HostNonceManager from "@/evm/signer/HostNonceManager";
import Storage from "@/storage";
import { withGasHeadroom } from "@/utils/gas";
import { GatedMemoryLevel } from "@test/fixtures/GatedMemoryLevel";
import {
    assertIsolatedBoundedReadCountsLaterReceipt,
    assertIsolatedBroadcastSharesStartBlockRead,
    assertIsolatedRecoveredBroadcastRecorded,
    assertIsolatedRecoveredReplacementDetected,
    assertIsolatedRecoveryOutlivesFailedBlockNumberRead,
    assertIsolatedReplacedTransactionAbsent,
    assertIsolatedRevertedGasRecorded,
    assertIsolatedSettleIgnoresLaterObservation
} from "@test/fixtures/node/IsolatedGasUsageFixture";
import {
    mineBlocks,
    testAccount,
    withIsolatedHardhatNode
} from "@test/fixtures/node/IsolatedHardhatNode";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
import assert from "node:assert/strict";
import sinon from "sinon";

/**
 * A funded sender whose manager waits on a real storage over a gated disk;
 * `write` leaves a write pending, so a flush needs one batch.
 */
async function gatedSender(provider: ethers.JsonRpcProvider) {
    const funder = await testAccount(provider, 0);
    const recipient = await testAccount(provider, 1);
    const sender = ethers.Wallet.createRandom().connect(provider);
    await (
        await funder.sendTransaction({
            to: sender.address,
            value: ethers.parseEther("1")
        })
    ).wait();
    const database = new GatedMemoryLevel();
    const storage = new Storage(undefined, undefined, {
        flushIntervalMs: 60_000
    });
    await storage.open(database.handle(), () => undefined);
    const manager = new HostNonceManager(sender, undefined, () =>
        storage.flush()
    );
    const pendingNonce = () =>
        provider.getTransactionCount(sender.address, "pending");
    return {
        recipient,
        database,
        storage,
        manager,
        pendingNonce,
        write: () => storage.forceExit.setForceExit(true)
    };
}

/** Never contacted: the reconnect case only needs a provider object. */
const UNUSED_NODE_URL = "http://127.0.0.1:1";
/** Init code that deploys the one-byte runtime `STOP` (`0x00`). */
const STOP_RUNTIME_INIT_CODE = "0x6001600c60003960016000f300";

describe("HostNonceManager", () => {
    it("reuses a failed middle nonce without colliding with concurrent sends", async () => {
        await withIsolatedHardhatNode(
            async (provider) => {
                const funder = await testAccount(provider, 0);
                const recipient = await testAccount(provider, 1);
                const sender = ethers.Wallet.createRandom().connect(provider);
                const funding = await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                });
                await mineBlocks(provider, 1);
                await funding.wait();
                const manager = new HostNonceManager(sender);
                const pendingNonce = await sender.getNonce("pending");

                const results = await Promise.allSettled([
                    manager.sendTransaction({
                        to: recipient.address,
                        value: 1n
                    }),
                    manager.sendTransaction({
                        to: recipient.address,
                        value: ethers.MaxUint256
                    }),
                    manager.sendTransaction({
                        to: recipient.address,
                        value: 2n
                    })
                ]);
                expect(results[0].status, "first send must broadcast").to.equal(
                    "fulfilled"
                );
                expect(results[1].status, "middle send must fail").to.equal(
                    "rejected"
                );
                expect(results[2].status, "third send must broadcast").to.equal(
                    "fulfilled"
                );
                const acceptedResponses = results.flatMap((result) =>
                    result.status === "fulfilled" ? [result.value] : []
                );
                await mineBlocks(provider, 1);
                await Promise.all(
                    acceptedResponses.map((response) => response.wait())
                );

                const subsequentResponse = await manager.sendTransaction({
                    to: recipient.address,
                    value: 3n
                });
                await mineBlocks(provider, 1);
                await subsequentResponse.wait();

                expect(
                    acceptedResponses
                        .concat(subsequentResponse)
                        .map((response) => response.nonce)
                ).to.deep.equal([
                    pendingNonce,
                    pendingNonce + 1,
                    pendingNonce + 2
                ]);
            },
            { seal: "manual" }
        );
    });

    it("sends without a caller limit using its estimate plus headroom and keeps an explicit limit", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);
            const request = {
                to: recipient.address,
                value: 1n,
                data: "0x1234"
            };
            const estimate = await sender.estimateGas(request);

            expect(await manager.estimateGas(request)).to.equal(
                withGasHeadroom(estimate)
            );
            const estimated = await manager.sendTransaction(request);
            await estimated.wait();
            expect(estimated.gasLimit).to.equal(withGasHeadroom(estimate));

            const explicitLimit = estimate + 1n;
            const explicit = await manager.sendTransaction({
                ...request,
                gasLimit: explicitLimit
            });
            await explicit.wait();
            expect(explicit.gasLimit).to.equal(explicitLimit);
        });
    });

    it("records the gas of the transactions it broadcast, named by selector", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const callee = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);
            // a manager selector, and one no SDK contract declares
            const namedSelector = ethers
                .id("postBlockCalldata((bytes,bytes),uint256)")
                .slice(0, 10);
            const unknownSelector = ethers
                .id("neverDeclaredOnAnySdkContract()")
                .slice(0, 10);

            for (const data of [
                namedSelector,
                namedSelector,
                unknownSelector
            ]) {
                const response = await manager.sendTransaction({
                    to: callee.address,
                    data
                });
                await response.wait();
            }

            const rows = await manager.gasUsage.settledSnapshot();
            expect(rows.length).to.equal(2);
            const named = rows.find(
                (row) => row.functionSelector === namedSelector
            )!;
            const unknown = rows.find(
                (row) => row.functionSelector === unknownSelector
            )!;
            expect(named.functionName).to.equal("postBlockCalldata");
            expect(unknown.functionName).to.equal(unknownSelector);
            expect(named.contractAddress).to.equal(callee.address);
            expect(named.successCount).to.equal(2);
            expect(named.revertedCount).to.equal(0);
            expect(named.revertedGasUsed).to.equal("0");
            // two identical calls: the total is twice each bound
            expect(named.minGasUsed).to.equal(named.maxGasUsed);
            expect(BigInt(named.successGasUsed)).to.equal(
                BigInt(named.minGasUsed) * 2n
            );
            expect(BigInt(named.minGasUsed) > 0n).to.equal(true);
            expect(unknown.successCount).to.equal(1);
        });
    });

    it("records a reverted call under the reverted fields only", async () => {
        await assertIsolatedRevertedGasRecorded();
    });

    it("leaves a replaced transaction out of the table", async () => {
        await assertIsolatedReplacedTransactionAbsent();
    });

    it("settles the observations started before the call, not the later ones", async () => {
        await assertIsolatedSettleIgnoresLaterObservation();
    });

    it("leaves a pending receipt out of a bounded read and counts it once it mines", async () => {
        await assertIsolatedBoundedReadCountsLaterReceipt();
    });

    it("records a transaction the node already held when its broadcast failed", async () => {
        await assertIsolatedRecoveredBroadcastRecorded();
    });

    it("settles and leaves out a recovered transaction once its replacement mines", async () => {
        await assertIsolatedRecoveredReplacementDetected();
    });

    it("sends its replacement-scan start-block read in the same request as the broadcast", async () => {
        await assertIsolatedBroadcastSharesStartBlockRead();
    });

    it("recovers a transaction the node accepted when the broadcast's block-number read failed", async () => {
        await assertIsolatedRecoveryOutlivesFailedBlockNumberRead();
    });

    it("records nothing for a broadcast the node rejected", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);

            // More than the wallet holds, and an explicit limit so nothing is
            // estimated: the node refuses the broadcast and never holds it.
            await assert.rejects(
                manager.sendTransaction({
                    to: recipient.address,
                    value: ethers.parseEther("2"),
                    gasLimit: 21_000n
                }),
                /enough funds|insufficient funds/
            );

            expect(await manager.gasUsage.settledSnapshot()).to.deep.equal([]);
        });
    });

    it("leaves a deployment out of the table", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);

            const deployment = await manager.sendTransaction({
                data: STOP_RUNTIME_INIT_CODE
            });
            const receipt = await deployment.wait();

            expect(
                await provider.getCode(receipt!.contractAddress!),
                "the deployment mined and created its contract"
            ).to.equal("0x00");
            expect(
                await manager.gasUsage.settledSnapshot(),
                "a deployment has no callee to key a row on"
            ).to.deep.equal([]);
        });
    });

    it("a send after cut takes no nonce and never settles", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);
            let isSettled = false;

            manager.cut();
            void manager
                .sendTransaction({ to: recipient.address, value: 1n })
                .finally(() => {
                    isSettled = true;
                });
            // a later transaction of another signer mines meanwhile
            await (
                await funder.sendTransaction({
                    to: recipient.address,
                    value: 1n
                })
            ).wait();

            expect(isSettled).to.equal(false);
            expect(
                await provider.getTransactionCount(sender.address, "pending")
            ).to.equal(0);
        });
    });

    it("a send holding the nonce mutex before its broadcast at cut, and one queued behind it, take no nonce and never settle", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);
            // the first send holds the nonce mutex at its signature
            const sign = sender.signTransaction.bind(sender);
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let entered!: () => void;
            const held = new Promise<void>((resolve) => {
                entered = resolve;
            });
            let signed!: () => void;
            const isSigned = new Promise<void>((resolve) => {
                signed = resolve;
            });
            sender.signTransaction = async (tx) => {
                entered();
                await gate;
                const encodedTransaction = await sign(tx);
                signed();
                return encodedTransaction;
            };
            let isHeldSettled = false;
            let isQueuedSettled = false;

            void manager
                .sendTransaction({ to: recipient.address, value: 1n })
                .finally(() => {
                    isHeldSettled = true;
                });
            await held;
            void manager
                .sendTransaction({ to: recipient.address, value: 2n })
                .finally(() => {
                    isQueuedSettled = true;
                });
            manager.cut();
            release();
            await isSigned;
            // a later transaction of another signer mines meanwhile
            await (
                await funder.sendTransaction({
                    to: recipient.address,
                    value: 1n
                })
            ).wait();

            expect(isHeldSettled).to.equal(false);
            expect(isQueuedSettled).to.equal(false);
            expect(
                await provider.getTransactionCount(sender.address, "pending")
            ).to.equal(0);
        });
    });

    it("a broadcast already sent at cut settles and keeps its nonce", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);
            // the broadcast reaches the node, then its answer is held
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let sent!: () => void;
            const isSent = new Promise<void>((resolve) => {
                sent = resolve;
            });
            const broadcast = provider.broadcastTransaction.bind(provider);
            const held = sinon
                .stub(provider, "broadcastTransaction")
                .callsFake(async (encodedTransaction) => {
                    const response = await broadcast(encodedTransaction);
                    sent();
                    await gate;
                    return response;
                });

            try {
                const first = manager.sendTransaction({
                    to: recipient.address,
                    value: 1n
                });
                await isSent;
                manager.cut();
                release();
                const response = await first;
                await response.wait();

                expect(response.nonce).to.equal(0);
                expect(
                    await provider.getTransactionCount(
                        sender.address,
                        "pending"
                    )
                ).to.equal(1);
            } finally {
                held.restore();
            }
        });
    });

    it("broadcasts nothing while the disk has not confirmed the writes made before the send, and broadcasts once it has", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const {
                recipient,
                database,
                storage,
                manager,
                pendingNonce,
                write
            } = await gatedSender(provider);
            database.hold();
            write();
            let sent = false;
            const sending = manager
                .sendTransaction({ to: recipient.address, value: 1n })
                .then((response) => {
                    sent = true;
                    return response;
                });
            await waitFor(() => database.batches.length === 1);

            expect(sent).to.equal(false);
            expect(await pendingNonce()).to.equal(0);
            database.release();
            await (await sending).wait();
            expect(database.batches[0].committed).to.equal(true);
            expect(await pendingNonce()).to.equal(1);
            await storage.close();
        });
    });

    it("gives two sends waiting on one batch their nonces in call order", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const { recipient, database, storage, manager, write } =
                await gatedSender(provider);
            database.hold();
            write();
            const first = manager.sendTransaction({
                to: recipient.address,
                value: 1n
            });
            const second = manager.sendTransaction({
                to: recipient.address,
                value: 2n
            });
            await waitFor(() => database.batches.length === 1);

            database.release();
            const responses = await Promise.all([first, second]);

            expect(responses.map(({ nonce }) => nonce)).to.deep.equal([0, 1]);
            expect(responses.map(({ value }) => value)).to.deep.equal([1n, 2n]);
            await Promise.all(responses.map((response) => response.wait()));
            await storage.close();
        });
    });

    it("a send waiting for the disk at cut takes no nonce and never settles", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const {
                recipient,
                database,
                storage,
                manager,
                pendingNonce,
                write
            } = await gatedSender(provider);
            database.hold();
            write();
            let isSettled = false;
            void manager
                .sendTransaction({ to: recipient.address, value: 1n })
                .finally(() => {
                    isSettled = true;
                });
            await waitFor(() => database.batches.length === 1);

            manager.cut();
            database.release();
            await storage.close();
            // a later transaction of another signer mines meanwhile
            const funder = await testAccount(provider, 0);
            await (
                await funder.sendTransaction({
                    to: recipient.address,
                    value: 1n
                })
            ).wait();

            expect(isSettled).to.equal(false);
            expect(await pendingNonce()).to.equal(0);
        });
    });

    it("a send whose disk write fails takes no nonce and never settles", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const { recipient, database, manager, pendingNonce, write } =
                await gatedSender(provider);
            // the first attempt and both retries fail
            database.failNext(3);
            write();
            let isSettled = false;
            void manager
                .sendTransaction({ to: recipient.address, value: 1n })
                .finally(() => {
                    isSettled = true;
                });
            await waitFor(() => database.batches.length === 3);
            const funder = await testAccount(provider, 0);
            await (
                await funder.sendTransaction({
                    to: recipient.address,
                    value: 1n
                })
            ).wait();

            expect(isSettled).to.equal(false);
            expect(await pendingNonce()).to.equal(0);
        });
    });

    it("sends at once when the storage has no disk bound", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const storage = new Storage();
            storage.forceExit.setForceExit(true);
            const manager = new HostNonceManager(sender, undefined, () =>
                storage.flush()
            );

            const response = await manager.sendTransaction({
                to: recipient.address,
                value: 1n
            });

            expect(response.nonce).to.equal(0);
            await response.wait();
        });
    });

    it("cannot create another nonce owner by reconnecting", async () => {
        // no request is sent: the provider is only the object reconnected to
        const provider = new ethers.JsonRpcProvider(UNUSED_NODE_URL, 1, {
            staticNetwork: true
        });
        const sender = ethers.Wallet.createRandom().connect(provider);
        const manager = new HostNonceManager(sender);

        expect(manager.connect(sender.provider)).to.equal(manager);
        expect(() => manager.connect(null)).to.throw(
            "cannot reconnect host nonce manager"
        );
        provider.destroy();
    });

    it("recovers an indeterminate nonce lazily on the next send", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const funder = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const sender = ethers.Wallet.createRandom().connect(provider);
            await (
                await funder.sendTransaction({
                    to: sender.address,
                    value: ethers.parseEther("1")
                })
            ).wait();
            const manager = new HostNonceManager(sender);
            const originalGetNonce = sender.getNonce.bind(sender);
            let nonceQueries = 0;
            const getNonce = sinon
                .stub(sender, "getNonce")
                .callsFake(async (blockTag) => {
                    nonceQueries += 1;
                    if (nonceQueries === 2 || nonceQueries === 3) {
                        throw new Error("transient nonce query failure");
                    }
                    return originalGetNonce(blockTag);
                });

            try {
                await assert.rejects(
                    manager.sendTransaction({
                        to: recipient.address,
                        value: ethers.parseEther("2")
                    }),
                    /account nonce state could not be reconciled/
                );
                expect(nonceQueries).to.equal(2);

                await assert.rejects(
                    manager.sendTransaction({
                        to: recipient.address,
                        value: 1n
                    }),
                    /transient nonce query failure/
                );
                expect(nonceQueries).to.equal(3);

                const response = await manager.sendTransaction({
                    to: recipient.address,
                    value: 1n
                });
                const receipt = await response.wait();

                expect(nonceQueries).to.equal(4);
                expect(response.nonce).to.equal(
                    await provider.getTransactionCount(
                        sender.address,
                        receipt!.blockNumber - 1
                    )
                );
            } finally {
                getNonce.restore();
            }
        });
    });
});
