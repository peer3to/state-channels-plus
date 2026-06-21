import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "ethers";
import { Address } from "@ethereumjs/util";

import { CONSOLE_ADDRESS, createEvm, type EvmCustomPrecompile } from "@/evm";

function buildBlock() {
    const zeroAddress = Address.zero();

    return {
        header: {
            number: 0n,
            cliqueSigner: () => zeroAddress,
            coinbase: zeroAddress,
            timestamp: 0n,
            difficulty: 0n,
            prevRandao: new Uint8Array(32),
            gasLimit: 30_000_000n,
            baseFeePerGas: 0n,
            getBlobGasPrice: () => undefined
        }
    } as any;
}

describe("EvmFactory", function () {
    it("should execute custom precompiles without disabling the built-in console precompile", async function () {
        const consoleDebug = sinon.spy();
        const logger = {
            child: () => ({
                debug: consoleDebug
            })
        } as any;

        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000aa"
        );
        const expectedReturnValue = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [42n]
        );
        let customCallCount = 0;

        const customPrecompile: EvmCustomPrecompile = {
            address: customAddress,
            function: async () => {
                customCallCount++;
                return {
                    executionGasUsed: 0n,
                    returnValue: ethers.getBytes(expectedReturnValue)
                };
            }
        };

        const evm = await createEvm(
            {
                customPrecompiles: [customPrecompile]
            },
            logger
        );

        const customResult = await evm.runCall({
            to: customAddress,
            caller: Address.zero(),
            data: ethers.getBytes("0x1234"),
            block: buildBlock()
        });

        expect(customResult.execResult.exceptionError).to.equal(undefined);
        expect(ethers.hexlify(customResult.execResult.returnValue)).to.equal(
            expectedReturnValue
        );
        expect(customCallCount).to.equal(1);

        const consoleCallData = ethers.getBytes(
            `${ethers.id("log(string)").slice(0, 10)}${ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["hello from console precompile"]).slice(2)}`
        );

        const consoleResult = await evm.runCall({
            to: Address.fromString(CONSOLE_ADDRESS),
            caller: Address.zero(),
            data: consoleCallData,
            block: buildBlock()
        });

        expect(consoleResult.execResult.exceptionError).to.equal(undefined);
        expect(
            consoleDebug.calledWith("hello from console precompile")
        ).to.equal(true);
    });
});
