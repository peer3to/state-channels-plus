import { expect } from "chai";
import { ethers } from "hardhat";
import { EVM } from "@ethereumjs/evm";
import EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import { Interface } from "ethers";

describe("EvmDiamondStateMachine", function () {
    let evm: EVM;
    let mathStateMachineDeployTx: any;
    let contractInterface: Interface;

    beforeEach(async function () {
        evm = await EVM.create();

        const MathStateMachine =
            await ethers.getContractFactory("MathStateMachine");
        mathStateMachineDeployTx =
            await MathStateMachine.getDeployTransaction(5000000);
        contractInterface = MathStateMachine.interface;
    });

    describe("Dual Deployment Issue", function () {
        it("should deploy state machine twice resulting in different addresses", async function () {
            const firstDeploymentResult = await evm.runCall({
                data: ethers.getBytes(mathStateMachineDeployTx.data)
            });

            const secondDeploymentResult = await evm.runCall({
                data: ethers.getBytes(mathStateMachineDeployTx.data)
            });

            // Verify both deployments succeeded
            expect(firstDeploymentResult.execResult.exceptionError).to.be
                .undefined;
            expect(secondDeploymentResult.execResult.exceptionError).to.be
                .undefined;
            expect(firstDeploymentResult.createdAddress).to.not.be.undefined;
            expect(secondDeploymentResult.createdAddress).to.not.be.undefined;

            expect(
                firstDeploymentResult.createdAddress!.equals(
                    secondDeploymentResult.createdAddress!
                )
            ).to.be.false;
        });
    });

    describe("createStandalone", function () {
        it("should successfully create a standalone EvmDiamondStateMachine", async function () {
            const evmDiamondStateMachine =
                await EvmDiamondStateMachine.createStandalone(
                    mathStateMachineDeployTx,
                    contractInterface
                );

            expect(evmDiamondStateMachine).to.be.instanceOf(
                EvmDiamondStateMachine
            );
            expect(evmDiamondStateMachine.contractInterface).to.equal(
                contractInterface
            );
            expect(evmDiamondStateMachine.diamondExecuter).to.not.be.undefined;
        });
    });
});
