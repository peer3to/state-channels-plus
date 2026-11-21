// @distributed-requires: lightClient
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { expect } from "chai";
import { Contract, toBeHex } from "ethers";
import { ethers } from "hardhat";

const DIFFERENT_ANSWER =
    "Light client answered a read otherwise than the RPC node at the same block";
const NOT_ANSWERED = "RPC node did not answer a compared read";

describe("Light client read comparison", function () {
    let fixture: LightClientProviderFixture | undefined;

    afterEach(async function () {
        await fixture?.stop();
        fixture = undefined;
    });

    async function numberStorageInterface() {
        return (await ethers.getContractFactory("SimpleNumberStorage"))
            .interface;
    }

    it("asks the node each read it answers at the block that proved it, and finds them alike, a revert included", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        const contract = new Contract(address, abi, provider);

        expect(await contract.getValue()).to.equal(42n);
        const revert = await provider
            .call({
                to: address,
                data: abi.encodeFunctionData("revertWithMessage", ["not today"])
            })
            .then(
                () => undefined,
                (error: unknown) => error
            );
        expect(revert).to.have.property("reason", "not today");
        await provider.getStorage(address, 0);
        await provider.getCode(address);
        await provider.getBalance(node.senderAddress);
        await provider.getTransactionCount(node.senderAddress);

        expect(provider.readComparisons).to.deep.equal({
            matched: 6,
            differed: 0,
            notCompared: 0
        });
        // every compared read named its block by hash, none asked for the latest
        const compared = proxy.forwardedRequests.filter(({ method }) =>
            [
                "eth_call",
                "eth_getStorageAt",
                "eth_getCode",
                "eth_getBalance",
                "eth_getTransactionCount"
            ].includes(method)
        );
        expect(compared).to.have.length(6);
        for (const { params } of compared)
            expect((params as unknown[]).at(-1)).to.have.property("blockHash");
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("logs an error and counts a read the node answers otherwise at the same block, and keeps the proven answer", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        proxy.answerRequests("eth_call", toBeHex(7, 32));

        expect(await new Contract(address, abi, provider).getValue()).to.equal(
            42n
        );

        expect(provider.readComparisons).to.deep.equal({
            matched: 0,
            differed: 1,
            notCompared: 0
        });
        expect(fixture.loggedErrorMessages()).to.deep.equal([DIFFERENT_ANSWER]);
    });

    it("counts a read the node gives no answer to at that block as not compared, with a warning", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { provider, proxy } = fixture;
        const address = await fixture.deployNumberStorage();
        proxy.failNextRequest("eth_getStorageAt");

        await provider.getStorage(address, 0);

        expect(provider.readComparisons).to.deep.equal({
            matched: 0,
            differed: 0,
            notCompared: 1
        });
        expect(fixture.loggedWarningMessages()).to.include(NOT_ANSWERED);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });
});
