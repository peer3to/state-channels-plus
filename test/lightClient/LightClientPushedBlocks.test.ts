// @distributed-requires: lightClient
import proveFrontierStorageBlock from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/proveFrontierStorageBlock";
import { LightClientNodeFixture } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex, ZeroHash } from "ethers";

const SLOT_ONE = toBeHex(1, 32);
const SLOT_TWO = toBeHex(2, 32);

describe("Light client pushed blocks", function () {
    let node: LightClientNodeFixture | undefined;

    afterEach(async function () {
        await node?.stop();
        node = undefined;
    });

    it("proves the write of a block a live node pushed", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [SLOT_ONE] });

        const value = toBeHex(0xaaaa, 32);
        const receipt = await node.store(contract, SLOT_ONE, value);
        await waitFor(() => connection.pushedWithLogs.length === 1);

        const proven = proveFrontierStorageBlock(
            connection.pushedWithLogs[0].block,
            contract
        );
        expect(proven.writes).to.deep.equal([{ slot: SLOT_ONE, value }]);
        expect(proven.ethereumBlockHash).to.equal(receipt.blockHash);
        expect(proven.header.hash).to.equal(
            await connection.request("chain_getBlockHash", [
                proven.header.number
            ])
        );
        expect(
            await node.provider.getStorage(
                contract,
                SLOT_ONE,
                receipt.blockNumber
            )
        ).to.equal(value);
    });

    it("proves every write of a live block in which one of two transactions logged the subscribed topic", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [SLOT_ONE] });

        const first = toBeHex(0xcccc, 32);
        const second = toBeHex(0xdddd, 32);
        const [receipt] = await node.storeInOneBlock(contract, [
            { slot: SLOT_ONE, value: first },
            { slot: SLOT_TWO, value: second }
        ]);
        const pushedForBlock = () =>
            connection.pushedWithLogs.find(
                ({ block }) => block.logs[0].blockHash === receipt.blockHash
            );
        await waitFor(() => pushedForBlock() !== undefined);

        const { block } = pushedForBlock()!;
        expect(block.logs.map((log) => log.topics)).to.deep.equal([[SLOT_ONE]]);
        const proven = proveFrontierStorageBlock(block, contract);
        expect(proven.ethereumBlockHash).to.equal(receipt.blockHash);
        expect(proven.writes).to.have.deep.members([
            { slot: SLOT_ONE, value: first },
            { slot: SLOT_TWO, value: second }
        ]);
    });

    it("proves a live block without a log of the subscribed topic to hold no write and to follow the block before it", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [SLOT_ONE] });

        const receipt = await node.store(
            contract,
            SLOT_TWO,
            toBeHex(0xbbbb, 32)
        );
        const pushedForBlock = () =>
            connection.pushed.find(
                ({ block }) =>
                    Number(block.header.number) === receipt.blockNumber
            );
        await waitFor(() => pushedForBlock() !== undefined);

        const proven = proveFrontierStorageBlock(
            pushedForBlock()!.block,
            contract
        );
        expect(proven.writes).to.deep.equal([]);
        expect(proven.ethereumBlockHash).to.equal(receipt.blockHash);
        expect(proven.header.parentHash).to.equal(
            await connection.request("chain_getBlockHash", [
                receipt.blockNumber - 1
            ])
        );
    });

    it("proves a slot a live node pushed as cleared", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [SLOT_ONE] });

        await node.store(contract, SLOT_ONE, toBeHex(0xaaaa, 32));
        const receipt = await node.store(contract, SLOT_ONE, ZeroHash);
        await waitFor(() => connection.pushedWithLogs.length === 2);

        const { block } = connection.pushedWithLogs[1];
        expect(block.writes).to.deep.equal([{ slot: SLOT_ONE, value: null }]);
        const proven = proveFrontierStorageBlock(block, contract);
        expect(proven.ethereumBlockHash).to.equal(receipt.blockHash);
        expect(proven.writes).to.deep.equal([
            { slot: SLOT_ONE, value: ZeroHash }
        ]);
    });
});
