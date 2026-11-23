// @distributed-requires: lightClient
import LightClientRpcProvider from "@/evm/p2pRuntime/rpcNodes/LightClientRpcProvider";
import {
    isChainProven,
    replicatedStateSource
} from "@/evm/p2pRuntime/rpcNodes/provenChainReads";
import { sleep } from "@/utils";
import { connectLocalDiamond } from "@/utils/localDiamond";
import {
    BLOB_BASE_FEE_CONTRACT,
    BLOCK_VALUES_CONTRACT,
    CALLER_AND_ORIGIN_CONTRACT,
    INVALID_OPCODE_CONTRACT,
    OUT_OF_GAS_CONTRACT,
    PREVIOUS_BLOCK_HASH_CONTRACT,
    STATIC_FORWARDER_CONTRACT
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import {
    AbiCoder,
    Wallet,
    concat,
    Contract,
    sha256,
    toBeHex,
    zeroPadValue
} from "ethers";
import { ethers } from "hardhat";

/** No read was answered by the nodes. */
const NO_NODE_ANSWER = { leftToNodes: 0, failed: 0, unsupported: 0 };
const XCM_PRECOMPILE = "0x0000000000000000000000000000000000000800";
const FAILED_READ = "Light client failed a read; asking the nodes";
/** Long enough for a request a read sends on to reach the endpoint's proxy. */
const UNSENT_REQUEST_WAIT_MS = 200;

/** How a call ended: what it returned, or the data it reverted with. */
function outcomeOf(call: Promise<string>) {
    return call.then(
        (returned) => ({ returned }),
        (error: { data?: string }) => ({ revertedWith: error.data })
    );
}

describe("Light client provider", function () {
    let fixture: LightClientProviderFixture | undefined;

    afterEach(async function () {
        await fixture?.stop();
        fixture = undefined;
    });

    async function numberStorageInterface() {
        return (await ethers.getContractFactory("SimpleNumberStorage"))
            .interface;
    }

    it("answers a contract call from proven state with the node's own answer", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));

        const viaLightClient = new Contract(address, abi, provider);
        const viaNode = new Contract(address, abi, node.provider);

        expect(await viaLightClient.getValue()).to.equal(42n);
        expect(await viaNode.getValue()).to.equal(42n);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 1,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("answers a reverting call with the node's revert reason", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        const call = {
            to: address,
            data: abi.encodeFunctionData("revertWithMessage", ["not today"])
        };

        const failure = await provider.call(call).then(
            () => undefined,
            (error: unknown) => error
        );
        const nodeFailure = await node.provider.call(call).then(
            () => undefined,
            (error: unknown) => error
        );

        expect(failure).to.have.property("reason", "not today");
        expect(nodeFailure).to.have.property("reason", "not today");
        expect(failure)
            .to.have.property("data")
            .that.equals((nodeFailure as { data: string }).data);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 1,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
    });

    it("answers a call that reaches a second contract", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const storage = await fixture.deployNumberStorage();
        const forwarder = await node.deploy(STATIC_FORWARDER_CONTRACT);
        await node.transact(storage, abi.encodeFunctionData("setValue", [7n]));
        const call = {
            to: forwarder,
            data: concat([
                zeroPadValue(storage, 32),
                abi.encodeFunctionData("getValue")
            ])
        };

        expect(await provider.call(call)).to.equal(toBeHex(7n, 32));
        expect(await node.provider.call(call)).to.equal(toBeHex(7n, 32));
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 1,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
    });

    it("runs a call into one of Ethereum's precompiles without proving the precompile's account", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const forwarder = await node.deploy(STATIC_FORWARDER_CONTRACT);
        const toSha256 = {
            to: forwarder,
            data: concat([zeroPadValue("0x02", 32), "0x1234"])
        };

        expect(await provider.call(toSha256)).to.equal(sha256("0x1234"));
        expect(await node.provider.call(toSha256)).to.equal(sha256("0x1234"));
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 1,
            ...NO_NODE_ANSWER
        });
        // the block's values, then the forwarder and the caller: nothing of
        // the precompile
        expect(proxy.forwardedCount("state_getReadProof")).to.equal(2);
        expect(fixture.forwardedReadCount()).to.equal(0);
    });

    it("answers the block values a call reads as the node's block has them", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const probe = await node.deploy(BLOCK_VALUES_CONTRACT);

        const [
            number,
            timestamp,
            coinbase,
            gasLimit,
            prevRandao,
            baseFee,
            chainId
        ] = AbiCoder.defaultAbiCoder().decode(
            [
                "uint256",
                "uint256",
                "address",
                "uint256",
                "uint256",
                "uint256",
                "uint256"
            ],
            await provider.call({ to: probe })
        );
        const viaNode = AbiCoder.defaultAbiCoder().decode(
            [
                "uint256",
                "uint256",
                "address",
                "uint256",
                "uint256",
                "uint256",
                "uint256"
            ],
            await node.provider.call({ to: probe, blockTag: Number(number) })
        );

        expect([
            number,
            timestamp,
            coinbase,
            gasLimit,
            prevRandao,
            baseFee,
            chainId
        ]).to.deep.equal([...viaNode]);
        expect(chainId).to.equal((await node.provider.getNetwork()).chainId);
        expect(timestamp > 0n && gasLimit > 0n).to.equal(true);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 1,
            ...NO_NODE_ANSWER
        });
    });

    it("answers storage, code, balance and nonce reads with the node's own answers", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        const sender = node.senderAddress;

        expect(await provider.getStorage(address, 0)).to.equal(
            toBeHex(42n, 32)
        );
        expect(await provider.getStorage(address, 1)).to.equal(
            await node.provider.getStorage(address, 1)
        );
        expect(await provider.getCode(address))
            .to.equal(await node.provider.getCode(address))
            .and.to.not.equal("0x");
        expect(await provider.getCode(sender)).to.equal("0x");
        expect(await provider.getBalance(sender))
            .to.equal(await node.provider.getBalance(sender))
            .and.to.not.equal(0n);
        expect(await provider.getBalance(address)).to.equal(0n);
        expect(await provider.getTransactionCount(sender))
            .to.equal(await node.provider.getTransactionCount(sender))
            .and.to.equal(2);
        expect(await provider.getTransactionCount(address)).to.equal(1);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 8,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
    });

    it("answers from the block a mined transaction is in", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        const viaLightClient = new Contract(address, abi, provider);

        await node.transact(address, abi.encodeFunctionData("setValue", [1n]));
        expect(await viaLightClient.getValue()).to.equal(1n);
        await node.transact(address, abi.encodeFunctionData("setValue", [2n]));
        expect(await viaLightClient.getValue()).to.equal(2n);
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(2n, 32));

        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 3,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
    });

    it("keeps nothing a call wrote", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        const increment = {
            to: address,
            data: abi.encodeFunctionData("increment")
        };
        const getValue = {
            to: address,
            data: abi.encodeFunctionData("getValue")
        };

        // the call returns the incremented value and writes it
        expect(await provider.call(increment)).to.equal(toBeHex(43n, 32));
        expect(await provider.call(getValue)).to.equal(toBeHex(42n, 32));
        expect(await provider.getStorage(address, 0)).to.equal(
            toBeHex(42n, 32)
        );
        expect(await provider.call(increment)).to.equal(toBeHex(43n, 32));
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 4,
            ...NO_NODE_ANSWER
        });
    });

    it("keeps the answers of reads made at once apart", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const first = await fixture.deployNumberStorage();
        const second = await fixture.deployNumberStorage();
        await node.transact(first, abi.encodeFunctionData("setValue", [11n]));
        await node.transact(second, abi.encodeFunctionData("setValue", [22n]));
        const getValue = abi.encodeFunctionData("getValue");

        const answers = await Promise.all([
            provider.call({ to: first, data: getValue }),
            provider.call({ to: second, data: getValue }),
            provider.getStorage(first, 0),
            provider.getTransactionCount(node.senderAddress),
            provider.call({ to: second, data: getValue })
        ]);

        expect(answers).to.deep.equal([
            toBeHex(11n, 32),
            toBeHex(22n, 32),
            toBeHex(11n, 32),
            4,
            toBeHex(22n, 32)
        ]);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 5,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
    });

    it("proves the block values and the state two calls made at once at one block both need in one request each", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        // both calls read at this block, whatever the node seals meanwhile
        proxy.answerRequests(
            "chain_getHeader",
            await node.provider.send("chain_getHeader", [])
        );
        const call = { to: address, data: abi.encodeFunctionData("getValue") };
        const requestsBefore = proxy.forwardedRequests.length;
        const proofsBefore = proxy.forwardedCount("state_getReadProof");
        const headersBefore = proxy.forwardedCount("chain_getHeader");
        const release = proxy.holdRequests("state_getReadProof", 1);

        const first = provider.call(call);
        await waitFor(
            () =>
                proxy.forwardedCount("state_getReadProof") === proofsBefore + 1
        );
        const second = provider.call(call);
        await waitFor(
            () => proxy.forwardedCount("chain_getHeader") === headersBefore + 2
        );
        // the second call has its block and waits for the block values the first asked for
        await sleep(UNSENT_REQUEST_WAIT_MS);
        expect(proxy.forwardedCount("state_getReadProof")).to.equal(
            proofsBefore + 1
        );
        release();

        expect(await first).to.equal(toBeHex(42n, 32));
        expect(await second).to.equal(toBeHex(42n, 32));
        const provenKeys = proxy.forwardedRequests
            .slice(requestsBefore)
            .filter(({ method }) => method === "state_getReadProof")
            .flatMap(({ params }) => (params as [string[], string])[0]);
        expect(provenKeys).to.have.length.greaterThan(1);
        expect(new Set(provenKeys).size).to.equal(provenKeys.length);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 2,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("asks the endpoint once for its best block for two reads made while its answer is awaited", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        const headersBefore = proxy.forwardedCount("chain_getHeader");
        const release = proxy.holdRequests("chain_getHeader", 1);

        const first = provider.getStorage(address, 0);
        await waitFor(
            () => proxy.forwardedCount("chain_getHeader") === headersBefore + 1
        );
        const second = provider.getStorage(address, 0);
        // the second read waits for the best block the first asked for
        await sleep(UNSENT_REQUEST_WAIT_MS);
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(
            headersBefore + 1
        );
        release();

        expect(await first).to.equal(toBeHex(42n, 32));
        expect(await second).to.equal(toBeHex(42n, 32));
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(
            headersBefore + 1
        );
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 2,
            ...NO_NODE_ANSWER
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("asks the endpoint for its best block again for a read made after the block floor rose above a lookup still awaited", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [7n]));
        const headersBefore = proxy.forwardedCount("chain_getHeader");
        const replies = proxy.holdReplies("chain_getHeader");

        const first = provider.getStorage(address, 0);
        await waitFor(() => replies.heldReplies() === 1);
        // a later block, which the endpoint then shows the participant
        await node.transact(address, abi.encodeFunctionData("setValue", [8n]));
        await provider.send("eth_blockNumber", []);
        const second = provider.getStorage(address, 0);
        await waitFor(() => replies.heldReplies() === 2);
        replies.release();

        // the first read's best block is below the floor: the node answers it
        expect(await first).to.equal(toBeHex(8n, 32));
        expect(await second).to.equal(toBeHex(8n, 32));
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(
            headersBefore + 2
        );
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 1,
            leftToNodes: 0,
            failed: 1,
            unsupported: 0
        });
        expect(fixture.forwardedReadCount()).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
    });

    it("sends the node a read at an earlier block, a pending nonce and a call with a gas limit", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        const first = await node.transact(
            address,
            abi.encodeFunctionData("setValue", [1n])
        );
        await node.transact(address, abi.encodeFunctionData("setValue", [2n]));
        const getValue = abi.encodeFunctionData("getValue");

        expect(
            await provider.call({
                to: address,
                data: getValue,
                blockTag: first.blockNumber
            })
        ).to.equal(toBeHex(1n, 32));
        expect(
            await provider.getStorage(address, 0, first.blockNumber)
        ).to.equal(toBeHex(1n, 32));
        expect(
            await provider.getTransactionCount(node.senderAddress, "pending")
        ).to.equal(3);
        expect(
            await provider.call({
                to: address,
                data: getValue,
                gasLimit: 100_000n
            })
        ).to.equal(toBeHex(2n, 32));

        expect(fixture.forwardedReadCount()).to.equal(4);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            ...NO_NODE_ANSWER
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("leaves to the node a call that reaches the chain's own precompile or reads an earlier block's hash", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const forwarder = await node.deploy(STATIC_FORWARDER_CONTRACT);
        const blockHashReader = await node.deploy(PREVIOUS_BLOCK_HASH_CONTRACT);
        const toPrecompile = {
            to: forwarder,
            data: concat([zeroPadValue(XCM_PRECOMPILE, 32), "0x12345678"])
        };

        expect(await outcomeOf(provider.call(toPrecompile))).to.deep.equal(
            await outcomeOf(node.provider.call(toPrecompile))
        );
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            leftToNodes: 1,
            failed: 0,
            unsupported: 0
        });

        const blockHash = await provider.call({ to: blockHashReader });
        expect(blockHash).to.match(/^0x[0-9a-f]{64}$/);
        expect(blockHash).to.not.equal(toBeHex(0n, 32));
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            leftToNodes: 2,
            failed: 0,
            unsupported: 0
        });
        expect(fixture.forwardedReadCount()).to.equal(2);
        // nothing failed: the node runs these calls by design
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("asks the node, logs an error and counts the failure when a proof is refused", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [42n]));
        const viaLightClient = new Contract(address, abi, provider);

        // a storage read whose proof decides nothing
        proxy.answerNextRequest("state_getReadProof", { proof: [] });
        expect(await provider.getStorage(address, 0)).to.equal(
            toBeHex(42n, 32)
        );
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            leftToNodes: 0,
            failed: 1,
            unsupported: 0
        });
        expect(proxy.forwardedCount("eth_getStorageAt")).to.equal(1);

        // a call whose first proof, of the block's environment, is refused
        proxy.answerNextRequest("state_getReadProof", { proof: [] });
        expect(await viaLightClient.getValue()).to.equal(42n);
        expect(provider.lightClientCounters.failed).to.equal(2);
        expect(proxy.forwardedCount("eth_call")).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([
            FAILED_READ,
            FAILED_READ
        ]);
        expect(
            fixture.loggedErrors().map((entry) => entry.meta[0].reason)
        ).to.deep.equal(["proof rejected", "proof rejected"]);

        // the next reads are proven again
        expect(await viaLightClient.getValue()).to.equal(42n);
        expect(await provider.getStorage(address, 0)).to.equal(
            toBeHex(42n, 32)
        );
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 2,
            leftToNodes: 0,
            failed: 2,
            unsupported: 0
        });
        expect(fixture.forwardedReadCount()).to.equal(2);
    });

    it("asks the node, logs an error and counts the failure when the node gives no block header", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [5n]));

        proxy.failNextRequest("chain_getHeader");
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(5n, 32));

        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            leftToNodes: 0,
            failed: 1,
            unsupported: 0
        });
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
        expect(fixture.loggedErrors()[0].meta[0].reason).to.equal(
            "read failed"
        );
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(5n, 32));
        expect(provider.lightClientCounters.withFallbackRead).to.equal(1);
    });

    it("asks the node for every read and says once that the node lists no light client endpoints", async function () {
        fixture = await LightClientProviderFixture.start({
            withoutEndpoints: true
        });
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [9n]));
        const viaLightClient = new Contract(address, abi, provider);

        expect(await viaLightClient.getValue()).to.equal(9n);
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(9n, 32));

        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            leftToNodes: 0,
            failed: 0,
            unsupported: 2
        });
        expect(fixture.forwardedReadCount()).to.equal(2);
        expect(proxy.forwardedCount("rpc_methods")).to.equal(1);
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(0);
        // the light client is optional: a node without it is no fault
        expect(fixture.loggedErrors()).to.deep.equal([]);
        expect(
            fixture
                .loggedInfoMessages()
                .filter((message) => message.includes("LC endpoints"))
        ).to.deep.equal([
            "RPC node doesn't support LC endpoints; it answers the chain reads itself"
        ]);
    });

    it("asks the node once which methods it serves, at the first read the light client may answer", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [3n]));

        expect(provider).to.be.instanceOf(LightClientRpcProvider);
        await provider.getBlockNumber();
        expect(proxy.forwardedCount("rpc_methods")).to.equal(0);
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(3n, 32));
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(3n, 32));
        expect(proxy.forwardedCount("rpc_methods")).to.equal(1);
        expect(provider.lightClientCounters.withFallbackRead).to.equal(2);
    });

    it("leaves to the node a call that runs out of gas or hits an invalid opcode locally", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const outOfGas = { to: await node.deploy(OUT_OF_GAS_CONTRACT) };
        const invalid = { to: await node.deploy(INVALID_OPCODE_CONTRACT) };

        expect(await outcomeOf(provider.call(outOfGas))).to.deep.equal(
            await outcomeOf(node.provider.call(outOfGas))
        );
        expect(await outcomeOf(provider.call(invalid))).to.deep.equal(
            await outcomeOf(node.provider.call(invalid))
        );

        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            leftToNodes: 2,
            failed: 0,
            unsupported: 0
        });
        expect(fixture.forwardedCount("eth_call")).to.equal(2);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("leaves to the node a call that reads the blob base fee, and answers with the node's answer", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const blobBaseFee = { to: await node.deploy(BLOB_BASE_FEE_CONTRACT) };

        expect(await outcomeOf(provider.call(blobBaseFee))).to.deep.equal(
            await outcomeOf(node.provider.call(blobBaseFee))
        );

        expect(provider.lightClientCounters).to.deep.include({
            leftToNodes: 1,
            failed: 0
        });
        expect(fixture.forwardedCount("eth_call")).to.equal(1);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("asks the node for every read when the node answers that it does not know rpc_methods", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        proxy.rejectRequests("rpc_methods", {
            code: -32601,
            message: "Method not found"
        });
        const address = await fixture.deployNumberStorage();

        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(0, 32));
        expect(await provider.getCode(address)).to.equal(
            await node.provider.getCode(address)
        );

        expect(provider.lightClientCounters).to.deep.include({
            unsupported: 2,
            failed: 0
        });
        expect(proxy.forwardedCount("rpc_methods")).to.equal(1);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("asks the node for every read when the node answers, as Hardhat does, that it does not support rpc_methods", async function () {
        fixture = await LightClientProviderFixture.start();
        const { provider, proxy } = fixture;
        proxy.rejectRequests("rpc_methods", {
            code: -32004,
            message: "Method rpc_methods is not supported"
        });
        const address = await fixture.deployNumberStorage();

        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(0, 32));
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(0, 32));

        expect(provider.lightClientCounters).to.deep.include({
            unsupported: 2,
            failed: 0
        });
        expect(proxy.forwardedCount("rpc_methods")).to.equal(1);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("asks the node again which methods it serves when the question failed", async function () {
        fixture = await LightClientProviderFixture.start();
        const { provider, proxy } = fixture;
        const address = await fixture.deployNumberStorage();
        proxy.failNextRequest("rpc_methods");

        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(0, 32));
        expect(provider.lightClientCounters).to.deep.include({
            failed: 1,
            unsupported: 0
        });
        expect(fixture.loggedErrors()[0].meta[0].reason).to.equal(
            "read failed"
        );

        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(0, 32));
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 1,
            failed: 1
        });
        expect(proxy.forwardedCount("rpc_methods")).to.equal(2);
        expect(
            fixture
                .loggedInfoMessages()
                .filter((message) => message.includes("LC endpoints"))
        ).to.deep.equal([]);
    });

    it("fails reads still running at destroy as a plain provider would, without counting or logging them", async function () {
        fixture = await LightClientProviderFixture.start();
        const { provider, proxy } = fixture;
        const address = await fixture.deployNumberStorage();
        // the endpoint question is answered before the reads start
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(0, 32));
        const countersBefore = { ...provider.lightClientCounters };
        const proofsBefore = proxy.forwardedCount("state_getReadProof");
        proxy.holdRequests("state_getReadProof");

        // slots no read held yet: each read waits for a proof from the node
        const reads = [1, 2, 3].map((slot) =>
            provider.getStorage(address, slot).then(
                () => undefined,
                (error: unknown) => error
            )
        );
        await waitFor(
            () => proxy.forwardedCount("state_getReadProof") >= proofsBefore + 3
        );
        provider.destroy();
        const failures = await Promise.all(reads);

        for (const failure of failures)
            expect(failure)
                .to.be.instanceOf(Error)
                .with.property("message")
                .that.includes("destroyed");
        expect(provider.lightClientCounters).to.deep.equal(countersBefore);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("sends the node a pending read and a call with a gas price", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [4n]));
        const getValue = abi.encodeFunctionData("getValue");

        expect(
            await provider.getBalance(node.senderAddress, "pending")
        ).to.equal(await node.provider.getBalance(node.senderAddress));
        expect(await provider.getStorage(address, 0, "pending")).to.equal(
            toBeHex(4n, 32)
        );
        expect(
            await provider.call({
                to: address,
                data: getValue,
                blockTag: "pending"
            })
        ).to.equal(toBeHex(4n, 32));
        expect(
            await provider.call({
                to: address,
                data: getValue,
                gasPrice: 10_000_000_000n
            })
        ).to.equal(toBeHex(4n, 32));

        expect(fixture.forwardedReadCount()).to.equal(4);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 0,
            withFallbackRead: 0,
            ...NO_NODE_ANSWER
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("answers a call with the caller and origin the node gives it", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const probe = await node.deploy(CALLER_AND_ORIGIN_CONTRACT);
        const wallet = Wallet.createRandom(provider);
        const expected = AbiCoder.defaultAbiCoder().encode(
            ["address", "address"],
            [wallet.address, wallet.address]
        );

        expect(await wallet.call({ to: probe })).to.equal(expected);
        expect(
            await provider.call({ from: wallet.address, to: probe })
        ).to.equal(expected);
        expect(
            await node.provider.call({ from: wallet.address, to: probe })
        ).to.equal(expected);

        expect(fixture.forwardedReadCount()).to.equal(0);
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 2,
            failed: 0
        });
    });

    it("says a contract's reads are proven while the serving endpoint lists the light client endpoints, not while that question fails, and reads replicated state from it then", async function () {
        fixture = await LightClientProviderFixture.start();
        const { provider, proxy } = fixture;
        const contract = new Contract(
            await fixture.deployNumberStorage(),
            await numberStorageInterface(),
            provider
        );
        proxy.failNextRequest("rpc_methods");

        expect(await isChainProven(contract)).to.equal(false);
        expect(fixture.loggedWarningMessages()).to.include(
            "RPC node did not say whether it serves the light client; chain reads keep their local checks"
        );
        // the failed question is asked again
        expect(await isChainProven(contract)).to.equal(true);
        expect(await provider.answersFromProvenState()).to.equal(true);
        expect(proxy.forwardedCount("rpc_methods")).to.equal(2);
        const chain = connectLocalDiamond(String(contract.target), provider);
        const localDiamond = connectLocalDiamond(
            String(contract.target),
            fixture.node.provider
        );
        expect(await replicatedStateSource(localDiamond, chain)).to.equal(
            chain
        );
    });

    it("says a contract's reads are not proven over an endpoint without the light client endpoints, or over a plain provider, and reads replicated state from the local diamond then", async function () {
        fixture = await LightClientProviderFixture.start({
            withoutEndpoints: true
        });
        const { node, provider } = fixture;
        const address = await fixture.deployNumberStorage();
        const abi = await numberStorageInterface();

        expect(
            await isChainProven(new Contract(address, abi, provider))
        ).to.equal(false);
        expect(
            await isChainProven(new Contract(address, abi, node.provider))
        ).to.equal(false);
        const chain = connectLocalDiamond(address, provider);
        const localDiamond = connectLocalDiamond(address, node.provider);
        expect(await replicatedStateSource(localDiamond, chain)).to.equal(
            localDiamond
        );
    });

    it("says a contract's reads are proven while the serving endpoint lists the light client endpoints, and not once it fails over to one that does not", async function () {
        fixture = await LightClientProviderFixture.start({ endpoints: 2 });
        const { node, provider, proxies } = fixture;
        const [first, second] = proxies;
        const { methods } = (await node.provider.send("rpc_methods", [])) as {
            methods: string[];
        };
        second.answerRequests("rpc_methods", {
            methods: methods.filter(
                (method) => !method.startsWith("lightClient_")
            )
        });
        const contract = new Contract(
            await fixture.deployNumberStorage(),
            await numberStorageInterface(),
            provider
        );
        expect(await isChainProven(contract)).to.equal(true);

        first.cut();
        await waitFor(() => !provider.nodes[0].isConnected);

        expect(await isChainProven(contract)).to.equal(false);
        first.restore();
    });

    it("says a contract's reads are not proven, without throwing, while no endpoint is connected", async function () {
        fixture = await LightClientProviderFixture.start();
        const { provider, proxy } = fixture;
        const contract = new Contract(
            await fixture.deployNumberStorage(),
            await numberStorageInterface(),
            provider
        );
        expect(await isChainProven(contract)).to.equal(true);

        proxy.cut();
        await waitFor(() => !provider.nodes[0].isConnected);

        expect(await isChainProven(contract)).to.equal(false);
        proxy.restore();
    });
});
