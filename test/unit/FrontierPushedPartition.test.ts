import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import { PEER3_CHAIN_CONSTANTS } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierChainConstants";
import FrontierPushedPartition from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierPushedPartition";
import SubstrateHeader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader";
import {
    peer3PartitionPushes,
    taken
} from "@test/fixtures/lightClient/peer3PartitionPushes";
import { expect } from "chai";
import { toBeHex } from "ethers";

const { contract, sender, messages, blocks } = peer3PartitionPushes;
/** The account that deployed the contract, which no transaction of the followed topic touched. */
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SLOTS = [5, 10, 20];

describe("FrontierPushedPartition", function () {
    it("holds the node's own slot values, account and code at every pushed block", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        for (const [index, message] of messages.entries()) {
            partition.accept(message);
            const oracle = blocks[index];
            expect(partition.block).to.deep.equal({
                number: oracle.number,
                hash: oracle.hash,
                ethereumBlockHash: oracle.ethereumBlockHash,
                stateRoot: message.header.stateRoot
            });
            const { decided } = partition.decide([
                {
                    address: contract,
                    slots: SLOTS.map((slot) => toBeHex(slot, 32)),
                    account: false,
                    code: true
                },
                { address: sender, slots: [], account: true, code: false }
            ]);
            for (const { read, proven } of decided) {
                read.slots.forEach((slot, slotIndex) =>
                    expect(proven.storage[slotIndex], `slot ${slot}`).to.equal(
                        oracle.storage[
                            String(Number(slot)) as keyof typeof oracle.storage
                        ]
                    )
                );
                if (read.code) expect(proven.code).to.equal(oracle.code);
                if (read.account)
                    expect(proven.account).to.deep.equal({
                        nonce: BigInt(oracle.senderNonce),
                        balance: BigInt(oracle.senderBalance)
                    });
            }
        }
    });

    it("holds what the followed topic's transactions touched, and the value another topic's transaction wrote to it", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        const readsOfStep = [
            {
                address: contract,
                slots: SLOTS.map((slot) => toBeHex(slot, 32)),
                account: false,
                code: true
            },
            { address: sender, slots: [], account: true, code: false }
        ];

        partition.accept(messages[0]);
        // the sync came before the topic was logged: the partition holds nothing
        expect(partition.decide(readsOfStep).decided).to.deep.equal([]);

        partition.accept(messages[1]);
        const afterFirst = partition.decide(readsOfStep);
        expect(afterFirst.decided[0].read.slots).to.deep.include.members([
            toBeHex(5, 32),
            toBeHex(10, 32)
        ]);
        expect(afterFirst.decided[0].proven.code).to.equal(blocks[1].code);
        expect(afterFirst.decided[1].proven.account?.nonce).to.equal(
            BigInt(blocks[1].senderNonce)
        );

        // another topic's transaction wrote slot 5, which this partition read
        partition.accept(messages[2]);
        const [{ read, proven }] = partition.decide([
            {
                address: contract,
                slots: [toBeHex(5, 32)],
                account: false,
                code: false
            }
        ]).decided;
        expect(read.slots).to.deep.equal([toBeHex(5, 32)]);
        expect(proven.storage).to.deep.equal([toBeHex(9, 32)]);
    });

    it("takes the block values a call reads from the Ethereum header the push carries", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        for (const [index, message] of messages.entries()) {
            partition.accept(message);
            const { ethereumBlock, number } = blocks[index];
            expect(partition.environment).to.deep.include({
                number: BigInt(number),
                timestamp: BigInt(ethereumBlock.timestamp),
                gasLimit: BigInt(ethereumBlock.gasLimit),
                coinbase: ethereumBlock.miner.toLowerCase(),
                baseFeePerGas: PEER3_CHAIN_CONSTANTS.baseFeePerGas
            });
        }
    });

    it("leaves to the node what the held proof does not reach", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        const deployerAccount = {
            address: DEPLOYER,
            slots: [],
            account: true,
            code: false
        };
        expect(partition.decide([deployerAccount])).to.deep.equal({
            decided: [],
            undecided: [deployerAccount]
        });
        for (const message of messages) partition.accept(message);
        expect(partition.decide([deployerAccount])).to.deep.equal({
            decided: [],
            undecided: [deployerAccount]
        });
    });

    it("refuses a change to a partition it never synced", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        expect(() => partition.accept(messages[1])).to.throw(
            StorageProofError,
            /never synced/
        );
        expect(partition.block).to.equal(undefined);
    });

    it("refuses a pushed value the proof decides otherwise, and holds nothing until the next sync", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        partition.accept(messages[1]);
        const altered = structuredClone(messages[2]);
        altered.values[0].value = toBeHex(8, 32);

        expect(() => partition.accept(altered)).to.throw(
            StorageProofError,
            /decides key/
        );
        expect(partition.block).to.equal(undefined);
        expect(partition.environment).to.equal(undefined);
        expect(() => partition.accept(messages[2])).to.throw(
            StorageProofError,
            /never synced/
        );
        partition.accept(messages[0]);
        expect(partition.block?.number).to.equal(blocks[0].number);
    });

    it("refuses a change whose new proof nodes do not reach the held keys", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        partition.accept(messages[1]);
        const withoutNodes = { ...messages[2], proofNodes: [] };

        expect(() => partition.accept(withoutNodes)).to.throw(
            StorageProofError
        );
        expect(partition.block).to.equal(undefined);
    });

    it("refuses an Ethereum header that is not the block the header's digest names", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        const swapped = {
            ...messages[1],
            ethereumHeader: messages[2].ethereumHeader
        };

        expect(() => partition.accept(swapped)).to.throw(
            StorageProofError,
            /not the header's block/
        );
        expect(partition.block).to.equal(undefined);
    });

    it("refuses a header whose digest names another Ethereum block, and holds nothing until the next sync", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        const { header } = messages[1];
        const namedHash = new SubstrateHeader(header).ethereumBlockHash();
        const otherHash =
            namedHash.slice(0, -2) + (namedHash.endsWith("00") ? "01" : "00");
        const tampered = structuredClone(messages[1]);
        tampered.header.digest.logs = header.digest.logs.map((log) =>
            log.replace(namedHash.slice(2), otherHash.slice(2))
        );
        expect(tampered.header.digest.logs).to.not.deep.equal(
            header.digest.logs
        );
        expect(
            new SubstrateHeader(tampered.header).ethereumBlockHash()
        ).to.equal(otherHash);

        expect(() => partition.accept(tampered)).to.throw(
            StorageProofError,
            /not the header's block/
        );
        expect(partition.block).to.equal(undefined);
        expect(partition.environment).to.equal(undefined);
        expect(() => partition.accept(messages[2])).to.throw(
            StorageProofError,
            /never synced/
        );
        partition.accept(messages[0]);
        expect(partition.block?.number).to.equal(blocks[0].number);
    });

    it("refuses a header whose state root is not the one its proof leads to, and holds nothing until the next sync", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        const { stateRoot } = messages[1].header;
        const tampered = structuredClone(messages[1]);
        tampered.header.stateRoot =
            stateRoot.slice(0, -2) + (stateRoot.endsWith("00") ? "01" : "00");

        expect(() => partition.accept(tampered)).to.throw(
            StorageProofError,
            /holds no node with hash/
        );
        expect(partition.block).to.equal(undefined);
        expect(partition.environment).to.equal(undefined);
        expect(() => partition.accept(messages[2])).to.throw(
            StorageProofError,
            /never synced/
        );
        partition.accept(messages[0]);
        expect(partition.block?.number).to.equal(blocks[0].number);
    });

    it("refuses a message that is no pushed storage block", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        const malformed = [
            {},
            null,
            { ...messages[0], values: "0x" },
            { ...messages[0], sync: "true" },
            { ...messages[0], ethereumHeader: undefined },
            { ...messages[0], proofNodes: [7] },
            { ...messages[1], values: [{ key: "0x00" }] },
            // hex that is not whole bytes
            { ...messages[0], ethereumHeader: "0x123" },
            { ...messages[1], values: [{ key: "0x123", value: null }] },
            {
                ...messages[1],
                proofNodes: [...messages[1].proofNodes, "0x123"]
            }
        ];
        for (const message of malformed)
            expect(
                () => partition.accept(message),
                JSON.stringify(message)?.slice(0, 80)
            ).to.throw(StorageProofError, /no storage block/);
    });

    it("refuses a message without the node's stages and holds nothing until the next sync, and hands on the stages of one it accepts", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        const malformed = [
            { ...messages[1], stages: undefined },
            { ...messages[1], stages: { ...messages[1].stages, builtAt: "1" } },
            {
                ...messages[1],
                stages: { ...messages[1].stages, executedAt: undefined }
            }
        ];
        for (const message of malformed) {
            partition.accept(messages[0]);
            expect(
                () => partition.accept(message),
                JSON.stringify(message.stages)
            ).to.throw(StorageProofError, /no storage block/);
            expect(partition.block).to.equal(undefined);
        }

        partition.accept(messages[0]);
        expect(taken(partition, messages[1]).stages).to.deep.equal(
            messages[1].stages
        );
    });

    it("keeps only the proof nodes the held keys use under the new root", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        const first = taken(partition, messages[1]);
        expect(first.heldNodes).to.equal(first.newNodes);
        const second = taken(partition, messages[2]);
        // the root and every node on a changed path were replaced
        expect(second.heldNodes).to.be.below(first.heldNodes + second.newNodes);
        expect(second.heldNodes).to.be.at.least(second.newNodes);
    });

    it("ignores a change of the block it holds, and refuses one of an earlier block and holds nothing until the next sync", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        partition.accept(messages[1]);
        partition.accept(messages[2]);
        const held = partition.block;

        expect(partition.accept(messages[2])).to.equal(undefined);
        expect(partition.block).to.deep.equal(held);

        expect(() => partition.accept(messages[1])).to.throw(
            StorageProofError,
            /after block/
        );
        expect(partition.block).to.equal(undefined);
        expect(taken(partition, messages[0]).sync).to.equal(true);
    });

    it("takes a change of another block of the height it holds", function () {
        const partition = new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS);
        partition.accept(messages[0]);
        partition.accept(messages[1]);
        const held = taken(partition, messages[2]).block;
        // another block of the same height over the same state, as a reorg pushes it
        const sibling = structuredClone(messages[2]);
        const { extrinsicsRoot } = sibling.header;
        sibling.header.extrinsicsRoot =
            extrinsicsRoot.slice(0, -2) +
            (extrinsicsRoot.endsWith("00") ? "01" : "00");

        const accepted = taken(partition, sibling);

        expect(accepted.block.number).to.equal(held.number);
        expect(accepted.block.hash).to.not.equal(held.hash);
        expect(accepted.block.stateRoot).to.equal(held.stateRoot);
        expect(partition.block).to.deep.equal(accepted.block);
        const { decided } = partition.decide([
            {
                address: contract,
                slots: SLOTS.map((slot) => toBeHex(slot, 32)),
                account: false,
                code: false
            }
        ]);
        expect(decided[0].proven.storage).to.deep.equal(
            SLOTS.map(
                (slot) =>
                    blocks[2].storage[
                        String(slot) as keyof (typeof blocks)[2]["storage"]
                    ]
            )
        );
    });
});
