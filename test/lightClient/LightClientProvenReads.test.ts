// @distributed-requires: lightClient
import type { ProvenBlock } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/AProvenStateReader";
import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import { PEER3_CHAIN_CONSTANTS } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierChainConstants";
import FrontierProvenStateReader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierProvenStateReader";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import type { JsonRpcSocket } from "@test/fixtures/lightClient/JsonRpcSocket";
import { LightClientNodeFixture } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex, ZeroHash } from "ethers";

const SLOT_ONE = toBeHex(1, 32);
const SLOT_TWO = toBeHex(2, 32);

function readerOver(socket: JsonRpcSocket): FrontierProvenStateReader {
    return new FrontierProvenStateReader(
        (method, params) => socket.request(method, params),
        PEER3_CHAIN_CONSTANTS
    );
}

async function rejectionOf(read: Promise<unknown>): Promise<unknown> {
    try {
        await read;
    } catch (error) {
        return error;
    }
    return undefined;
}

describe("Light client proven reads", function () {
    let node: LightClientNodeFixture | undefined;

    afterEach(async function () {
        await node?.stop();
        node = undefined;
    });

    /** The node's best block, once its Ethereum RPC serves that block too. */
    async function servedHead(
        fixture: LightClientNodeFixture,
        reader: FrontierProvenStateReader
    ): Promise<ProvenBlock> {
        const head = await reader.head();
        await waitFor(
            async () => (await fixture.provider.getBlock(head.number)) !== null
        );
        return head;
    }

    it("reads slots, code and accounts proven at the node's best block, equal to the node's own answers", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const value = toBeHex(0xaaaa, 32);
        await node.store(contract, SLOT_ONE, value);
        const socket = await node.connectToNode();
        const reader = readerOver(socket);

        const head = await servedHead(node, reader);
        const [ofContract, ofSender] = await reader.read(head, [
            {
                address: contract,
                slots: [SLOT_TWO, SLOT_ONE],
                account: true,
                code: true
            },
            {
                address: node.senderAddress,
                slots: [],
                account: true,
                code: false
            }
        ]);

        expect(head.hash).to.equal(
            await socket.request("chain_getBlockHash", [head.number])
        );
        const block = await node.provider.getBlock(head.number);
        expect(head.ethereumBlockHash).to.equal(block?.hash);
        expect(ofContract.storage).to.deep.equal([ZeroHash, value]);
        expect(ofContract.storage[1]).to.equal(
            await node.provider.getStorage(contract, SLOT_ONE, head.number)
        );
        expect(ofContract.code).to.equal(
            await node.provider.getCode(contract, head.number)
        );
        expect(ofContract.code).to.not.equal("0x");
        expect(ofContract.account).to.deep.equal({
            nonce: 1n,
            balance: 0n
        });
        expect(ofSender).to.deep.equal({
            address: node.senderAddress,
            storage: [],
            account: {
                nonce: BigInt(
                    await node.provider.getTransactionCount(
                        node.senderAddress,
                        head.number
                    )
                ),
                balance: await node.provider.getBalance(
                    node.senderAddress,
                    head.number
                )
            }
        });
        expect(ofSender.account?.nonce).to.equal(2n);
        expect(ofSender.account?.balance).to.not.equal(0n);
    });

    it("reads a block's own state after the chain moved on", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const first = toBeHex(0xaaaa, 32);
        const second = toBeHex(0xbbbb, 32);
        await node.store(contract, SLOT_ONE, first);
        const reader = readerOver(await node.connectToNode());
        const read = [
            {
                address: contract,
                slots: [SLOT_ONE],
                account: false,
                code: false
            }
        ];

        const earlier = await reader.head();
        const receipt = await node.store(contract, SLOT_ONE, second);
        const later = await reader.head();

        expect(later.number).to.be.at.least(receipt.blockNumber);
        expect(later.number).to.be.greaterThan(earlier.number);
        expect(await reader.read(earlier, read)).to.deep.equal([
            { address: contract, storage: [first] }
        ]);
        expect(await reader.read(later, read)).to.deep.equal([
            { address: contract, storage: [second] }
        ]);
    });

    it("asks the node for no proof when a read asks nothing", async function () {
        node = await LightClientNodeFixture.start();
        await node.firstBlockSealed();
        const { proxy, socket } = await node.connectToNodeThroughProxy();
        const reader = readerOver(socket);
        const head = await reader.head();

        expect(
            await reader.read(head, [
                {
                    address: node.senderAddress,
                    slots: [],
                    account: false,
                    code: false
                }
            ])
        ).to.deep.equal([{ address: node.senderAddress, storage: [] }]);
        expect(await reader.read(head, [])).to.deep.equal([]);
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(1);
        expect(proxy.forwardedCount("state_getReadProof")).to.equal(0);
    });

    it("throws when the node answers with the proof of another block", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const second = toBeHex(0xbbbb, 32);
        await node.store(contract, SLOT_ONE, toBeHex(0xaaaa, 32));
        const { proxy, socket } = await node.connectToNodeThroughProxy();
        const reader = readerOver(socket);
        const read = [
            {
                address: contract,
                slots: [SLOT_ONE],
                account: false,
                code: false
            }
        ];

        const earlier = await reader.head();
        await node.store(contract, SLOT_ONE, second);
        const later = await reader.head();
        const earlierProof = await socket.request("state_getReadProof", [
            [contractStorageKey(contract, SLOT_ONE)],
            earlier.hash
        ]);
        proxy.answerNextRequest("state_getReadProof", earlierProof);

        expect(await rejectionOf(reader.read(later, read)))
            .to.be.instanceOf(StorageProofError)
            .with.property("message")
            .that.includes("holds no node with hash");
        // the node's own proof of that block is accepted
        expect(await reader.read(later, read)).to.deep.equal([
            { address: contract, storage: [second] }
        ]);
    });

    it("throws when the node answers a read with no proof", async function () {
        node = await LightClientNodeFixture.start();
        await node.firstBlockSealed();
        const { proxy, socket } = await node.connectToNodeThroughProxy();
        const reader = readerOver(socket);
        const head = await reader.head();
        const read = [
            {
                address: node.senderAddress,
                slots: [],
                account: true,
                code: false
            }
        ];

        proxy.answerNextRequest("state_getReadProof", null);
        expect(await rejectionOf(reader.read(head, read)))
            .to.be.instanceOf(StorageProofError)
            .with.property("message")
            .that.includes("no read proof");
        proxy.answerNextRequest("state_getReadProof", {
            at: head.hash,
            proof: ["not hex"]
        });
        expect(await rejectionOf(reader.read(head, read)))
            .to.be.instanceOf(StorageProofError)
            .with.property("message")
            .that.includes("no read proof");
        // an empty proof is a proof that decides nothing
        proxy.answerNextRequest("state_getReadProof", {
            at: head.hash,
            proof: []
        });
        expect(await rejectionOf(reader.read(head, read)))
            .to.be.instanceOf(StorageProofError)
            .with.property("message")
            .that.includes("holds no node with hash");
    });

    it("throws when the node answers no block header", async function () {
        node = await LightClientNodeFixture.start();
        await node.firstBlockSealed();
        const { proxy, socket } = await node.connectToNodeThroughProxy();
        const reader = readerOver(socket);
        const header = await socket.request<{ digest: { logs: string[] } }>(
            "chain_getHeader"
        );

        proxy.answerNextRequest("chain_getHeader", null);
        expect(await rejectionOf(reader.head()))
            .to.be.instanceOf(StorageProofError)
            .with.property("message")
            .that.includes("no block header");
        proxy.answerNextRequest("chain_getHeader", {
            ...header,
            digest: { logs: [7] }
        });
        expect(await rejectionOf(reader.head()))
            .to.be.instanceOf(StorageProofError)
            .with.property("message")
            .that.includes("no block header");
        // the same header as the node gave it is accepted
        proxy.answerNextRequest("chain_getHeader", header);
        expect((await reader.head()).hash).to.equal(
            await socket.request("chain_getBlockHash", [
                (header as { number?: string }).number
            ])
        );
    });
});
