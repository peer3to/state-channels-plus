// @distributed-requires: lightClient
import { PEER3_CHAIN_CONSTANTS } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierChainConstants";
import FrontierPushedPartition from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierPushedPartition";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import {
    LightClientNodeFixture,
    PARTITION_CONTRACT
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex } from "ethers";

/** The topics the partition contract logs, as a state channel manager logs channel ids. */
const CHANNEL_A = toBeHex(0xa1, 32);
const CHANNEL_B = toBeHex(0xa2, 32);

describe("Light client pushed partitions", function () {
    let node: LightClientNodeFixture | undefined;

    afterEach(async function () {
        await node?.stop();
        node = undefined;
    });

    it("syncs a partition before its topic is logged and then pushes what the topic's transaction read and wrote, proven", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deploy(PARTITION_CONTRACT);
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [CHANNEL_A] });
        await waitFor(() => connection.pushed.length > 0);
        const [sync] = connection.pushed;
        expect(sync.block.sync).to.equal(true);
        expect(sync.block.values).to.deep.equal([]);

        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await waitFor(() =>
            connection.pushed.some(
                ({ block }) =>
                    Number(block.header.number) === receipt.blockNumber
            )
        );
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        for (const { block } of connection.pushed) partition.accept(block);
        const written = connection.pushed.find(
            ({ block }) => Number(block.header.number) === receipt.blockNumber
        )!.block;
        const keys = written.values.map(({ key }) => key);
        expect(keys).to.include.members([
            contractStorageKey(contract, toBeHex(5, 32)),
            contractStorageKey(contract, toBeHex(10, 32))
        ]);
        expect(written.sync).to.equal(false);
        expect(written.proofNodes).to.not.deep.equal([]);
        const at = partition.block!.number;
        const [{ proven }] = partition.decide([
            {
                address: contract,
                slots: [toBeHex(5, 32), toBeHex(10, 32)],
                account: false,
                code: true
            }
        ]).decided;
        expect(proven.storage).to.deep.equal([
            await node.provider.getStorage(contract, 5, at),
            await node.provider.getStorage(contract, 10, at)
        ]);
        expect(proven.code).to.equal(await node.provider.getCode(contract, at));
    });

    it("pushes a held key another topic's transaction wrote", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deploy(PARTITION_CONTRACT);
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [CHANNEL_A] });
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);

        // channel B's transaction writes slot 5, which channel A's read
        const receipt = await node.readWriteLog(contract, CHANNEL_B, 11, 5, 9);
        await waitFor(() =>
            connection.pushed.some(
                ({ block }) =>
                    Number(block.header.number) === receipt.blockNumber
            )
        );
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        for (const { block } of connection.pushed) partition.accept(block);
        const pushed = connection.pushed.find(
            ({ block }) => Number(block.header.number) === receipt.blockNumber
        )!.block;

        expect(pushed.values).to.deep.include({
            key: contractStorageKey(contract, toBeHex(5, 32)),
            value: toBeHex(9, 32)
        });
        // slot 11 is channel B's read, not channel A's
        expect(pushed.values.map(({ key }) => key)).to.not.include(
            contractStorageKey(contract, toBeHex(11, 32))
        );
    });

    it("pushes every best block in order, a block that changed nothing of the partition with no values", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deploy(PARTITION_CONTRACT);
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [CHANNEL_A] });
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await waitFor(() =>
            connection.pushed.some(
                ({ block }) =>
                    Number(block.header.number) >= receipt.blockNumber + 2
            )
        );

        const numbers = connection.pushed.map(({ block }) =>
            Number(block.header.number)
        );
        expect(numbers).to.deep.equal(
            numbers.map((_, index) => numbers[0] + index)
        );
        const later = connection.pushed.find(
            ({ block }) =>
                Number(block.header.number) === receipt.blockNumber + 1
        )!.block;
        expect(later.values).to.deep.equal([]);
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        for (const { block } of connection.pushed) partition.accept(block);
        expect(partition.block!.number).to.equal(numbers[numbers.length - 1]);
    });

    it("syncs a later subscriber to the partition an earlier one holds", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deploy(PARTITION_CONTRACT);
        const early = await node.connect();
        await early.subscribe({ address: contract, topics: [CHANNEL_A] });
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await waitFor(() =>
            early.pushed.some(
                ({ block }) =>
                    Number(block.header.number) === receipt.blockNumber
            )
        );

        const late = await node.connect();
        await late.subscribe({ address: contract, topics: [CHANNEL_A] });
        await waitFor(() => late.pushed.length > 0);
        const [{ block: sync }] = late.pushed;
        expect(sync.sync).to.equal(true);
        const syncedKeys = sync.values.map(({ key }) => key).sort();
        const heldKeys = [
            ...new Set(
                early.pushed.flatMap(({ block }) =>
                    block.values.map(({ key }) => key)
                )
            )
        ].sort();
        expect(syncedKeys).to.deep.equal(heldKeys);
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(sync);
        expect(partition.block?.number).to.be.at.least(receipt.blockNumber);
    });

    it("pushes a subscription the partitions of all of its topics", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deploy(PARTITION_CONTRACT);
        const connection = await node.connect();
        await connection.subscribe({
            address: contract,
            topics: [CHANNEL_A, CHANNEL_B]
        });
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        const receipt = await node.readWriteLog(contract, CHANNEL_B, 11, 12, 1);
        await waitFor(() =>
            connection.pushed.some(
                ({ block }) =>
                    Number(block.header.number) === receipt.blockNumber
            )
        );

        const keys = connection.pushed.flatMap(({ block }) =>
            block.values.map(({ key }) => key)
        );
        for (const slot of [5, 10, 11, 12])
            expect(keys).to.include(
                contractStorageKey(contract, toBeHex(slot, 32))
            );
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        for (const { block } of connection.pushed) partition.accept(block);
    });

    it("stops pushing to a subscription once it is unsubscribed", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deploy(PARTITION_CONTRACT);
        const connection = await node.connect();
        const kept = await connection.subscribe({
            address: contract,
            topics: [CHANNEL_A]
        });
        const removed = await connection.subscribe({
            address: contract,
            topics: [CHANNEL_B]
        });
        await waitFor(() =>
            [kept, removed].every((id) =>
                connection.pushed.some(
                    ({ subscription }) => subscription === id
                )
            )
        );

        expect(await connection.unsubscribe(removed)).to.equal(true);
        const removedCount = connection.pushed.filter(
            ({ subscription }) => subscription === removed
        ).length;
        const receipt = await node.readWriteLog(contract, CHANNEL_B, 5, 6, 1);
        await waitFor(() =>
            connection.pushed.some(
                ({ subscription, block }) =>
                    subscription === kept &&
                    Number(block.header.number) === receipt.blockNumber
            )
        );

        expect(
            connection.pushed.filter(
                ({ subscription }) => subscription === removed
            ).length
        ).to.equal(removedCount);
        expect(await connection.unsubscribe(removed)).to.equal(false);
    });
});
