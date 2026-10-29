import { MiscountingBlockSource } from "../fixtures/node/MiscountingBlockSource";
import { SNAPSHOT_WAIT_MS } from "@/evm/p2pRuntime/rpcNodes/mirror/MirrorChain";
import { sleep } from "@/utils";
import { DepthIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/DepthIncludedHeadStrategy";
import { NOT_RETAINED_ERROR_CODE } from "@/utils/storageDiff/storageDiffWire";
import {
    deployCommitProbe,
    deployEnvironmentProbe,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    nodeStateReads,
    serviceRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import {
    deployLogEmitter,
    emitValue,
    rejectionOf
} from "@test/fixtures/node/StorageDiffService.fixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { AbiCoder, isError, toQuantity, ZeroHash } from "ethers";
import path from "node:path";

/** Time is the input: how long a read that must wait is watched for. */
const ABSENCE_WINDOW_MS = 500;
const CUSTOM_PRECOMPILE_ADDRESS = "0x00000000000000000000000000000000000000f0";
const CUSTOM_PRECOMPILE_CALLDATA = "0x1234";

describe("MirrorRpcProvider", function () {
    it("answers an eth_call at latest without sending an eth_call to the node", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();

            expect(await storage.getValue()).to.equal(5n);

            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("reads a slot written on chain after the block's record arrives without an eth_getStorageAt", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceRequests(session, "scp_getState").length;

            await (await storage.setValue(7n)).wait();

            expect(await storage.getValue()).to.equal(7n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                fetched
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("reads the first read of a slot from the snapshot the service pushed, with no scp_getState and no node read", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();

            const word = await session.provider.getStorage(address, 0);

            expect(BigInt(word)).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(0);
            expect(nodeStateReads(session)).to.equal(0);
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 0,
                snapshots: 1
            });
        });
    });

    it("applies a snapshot that reaches the mirror before the reply of the subscription that asked for it", async function () {
        await withMirrorSession(async (session) => {
            // the mirror follows the first contract before the second is deployed
            const first = await deployMirroredStorage(session);
            await first.storage.getValue();
            const second = await deployMirroredStorage(session);
            await (await second.storage.setValue(5n)).wait();
            const held = session.service.holdReplies(
                "scp_subscribeContractStorage"
            );

            const read = session.provider.getStorage(second.address, 0);
            // the snapshot is pushed while the subscribe reply is held back
            while (held.heldReplies() === 0) await sleep(20);
            await sleep(500);
            held.release();

            expect(BigInt(await read)).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(0);
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 0
            });
        });
    });

    it("reads an account the service keeps lazy at once, without waiting for a snapshot", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                await (await storage.setValue(5n)).wait();

                const started = Date.now();
                const word = await session.provider.getStorage(address, 0);
                const elapsed = Date.now() - started;

                expect(BigInt(word)).to.equal(5n);
                // far below the wait for a snapshot that is not coming
                expect(elapsed).to.be.lessThan(SNAPSHOT_WAIT_MS / 2);
                expect(session.provider.mirrorStatistics).to.include({
                    lazyNotices: 1,
                    snapshotTimeouts: 0,
                    snapshots: 0,
                    lazyReads: 1
                });
            },
            { backfillBlocks: new MiscountingBlockSource() }
        );
    });

    it("asks the service for exactly the missing fields, at the head block, when no snapshot comes", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            session.service.dropNotifications("scp_snapshot");
            const head = await session.chain.getBlock(
                await headNumber(session)
            );

            const word = await session.provider.getStorage(address, 0);

            expect(BigInt(word)).to.equal(5n);
            expect(
                serviceRequests(session, "scp_getState").map(
                    (request) => request.params
                )
            ).to.deep.equal([
                [
                    head!.hash,
                    [
                        {
                            address: address.toLowerCase(),
                            slots: [ZeroHash],
                            account: false,
                            code: false
                        }
                    ]
                ]
            ]);
            expect(nodeStateReads(session)).to.equal(0);
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 1,
                lazyFields: 1,
                snapshotTimeouts: 1
            });
        });
    });

    it("sends no scp_getState and no node read for a second read of the same slot", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await session.provider.getStorage(address, 0);

            await session.provider.getStorage(address, 0);

            expect(serviceRequests(session, "scp_getState")).to.have.length(0);
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("reads a slot cleared on chain as zero without an eth_getStorageAt", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(
                BigInt(await session.provider.getStorage(address, 0))
            ).to.equal(5n);

            await (await storage.setValue(0n)).wait();

            expect(await session.provider.getStorage(address, 0)).to.equal(
                ZeroHash
            );
            expect(serviceRequests(session, "scp_getState")).to.have.length(0);
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("reads the replacement branch's value after a reorg", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceRequests(session, "scp_getState").length;
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await (await storage.setValue(9n)).wait();

            expect(await storage.getValue()).to.equal(9n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                fetched
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("restores a slot the orphaned block wrote when the replacement block does not write it", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceRequests(session, "scp_getState").length;
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await session.chain.send("evm_mine", []);

            await waitFor(async () => (await storage.getValue()) === 5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                fetched
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("asks the service for the blocks from the next missing one when a record's parent is not the head", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const head = await headNumber(session);
            const sent = session.service.forwardedRequests.length;

            session.service.dropNotifications("scp_subscription");
            await (await chainStorage.setValue(6n)).wait();
            session.service.stopDroppingNotifications("scp_subscription");
            await (await chainStorage.setValue(7n)).wait();

            await waitFor(async () => (await storage.getValue()) === 7n);
            expect(
                session.service.forwardedRequests
                    .slice(sent)
                    .filter(
                        (request) =>
                            request.method === "scp_getContractStorageDiffs"
                    )
                    .map((request) => (request.params as unknown[])[1])
            ).to.deep.equal([toQuantity(head + 1)]);
        });
    });

    it("empties the cache when the service no longer retains the missing blocks, and the next read goes to the service again", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, chainStorage } =
                    await deployMirroredStorage(session);
                await (await chainStorage.setValue(5n)).wait();
                expect(await storage.getValue()).to.equal(5n);
                const fetched = serviceRequests(session, "scp_getState").length;

                session.service.dropNotifications("scp_subscription");
                await session.chain.send("evm_mine", []);
                await session.chain.send("evm_mine", []);
                session.service.stopDroppingNotifications("scp_subscription");
                await (await storage.setValue(7n)).wait();

                expect(await storage.getValue()).to.equal(7n);
                expect(
                    serviceRequests(session, "scp_getState").length
                ).to.be.greaterThan(fetched);
                expect(nodeStateReads(session)).to.equal(0);
            },
            { retention: 1 }
        );
    });

    it("reads from the node at the head block number only while the service answers that the block is not retained", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            session.service.dropNotifications("scp_snapshot");
            session.service.errorRequests(
                "scp_getState",
                NOT_RETAINED_ERROR_CODE,
                "Block is not retained"
            );
            const head = await headNumber(session);

            expect(await storage.getValue()).to.equal(5n);

            expect(
                nodeRequests(session, "eth_getStorageAt").map(
                    (request) => (request.params as unknown[])[2]
                )
            ).to.deep.equal([toQuantity(head)]);
            expect(
                nodeRequests(session, "eth_getCode").length
            ).to.be.greaterThan(0);
            session.service.stopErroringRequests("scp_getState");
            const fallbackReads = nodeStateReads(session);

            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);
            expect(nodeStateReads(session)).to.equal(fallbackReads);
        });
    });

    it("takes the block environment from the service without reading blocks from the node", async function () {
        await withMirrorSession(async (session) => {
            const probe = await deployEnvironmentProbe(session.signer);

            const answer = await session.provider.call({ to: probe });

            expect(answer).to.equal(await session.chain.call({ to: probe }));
            expect(BigInt(answer.slice(0, 66))).to.be.greaterThan(0n);
            expect(nodeRequests(session, "eth_getBlockByHash")).to.have.length(
                0
            );
            expect(
                nodeRequests(session, "eth_getBlockByNumber")
            ).to.have.length(0);
        });
    });

    it("runs a custom precompile locally without an upstream request", async function () {
        await withMirrorSession(
            async (session) => {
                const call = async () =>
                    AbiCoder.defaultAbiCoder().decode(
                        ["uint256", "bool"],
                        await session.provider.call({
                            to: CUSTOM_PRECOMPILE_ADDRESS,
                            data: CUSTOM_PRECOMPILE_CALLDATA
                        })
                    );
                const [first] = await call();
                expect(first).to.equal(7n);
                expect(nodeRequests(session, "eth_call")).to.have.length(0);
                const sent = session.node.forwardedMethods.length;

                const [second] = await call();

                expect(second).to.equal(7n);
                expect(session.node.forwardedMethods.slice(sent)).to.deep.equal(
                    []
                );
            },
            {
                customPrecompiles: [
                    {
                        address: CUSTOM_PRECOMPILE_ADDRESS,
                        module: path.join(
                            __dirname,
                            "../fixtures/workerAnswerPrecompile.ts"
                        ),
                        options: {
                            expectedData: CUSTOM_PRECOMPILE_CALLDATA,
                            value: "7"
                        }
                    }
                ]
            }
        );
    });

    it("holds a call issued after the peer's own transaction is mined until the mirror has that block", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            const release =
                session.service.holdNotifications("scp_subscription");

            const sent = await storage.setValue(42n);
            await sent.wait();
            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the block's record").to.equal(
                false
            );
            release();

            expect(await read).to.equal(42n);
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("holds a call until the mirror reaches a block the node announced", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            // the runtime listens to blocks; the provider relays what it hears
            await session.provider.on("block", () => undefined);
            const release =
                session.service.holdNotifications("scp_subscription");

            await (await chainStorage.setValue(3n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the announced block").to.equal(
                false
            );
            release();

            expect(await read).to.equal(3n);
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("returns what the node returns at the same head for a call, a revert and a read of account state", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(11n)).wait();
            const getState = await storage.getState.populateTransaction();

            expect(await session.provider.call(getState)).to.equal(
                await session.chain.call(getState)
            );
            expect(await session.provider.getCode(address)).to.equal(
                await session.chain.getCode(address)
            );
            expect(
                await session.provider.getBalance(session.wallet.address)
            ).to.equal(await session.chain.getBalance(session.wallet.address));
            const mirrored = await rejectionOf(
                storage.revertWithMessage.staticCall("boom")
            );
            const direct = await rejectionOf(
                chainStorage.revertWithMessage.staticCall("boom")
            );
            expect(isError(mirrored, "CALL_EXCEPTION")).to.equal(true);
            expect((mirrored as { reason?: string }).reason).to.equal(
                (direct as { reason?: string }).reason
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("discards what a call wrote when it ends", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();

            expect(await storage.increment.staticCall()).to.equal(6n);
            expect(await storage.increment.staticCall()).to.equal(6n);

            expect(await storage.getValue()).to.equal(5n);
        });
    });

    it("keeps a returned sub-call's write out of the frame that reverted it", async function () {
        await withMirrorSession(async (session) => {
            const probe = await deployCommitProbe(session.signer);

            const answer = await session.provider.call({ to: probe });

            expect(BigInt(answer)).to.equal(0n);
            expect(BigInt(await session.chain.call({ to: probe }))).to.equal(
                0n
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("sends estimateGas and reads at an older block to the node", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            const older = (await headNumber(session)) - 1;
            const getValue = await storage.getValue.populateTransaction();
            const before = (method: string) =>
                nodeRequests(session, method).length;
            const estimates = before("eth_estimateGas");
            const calls = before("eth_call");
            const balances = before("eth_getBalance");

            await session.provider.estimateGas(getValue);
            await session.provider.call({ ...getValue, blockTag: older });
            await session.provider.getBalance(address, older);

            expect(before("eth_estimateGas")).to.equal(estimates + 1);
            expect(before("eth_call")).to.equal(calls + 1);
            expect(before("eth_getBalance")).to.equal(balances + 1);
        });
    });

    it("sends every read to the node without a storage diff service", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage } = await deployMirroredStorage(session);

                expect(await storage.getValue()).to.equal(0n);

                expect(nodeRequests(session, "eth_call")).to.have.length(1);
            },
            { withoutService: true }
        );
    });

    it("sends a pending nonce read to the node and answers the latest one itself", async function () {
        await withMirrorSession(async (session) => {
            const address = session.wallet.address;

            const pending = await session.provider.getTransactionCount(
                address,
                "pending"
            );
            const latest = await session.provider.getTransactionCount(address);
            await session.provider.getTransactionCount(address);

            expect(latest).to.equal(pending);
            expect(
                nodeRequests(session, "eth_getTransactionCount").map(
                    (request) => (request.params as unknown[])[1]
                )
            ).to.deep.equal(["pending"]);
            expect(
                session.provider.mirrorStatistics?.snapshots
            ).to.be.greaterThan(0);
        });
    });

    it("records the included head from the catch-up and from a push", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage } = await deployMirroredStorage(session);
                await storage.getValue();
                const head = await headNumber(session);
                const included = await session.chain.getBlock(head - 1);
                expect(session.provider.includedHead).to.deep.equal({
                    number: toQuantity(head - 1),
                    hash: included!.hash
                });

                await session.chain.send("evm_mine", []);

                await waitFor(
                    () =>
                        session.provider.includedHead?.number ===
                        toQuantity(head)
                );
            },
            { includedHead: new DepthIncludedHeadStrategy(1) }
        );
    });

    it("answers the chain id from its first answer without asking a node again", async function () {
        await withMirrorSession(async (session) => {
            // the provider's own network detection has asked once
            await session.provider.getNetwork();
            await session.provider.send("eth_chainId", []);
            await session.provider.send("eth_chainId", []);
            const asked = nodeRequests(session, "eth_chainId").length;

            await session.provider.send("eth_chainId", []);
            await session.provider.send("eth_chainId", []);

            expect(nodeRequests(session, "eth_chainId")).to.have.length(asked);
        });
    });

    it("answers the block number, blocks, transactions and receipts as the node does, without asking a node", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            const sent = await storage.setValue(5n);
            const receipt = await sent.wait();
            const head = await headNumber(session);
            const number = toQuantity(head);
            const blockReads = () =>
                nodeRequests(session, "eth_blockNumber").length +
                nodeRequests(session, "eth_getBlockByNumber").length +
                nodeRequests(session, "eth_getBlockByHash").length +
                nodeRequests(session, "eth_getTransactionByHash").length +
                nodeRequests(session, "eth_getTransactionReceipt").length;
            const before = blockReads();

            const answers = [
                await session.provider.send("eth_blockNumber", []),
                await session.provider.send("eth_getBlockByNumber", [
                    "latest",
                    true
                ]),
                await session.provider.send("eth_getBlockByNumber", [
                    number,
                    false
                ]),
                await session.provider.send("eth_getBlockByHash", [
                    receipt!.blockHash,
                    true
                ]),
                await session.provider.send("eth_getTransactionByHash", [
                    sent.hash
                ]),
                await session.provider.send("eth_getTransactionReceipt", [
                    sent.hash
                ])
            ];

            expect(answers).to.deep.equal([
                await session.chain.send("eth_blockNumber", []),
                await session.chain.send("eth_getBlockByNumber", [
                    "latest",
                    true
                ]),
                await session.chain.send("eth_getBlockByNumber", [
                    number,
                    false
                ]),
                await session.chain.send("eth_getBlockByHash", [
                    receipt!.blockHash,
                    true
                ]),
                await session.chain.send("eth_getTransactionByHash", [
                    sent.hash
                ]),
                await session.chain.send("eth_getTransactionReceipt", [
                    sent.hash
                ])
            ]);
            expect(blockReads()).to.equal(before);
        });
    });

    it("asks the node for a transaction, receipt or block the service does not hold", async function () {
        await withMirrorSession(async (session) => {
            const unknown = "0x" + "ab".repeat(32);
            const asked = (method: string) =>
                nodeRequests(session, method).length;
            const receipts = asked("eth_getTransactionReceipt");
            const blocks = asked("eth_getBlockByHash");

            expect(
                await session.provider.send("eth_getTransactionReceipt", [
                    unknown
                ])
            ).to.equal(null);
            expect(
                await session.provider.send("eth_getBlockByHash", [
                    unknown,
                    false
                ])
            ).to.equal(null);

            expect(asked("eth_getTransactionReceipt")).to.equal(receipts + 1);
            expect(asked("eth_getBlockByHash")).to.equal(blocks + 1);
        });
    });

    it("asks the node for the latest block while the service is behind a block the node announced", async function () {
        await withMirrorSession(async (session) => {
            await session.rpcNode.watchSockets((socket) => {
                void socket.on("block", () => undefined);
            });
            await session.provider.send("eth_getBlockByNumber", [
                "latest",
                false
            ]);
            const held = session.relay.holdNext(
                "eth_getBlockByNumber",
                "latest"
            );

            await session.chain.send("evm_mine", []);
            await held.arrived;
            await sleep(ABSENCE_WINDOW_MS);
            const asked = nodeRequests(session, "eth_getBlockByNumber").length;
            const block = await session.provider.send("eth_getBlockByNumber", [
                "latest",
                false
            ]);

            expect(block.number).to.equal(
                toQuantity(await headNumber(session))
            );
            expect(
                nodeRequests(session, "eth_getBlockByNumber")
            ).to.have.length(asked + 1);
            held.release();
        });
    });

    it("holds a read until the mirror reaches the block of a log notification the node pushed first", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            await emitValue(session.signer, emitter, 1n);
            expect(
                BigInt(await session.provider.getStorage(emitter, 0))
            ).to.equal(1n);
            const logged = new Promise<void>((resolve) => {
                session.rpcNode.watchSockets((socket) => {
                    void socket.on({ address: emitter }, () => resolve());
                });
            });
            await sleep(ABSENCE_WINDOW_MS);
            const release =
                session.service.holdNotifications("scp_subscription");

            await emitValue(session.signer, emitter, 9n);
            await logged;
            let settled = false;
            const read = session.provider
                .getStorage(emitter, 0)
                .finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the log's block").to.equal(
                false
            );
            release();

            expect(BigInt(await read)).to.equal(9n);
        });
    });
});
