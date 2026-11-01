import {
    isNodeOnlyAddress,
    isPolkaVmCode
} from "@/evm/p2pRuntime/rpcNodes/mirror/LocalExecutionPolicy";
import {
    callerRuntime,
    nodeRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import { deployRuntimeCode } from "@test/fixtures/node/StorageDiffService.fixture";
import { expect } from "chai";
import { getBytes, zeroPadValue } from "ethers";
import path from "node:path";

const CUSTOM_ADDRESS = "0x00000000000000000000000000000000000000f0";
const CUSTOM_CALLDATA = "0x1234";
const PVM_RUNTIME = "50564d0000";

function address(hex: string): Uint8Array {
    return getBytes(zeroPadValue(hex, 20));
}

const CUSTOM_PRECOMPILE = {
    address: CUSTOM_ADDRESS,
    module: path.join(__dirname, "../fixtures/workerAnswerPrecompile.ts"),
    options: { expectedData: CUSTOM_CALLDATA, value: "7" }
};

describe("Mirror local execution", function () {
    it("recognises PolkaVM program blobs by their magic and nothing else", function () {
        expect(isPolkaVmCode(getBytes("0x50564d00"))).to.equal(true);
        expect(isPolkaVmCode(getBytes("0x50564d0000"))).to.equal(true);
        expect(isPolkaVmCode(getBytes("0x50564d01"))).to.equal(false);
        expect(isPolkaVmCode(getBytes("0x6080604052"))).to.equal(false);
        expect(isPolkaVmCode(getBytes("0x"))).to.equal(false);
    });

    it("sends the chain's builtin and external precompile ranges to the node and runs the standard ones locally", function () {
        // pallet-revive: standard precompiles 0x01-0x09 run locally; 0x0a is not implemented there
        for (const standard of ["0x01", "0x02", "0x05", "0x09"])
            expect(isNodeOnlyAddress(address(standard)), standard).to.equal(
                false
            );
        for (const builtin of [
            "0x0a",
            "0x0b",
            "0x0100",
            "0x0900",
            "0x0901",
            "0xffff"
        ])
            expect(isNodeOnlyAddress(address(builtin)), builtin).to.equal(true);
        // external: a nonzero 16-bit number in bytes 16-17, with free bytes 0-3 (the ERC20 asset ranges)
        expect(
            isNodeOnlyAddress(
                getBytes("0x0000000c" + "00".repeat(12) + "01200000")
            )
        ).to.equal(true);
        expect(
            isNodeOnlyAddress(
                getBytes("0xffffffff" + "00".repeat(12) + "03200000")
            )
        ).to.equal(true);
        expect(isNodeOnlyAddress(address("0x00"))).to.equal(false);
        expect(isNodeOnlyAddress(address("0x010001"))).to.equal(false);
        expect(
            isNodeOnlyAddress(
                getBytes("0x5fbdb2315678afecb367f032d93f642f64180aa3")
            )
        ).to.equal(false);
    });

    it("sends a call to PolkaVM code to the node whole", async function () {
        await withMirrorSession(async (session) => {
            const pvm = await deployRuntimeCode(session.signer, PVM_RUNTIME);
            const asked = nodeRequests(session, "eth_call").length;

            await session.provider.call({ to: pvm }).catch(() => undefined);

            expect(nodeRequests(session, "eth_call")).to.have.length(asked + 1);
        });
    });

    it("still answers eth_getCode of PolkaVM code and runs the registered precompile that stands in for it", async function () {
        await withMirrorSession(
            async (session) => {
                const pvm = await deployRuntimeCode(
                    session.signer,
                    PVM_RUNTIME
                );
                await session.chain.send("anvil_setCode", [
                    CUSTOM_ADDRESS,
                    "0x" + PVM_RUNTIME
                ]);
                const asked = nodeRequests(session, "eth_call").length;

                const code = await session.provider.getCode(pvm);
                const answer = await session.provider.call({
                    to: CUSTOM_ADDRESS,
                    data: CUSTOM_CALLDATA
                });

                expect(code).to.equal("0x" + PVM_RUNTIME);
                expect(BigInt(answer.slice(0, 66))).to.equal(7n);
                expect(nodeRequests(session, "eth_call")).to.have.length(asked);
                expect(nodeRequests(session, "eth_getCode")).to.have.length(0);
            },
            { customPrecompiles: [CUSTOM_PRECOMPILE] }
        );
    });

    it("sends a call that reaches a chain precompile the local EVM does not reproduce to the node whole", async function () {
        await withMirrorSession(async (session) => {
            const caller = await deployRuntimeCode(
                session.signer,
                callerRuntime("0x" + "00".repeat(18) + "0100")
            );
            const asked = nodeRequests(session, "eth_call").length;

            const answer = await session.provider.call({ to: caller });

            expect(answer).to.equal(await session.chain.call({ to: caller }));
            expect(nodeRequests(session, "eth_call")).to.have.length(asked + 1);
        });
    });

    it("runs a call that reaches a standard precompile locally", async function () {
        await withMirrorSession(async (session) => {
            const caller = await deployRuntimeCode(
                session.signer,
                callerRuntime("0x" + "00".repeat(19) + "02")
            );
            const sha = { to: "0x" + "00".repeat(19) + "02", data: "0x1234" };
            const asked = nodeRequests(session, "eth_call").length;

            const nested = await session.provider.call({ to: caller });
            const direct = await session.provider.call(sha);

            expect(nested).to.equal(await session.chain.call({ to: caller }));
            expect(direct).to.equal(await session.chain.call(sha));
            expect(nodeRequests(session, "eth_call")).to.have.length(asked);
        });
    });

    it("sends a direct call to the point evaluation address to the node", async function () {
        await withMirrorSession(async (session) => {
            const asked = nodeRequests(session, "eth_call").length;

            await session.provider
                .call({ to: "0x" + "00".repeat(19) + "0a", data: "0x" })
                .catch(() => undefined);

            expect(nodeRequests(session, "eth_call")).to.have.length(asked + 1);
        });
    });
});
