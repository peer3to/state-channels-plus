// @distributed-requires: lightClient
import { TRANSIENT_STORAGE_CONTRACT } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { expect } from "chai";
import { Contract, toBeHex, Wallet, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

/** Enough for the probe's deployment and for a list of 300 slots. */
const LARGE_GAS = 9_000_000n;
const FAILED_READ = "Light client failed a read; asking the nodes";
/** Slots of the probe's list that `sumOf` reads, none depending on another. */
const INDEPENDENT_SLOTS = [0n, 1n, 2n, 3n];

/** How many keys each proof request the provider sent asked for, in order, from `from` on. */
function proofKeyCounts(fixture: LightClientProviderFixture, from: number) {
    return fixture.proxy.forwardedRequests
        .slice(from)
        .filter(({ method }) => method === "state_getReadProof")
        .map(({ params }) => (params as [string[]])[0].length);
}

describe("Light client local runs", function () {
    let fixture: LightClientProviderFixture | undefined;

    afterEach(async function () {
        await fixture?.stop();
        fixture = undefined;
    });

    it("keeps nothing a reverted sub-call wrote, as the node runs it", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const factory = await ethers.getContractFactory("LightClientProbe");
        const address = await node.deploy(factory.bytecode, LARGE_GAS);
        await node.transact(
            address,
            factory.interface.encodeFunctionData("setValue", [5n])
        );
        const local = new Contract(address, factory.interface, provider);
        const remote = new Contract(address, factory.interface, node.provider);

        expect(await local.valueAfterRevertedWrite.staticCall(9n)).to.equal(
            await remote.valueAfterRevertedWrite.staticCall(9n)
        );
        expect(await local.value()).to.equal(5n);
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 2,
            leftToNodes: 0,
            failed: 0
        });
    });

    it("leaves a call that carries value to the node, which keeps its existential deposit back from a new account", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const factory = await ethers.getContractFactory("LightClientProbe");
        const address = await node.deploy(factory.bytecode, LARGE_GAS);
        const receiver = Wallet.createRandom().address;
        const call = {
            from: node.senderAddress,
            to: address,
            data: factory.interface.encodeFunctionData("forward", [receiver]),
            value: 1_000_000_000_000n
        };

        expect(await provider.call(call)).to.equal(
            await node.provider.call(call)
        );
        expect(await provider.getBalance(receiver)).to.equal(0n);
        expect(provider.lightClientCounters).to.deep.include({
            leftToNodes: 1,
            withFallbackRead: 1,
            failed: 0
        });
        expect(fixture.forwardedCount("eth_call")).to.equal(1);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("clears transient storage between calls", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const probe = await node.deploy(TRANSIENT_STORAGE_CONTRACT);
        const store = { to: probe, data: toBeHex(7, 32) };
        const load = { to: probe, data: "0x" };

        expect(await provider.call(store)).to.equal(toBeHex(7, 32));
        expect(await node.provider.call(store)).to.equal(toBeHex(7, 32));
        expect(await provider.call(load)).to.equal(toBeHex(0, 32));
        expect(await node.provider.call(load)).to.equal(toBeHex(0, 32));
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 2,
            failed: 0
        });
    });

    it("runs a contract the call created, also after a sub-call reverted", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const factory = await ethers.getContractFactory("LightClientProbe");
        const address = await node.deploy(factory.bytecode, LARGE_GAS);
        const local = new Contract(address, factory.interface, provider);
        const remote = new Contract(address, factory.interface, node.provider);

        expect(await local.createThenRevertInside.staticCall()).to.equal(42n);
        expect(await remote.createThenRevertInside.staticCall()).to.equal(42n);
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 1,
            leftToNodes: 0,
            failed: 0
        });
    });

    it("leaves no code where a frame that reverted created a contract", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const factory = await ethers.getContractFactory("LightClientProbe");
        const address = await node.deploy(factory.bytecode, LARGE_GAS);
        const local = new Contract(address, factory.interface, provider);
        const remote = new Contract(address, factory.interface, node.provider);
        const salt = toBeHex(7, 32);

        expect(
            await local.codeSizeAfterRevertedCreate.staticCall(salt)
        ).to.equal(0n);
        expect(
            await remote.codeSizeAfterRevertedCreate.staticCall(salt)
        ).to.equal(0n);
        expect(provider.lightClientCounters.failed).to.equal(0);
    });

    it("refuses code over the size limit and runs only the precompiles the chain serves, as the node does", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const factory = await ethers.getContractFactory("LightClientProbe");
        const address = await node.deploy(factory.bytecode, LARGE_GAS);
        const local = new Contract(address, factory.interface, provider);
        const remote = new Contract(address, factory.interface, node.provider);

        expect(await local.createOverSizeLimit.staticCall()).to.equal(
            ZeroAddress
        );
        expect(await remote.createOverSizeLimit.staticCall()).to.equal(
            ZeroAddress
        );
        // ecrecover is served; KZG point evaluation, BLS12-381 G1 addition,
        // P-256 verification and the console are plain accounts on the chain
        for (const target of [
            "0x0000000000000000000000000000000000000001",
            "0x000000000000000000000000000000000000000a",
            "0x000000000000000000000000000000000000000b",
            "0x0000000000000000000000000000000000000100",
            "0x000000000000000000636F6e736F6c652e6c6f67"
        ])
            expect(
                [...(await local.callWithoutInput.staticCall(target))],
                target
            ).to.deep.equal([
                ...(await remote.callWithoutInput.staticCall(target))
            ]);
        expect(provider.lightClientCounters).to.deep.include({
            leftToNodes: 0,
            failed: 0
        });
    });

    it("gives up a read that keeps finding state missing, asks the node and logs it", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const factory = await ethers.getContractFactory("LightClientProbe");
        const long = await node.deploy(factory.bytecode, LARGE_GAS);
        const short = await node.deploy(factory.bytecode, LARGE_GAS);
        // each slot of the list names the next: one more pass per slot
        await node.transact(
            long,
            factory.interface.encodeFunctionData("link", [300n]),
            LARGE_GAS
        );
        await node.transact(
            short,
            factory.interface.encodeFunctionData("link", [10n]),
            LARGE_GAS
        );

        expect(
            await new Contract(long, factory.interface, provider).walk()
        ).to.equal(300n);
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 0,
            failed: 1
        });
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
        expect(fixture.loggedErrors()[0].meta[0].reason).to.equal(
            "read failed"
        );
        expect(fixture.forwardedCount("eth_call")).to.equal(1);

        expect(
            await new Contract(short, factory.interface, provider).walk()
        ).to.equal(10n);
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 1,
            failed: 1
        });
        expect(fixture.forwardedCount("eth_call")).to.equal(1);
    });

    it("proves the slots a call needs, known together, in one request", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const factory = await ethers.getContractFactory("LightClientProbe");
        const address = await node.deploy(factory.bytecode, LARGE_GAS);
        await node.transact(
            address,
            factory.interface.encodeFunctionData("link", [8n])
        );
        const sent = fixture.proxy.forwardedRequests.length;

        expect(
            await new Contract(address, factory.interface, provider).sumOf(
                INDEPENDENT_SLOTS
            )
        ).to.equal(
            await new Contract(address, factory.interface, node.provider).sumOf(
                INDEPENDENT_SLOTS
            )
        );
        expect(proofKeyCounts(fixture, sent)).to.include(
            INDEPENDENT_SLOTS.length
        );
    });
});
