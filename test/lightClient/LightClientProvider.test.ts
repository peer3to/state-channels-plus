// @distributed-requires: lightClient
import LightClientRpcProvider from "@/evm/p2pRuntime/rpcNodes/LightClientRpcProvider";
import { createRpcNodesProvider } from "@/index";
import {
    BLOCK_VALUES_CONTRACT,
    PREVIOUS_BLOCK_HASH_CONTRACT,
    STATIC_FORWARDER_CONTRACT
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { recordingLogger } from "@test/fixtures/node/RpcNodesFixture";
import { expect } from "chai";
import {
    AbiCoder,
    concat,
    Contract,
    sha256,
    toBeHex,
    zeroPadValue
} from "ethers";
import { ethers } from "hardhat";

const NO_FALLBACK = { leftToNodes: 0, failed: 0, unsupported: 0 };
const XCM_PRECOMPILE = "0x0000000000000000000000000000000000000800";
const FAILED_READ = "Light client failed a read; asking the nodes";

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
            answeredLocally: 1,
            ...NO_FALLBACK
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
            answeredLocally: 1,
            ...NO_FALLBACK
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
            answeredLocally: 1,
            ...NO_FALLBACK
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
            answeredLocally: 1,
            ...NO_FALLBACK
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
            answeredLocally: 1,
            ...NO_FALLBACK
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
            answeredLocally: 8,
            ...NO_FALLBACK
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
            answeredLocally: 3,
            ...NO_FALLBACK
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
            answeredLocally: 4,
            ...NO_FALLBACK
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
            answeredLocally: 5,
            ...NO_FALLBACK
        });
        expect(fixture.forwardedReadCount()).to.equal(0);
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
            answeredLocally: 0,
            ...NO_FALLBACK
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
            answeredLocally: 0,
            leftToNodes: 1,
            failed: 0,
            unsupported: 0
        });

        const blockHash = await provider.call({ to: blockHashReader });
        expect(blockHash).to.match(/^0x[0-9a-f]{64}$/);
        expect(blockHash).to.not.equal(toBeHex(0n, 32));
        expect(provider.lightClientCounters).to.deep.equal({
            answeredLocally: 0,
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
            answeredLocally: 0,
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
            answeredLocally: 2,
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
            answeredLocally: 0,
            leftToNodes: 0,
            failed: 1,
            unsupported: 0
        });
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
        expect(fixture.loggedErrors()[0].meta[0].reason).to.equal(
            "read failed"
        );
        expect(await provider.getStorage(address, 0)).to.equal(toBeHex(5n, 32));
        expect(provider.lightClientCounters.answeredLocally).to.equal(1);
    });

    it("asks the node for every read and logs one error when the node lists no light client endpoints", async function () {
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
            answeredLocally: 0,
            leftToNodes: 0,
            failed: 0,
            unsupported: 2
        });
        expect(fixture.forwardedReadCount()).to.equal(2);
        expect(proxy.forwardedCount("rpc_methods")).to.equal(1);
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(0);
        expect(fixture.loggedErrorMessages()).to.deep.equal([
            "RPC node doesn't support LC endpoints; it answers the chain reads itself"
        ]);
    });

    it("is the plain provider unless the light client is switched on", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, proxy } = fixture;
        const abi = await numberStorageInterface();
        const address = await fixture.deployNumberStorage();
        await node.transact(address, abi.encodeFunctionData("setValue", [3n]));
        const { logger } = recordingLogger("error");
        const plain = await createRpcNodesProvider(
            { PROVIDER_URL: proxy.url },
            logger
        );

        try {
            expect(plain).to.not.be.instanceOf(LightClientRpcProvider);
            expect(await plain.getStorage(address, 0)).to.equal(
                toBeHex(3n, 32)
            );
            expect(proxy.forwardedCount("eth_getStorageAt")).to.equal(1);
            expect(proxy.forwardedCount("rpc_methods")).to.equal(0);
        } finally {
            plain.destroy();
            logger.dispose();
        }
    });
});
