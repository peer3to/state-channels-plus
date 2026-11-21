// @distributed-requires: lightClient
import { REVERT_ERROR_CODE } from "@/evm/p2pRuntime/rpcNodes/lightClient/LocalReadParser";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { Contract, Interface, toBeHex } from "ethers";
import { ethers } from "hardhat";

const DIFFERENT_ANSWER =
    "Light client answered a read otherwise than the RPC node at the same block";
const NOT_ANSWERED = "RPC node did not answer a compared read";
/** Revert data of a plain `revert("other")`. */
const REVERT_DATA = new Interface(["error Error(string)"]).encodeErrorResult(
    "Error",
    ["other"]
);

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

    it("names the block that proved the answer when it asks the node, after the chain has moved past it", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        const releaseCompared = proxy.holdRequests("eth_call", 1);

        const read = new Contract(address, abi, provider).getValue();
        await waitFor(() => proxy.forwardedCount("eth_call") === 1);
        // the Substrate block the light client proved the call at
        const proofRequest = proxy.forwardedRequests
            .filter(({ method }) => method === "state_getReadProof")
            .at(-1)!;
        const provedAt = (proofRequest.params as string[])[1];
        const header = (await node.provider.send("chain_getHeader", [
            provedAt
        ])) as { number: string };
        const provedNumber = Number(header.number);
        await waitFor(
            async () => (await node.provider.getBlockNumber()) > provedNumber
        );
        releaseCompared();

        expect(await read).to.equal(42n);
        const compared = proxy.forwardedRequests
            .filter(({ method }) => method === "eth_call")
            .at(-1)!;
        expect((compared.params as unknown[])[1]).to.deep.equal({
            blockHash: (await node.provider.getBlock(provedNumber))!.hash
        });
        expect(provider.readComparisons).to.deep.equal({
            matched: 1,
            differed: 0,
            notCompared: 0
        });
    });

    it("counts a call it answers with a value that the node answers with a revert as differed", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        proxy.rejectRequests("eth_call", {
            code: REVERT_ERROR_CODE,
            message: "execution reverted",
            data: REVERT_DATA
        });

        expect(await new Contract(address, abi, provider).getValue()).to.equal(
            42n
        );

        expect(provider.readComparisons.differed).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([DIFFERENT_ANSWER]);
    });

    it("counts a call it answers with a revert that the node answers with a value as differed", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        proxy.answerRequests("eth_call", toBeHex(7, 32));

        const revert = await fixture.revertOf(address, abi);

        expect(revert).to.have.property("reason", "not today");
        expect(provider.readComparisons.differed).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([DIFFERENT_ANSWER]);
    });

    it("counts a revert the node answers with other revert data as differed", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        proxy.rejectRequests("eth_call", {
            code: REVERT_ERROR_CODE,
            message: "execution reverted",
            data: REVERT_DATA
        });

        const revert = await fixture.revertOf(address, abi);

        expect(revert).to.have.property("reason", "not today");
        expect(provider.readComparisons.differed).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([DIFFERENT_ANSWER]);
    });

    it("counts a call the node fails without revert data as differed", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        proxy.rejectRequests("eth_call", {
            code: -32000,
            message: "out of gas"
        });

        expect(await new Contract(address, abi, provider).getValue()).to.equal(
            42n
        );

        expect(provider.readComparisons.differed).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([DIFFERENT_ANSWER]);
    });

    it("counts a read whose node connection ends before the node answers as not compared, with a warning", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        proxy.holdRequests("eth_call", 1);

        const read = new Contract(address, abi, provider).getValue();
        await waitFor(() => proxy.forwardedCount("eth_call") === 1);
        proxy.cut();

        expect(await read).to.equal(42n);
        proxy.restore();
        expect(provider.readComparisons).to.deep.equal({
            matched: 0,
            differed: 0,
            notCompared: 1
        });
        expect(fixture.loggedWarningMessages()).to.include(NOT_ANSWERED);
    });
});
