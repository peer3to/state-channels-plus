import { sleep } from "@/utils";
import { DepthIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/DepthIncludedHeadStrategy";
import {
    deployCommitProbe,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import { rejectionOf } from "@test/fixtures/node/StorageDiffService.fixture";
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
            const fetched = nodeRequests(session, "eth_getStorageAt").length;

            await (await storage.setValue(7n)).wait();

            expect(await storage.getValue()).to.equal(7n);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(
                fetched
            );
        });
    });

    it("sends one eth_getStorageAt at the head block number for the first read of an uncached slot", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            const head = await headNumber(session);

            const word = await session.provider.getStorage(address, 0);

            expect(BigInt(word)).to.equal(5n);
            expect(
                nodeRequests(session, "eth_getStorageAt").map(
                    (request) => request.params
                )
            ).to.deep.equal([
                [address.toLowerCase(), ZeroHash, toQuantity(head)]
            ]);
        });
    });

    it("sends no eth_getStorageAt for a second read of the same slot", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await session.provider.getStorage(address, 0);

            await session.provider.getStorage(address, 0);

            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
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
            expect(await storage.getValue()).to.equal(0n);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    it("reads the replacement branch's value after a reorg", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await (await storage.setValue(9n)).wait();

            expect(await storage.getValue()).to.equal(9n);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    it("restores a slot the orphaned block wrote when the replacement block does not write it", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await session.chain.send("evm_mine", []);

            await waitFor(async () => (await storage.getValue()) === 5n);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
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

    it("empties the cache when the service no longer retains the missing blocks", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, chainStorage } =
                    await deployMirroredStorage(session);
                await (await chainStorage.setValue(5n)).wait();
                expect(await storage.getValue()).to.equal(5n);
                expect(
                    nodeRequests(session, "eth_getStorageAt")
                ).to.have.length(1);

                session.service.dropNotifications("scp_subscription");
                await session.chain.send("evm_mine", []);
                await session.chain.send("evm_mine", []);
                session.service.stopDroppingNotifications("scp_subscription");
                await (await storage.setValue(7n)).wait();

                expect(await storage.getValue()).to.equal(7n);
                expect(
                    nodeRequests(session, "eth_getStorageAt")
                ).to.have.length(2);
            },
            { retention: 1 }
        );
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
            ).to.deep.equal(["pending", toQuantity(await headNumber(session))]);
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
});
