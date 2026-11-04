import { Mirror } from "@/evm/p2pRuntime/rpcNodes/mirror/Mirror";
import { createLogger } from "@/utils/logging";
import {
    deployCommitProbe,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import { deployRuntimeCode } from "@test/fixtures/node/StorageDiffContracts";
import { rejectionOf } from "@test/fixtures/node/StorageDiffSession";
import { expect } from "chai";
import { isError, toQuantity } from "ethers";

describe("MirrorRpcProvider routing", function () {
    it("answers an eth_call at latest without sending an eth_call to the node", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();

            expect(await storage.getValue()).to.equal(5n);

            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("answers a call that carries a gas limit from the node, which charges the transaction gas the local EVM does not", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await storage.getValue();
            const call = (gasLimit?: bigint) =>
                session.provider.call({
                    to: address,
                    data: storage.interface.encodeFunctionData("getValue"),
                    ...(gasLimit === undefined ? {} : { gasLimit })
                });
            const nodeCalls = () => nodeRequests(session, "eth_call").length;
            const before = nodeCalls();

            // below the 21,000 of intrinsic gas: the node refuses, a local run would not
            const refused = await rejectionOf(call(21_000n));

            expect(refused).to.be.instanceOf(Error);
            expect(nodeCalls() - before).to.equal(1);
            expect(BigInt(await call())).to.equal(5n);
            // a call without a limit stays local
            expect(nodeCalls() - before).to.equal(1);
        });
    });

    // Mutation: the fee fields are honoured locally -> the node is not asked.
    it("answers a call that sets EIP-1559 fee fields from the node, which prices it against its base fee", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await storage.getValue();
            const before = nodeRequests(session, "eth_call").length;

            const answer = await session.provider.send("eth_call", [
                {
                    // a sender that can pay the fee the node charges against
                    from: await session.signer.getAddress(),
                    to: address,
                    data: storage.interface.encodeFunctionData("getValue"),
                    maxFeePerGas: toQuantity(2_000_000_000n),
                    maxPriorityFeePerGas: toQuantity(1n)
                },
                "latest"
            ]);

            expect(BigInt(answer)).to.equal(5n);
            expect(nodeRequests(session, "eth_call").length - before).to.equal(
                1
            );
        });
    });

    // Mutation: a failure that is no revert is answered locally -> the node is not asked.
    it("answers a call that fails without reverting from the node, which keeps the chain's gas accounting", async function () {
        await withMirrorSession(async (session) => {
            // INVALID: the call fails without reverting
            const invalid = await deployRuntimeCode(session.signer, "fe");
            const before = nodeRequests(session, "eth_call").length;

            const failure = await rejectionOf(
                session.provider.send("eth_call", [
                    { to: invalid, data: "0x" },
                    "latest"
                ])
            );

            expect(failure).to.be.instanceOf(Error);
            expect(nodeRequests(session, "eth_call").length - before).to.equal(
                1
            );
        });
    });

    // Mutation: a failed start of the local EVM is kept -> every later call
    // fails with the first start's error.
    it("starts the local EVM again for a call after a start that failed", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            const logger = createLogger(
                {},
                {},
                { level: "error", attachErrorListener: false }
            );
            let chainIdReads = 0;
            const mirror = new Mirror({
                serviceUrl: session.service.url,
                requestNode: (method, params) =>
                    session.chain.send(method, params),
                logger,
                customPrecompiles: [],
                getChainId: async () => {
                    // the first start finds the chain id unreadable
                    if (++chainIdReads === 1)
                        throw new Error("The chain id is not readable yet");
                    return (await session.chain.getNetwork()).chainId;
                }
            });
            const call = () =>
                mirror.call({
                    to: address.toLowerCase(),
                    data: storage.interface.encodeFunctionData("getValue")
                });
            try {
                const first = await rejectionOf(call());
                const second = await call();

                expect((first as Error).message).to.equal(
                    "The chain id is not readable yet"
                );
                expect(second.kind).to.equal("return");
                expect(BigInt((second as { data: string }).data)).to.equal(5n);
            } finally {
                await mirror.close();
                logger.dispose();
            }
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
        });
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

    // Mutation: the local EVM has no block hashes -> BLOCKHASH reads 0.
    it("answers BLOCKHASH of a block the copy applied as the node does, without asking the node", async function () {
        await withMirrorSession(async (session) => {
            // returns BLOCKHASH(NUMBER - 1)
            const probe = await deployRuntimeCode(
                session.signer,
                "600143034060005260206000f3"
            );
            const { storage } = await deployMirroredStorage(session);
            await storage.getValue();
            // two blocks the copy applies after it started following
            await (await storage.setValue(1n)).wait();
            await (await storage.setValue(2n)).wait();
            expect(await storage.getValue()).to.equal(2n);
            const head = await headNumber(session);
            const before = nodeRequests(session, "eth_call").length;

            const hash = await session.provider.send("eth_call", [
                { to: probe.toLowerCase(), data: "0x" },
                "latest"
            ]);

            expect(hash).to.equal(
                (await session.chain.getBlock(head - 1))!.hash
            );
            expect(nodeRequests(session, "eth_call").length - before).to.equal(
                0
            );
        });
    });

    // Mutation: an unknown block hash reads 0 locally -> the node is not asked.
    it("sends a call whose BLOCKHASH names a block older than the copy keeps to the node", async function () {
        await withMirrorSession(async (session) => {
            const probe = await deployRuntimeCode(
                session.signer,
                "600143034060005260206000f3"
            );
            const head = await headNumber(session);

            // the copy starts following at the head: the block before it is not kept
            const hash = await session.provider.send("eth_call", [
                { to: probe.toLowerCase(), data: "0x" },
                "latest"
            ]);

            expect(hash).to.equal(
                (await session.chain.getBlock(head - 1))!.hash
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
        });
    });
});
