// @distributed-requires: lightClient
// @spec-test-coverage-ignore: checks of the test-owned light client node fixture and endpoint stand-in; the endpoint's behavior is not specified yet, no specification or implementation IDs apply
import {
    LIGHT_CLIENT_UNSUPPORTED,
    LightClientNodeFixture
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex } from "ethers";

const SLOT_ONE = toBeHex(1, 32);
const SLOT_TWO = toBeHex(2, 32);

describe("Light client endpoints", function () {
    let node: LightClientNodeFixture | undefined;

    afterEach(async function () {
        await node?.stop();
        node = undefined;
    });

    it("throws at once when no peer3 node binary is named", async function () {
        const nodeBin = process.env.PEER3_NODE_BIN;
        delete process.env.PEER3_NODE_BIN;
        try {
            let failure: unknown;
            try {
                node = await LightClientNodeFixture.start();
            } catch (error) {
                failure = error;
            }
            expect(failure)
                .to.be.instanceOf(Error)
                .with.property("message")
                .that.includes(LIGHT_CLIENT_UNSUPPORTED);
        } finally {
            if (nodeBin !== undefined) process.env.PEER3_NODE_BIN = nodeBin;
        }
    });

    it("pushes no block whose logs carry no subscribed topic", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const connection = await node.connect();
        await connection.subscribe({ address: contract, topics: [SLOT_ONE] });

        await node.store(contract, SLOT_TWO, toBeHex(0xbbbb, 32));
        const receipt = await node.store(
            contract,
            SLOT_ONE,
            toBeHex(0xaaaa, 32)
        );
        await waitFor(() => connection.pushed.length > 0);

        expect(
            connection.pushed.map(({ block }) => block.logs[0].blockHash)
        ).to.deep.equal([receipt.blockHash]);
    });

    it("pushes no block to a removed subscription", async function () {
        node = await LightClientNodeFixture.start();
        const contract = await node.deployStoreAndLogContract();
        const removed = await node.connect();
        const kept = await node.connect();
        const subscription = { address: contract, topics: [SLOT_ONE] };
        const removedId = await removed.subscribe(subscription);
        await kept.subscribe(subscription);

        await node.store(contract, SLOT_ONE, toBeHex(0xaaaa, 32));
        await waitFor(() => removed.pushed.length === 1);
        expect(await removed.unsubscribe(removedId)).to.equal(true);
        await node.store(contract, SLOT_ONE, toBeHex(0xbbbb, 32));
        await waitFor(() => kept.pushed.length === 2);

        expect(removed.pushed.length).to.equal(1);
    });
});
