import { DepthIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/DepthIncludedHeadStrategy";
import {
    deployCommitProbe,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import { rejectionOf } from "@test/fixtures/node/StorageDiffSession";
import { waitFor } from "@test/utils/waitFor";
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
});
