import { expect } from "chai";
import * as sinon from "sinon";
import hre from "hardhat";
import { MathStateMachine__factory } from "@typechain-types";

import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import {
    createLocalDeployerFromTx,
    deployFullStack
} from "../../scripts/V1/deploy";
import { PeerTestHarness } from "./PeerTestHarness";

describe("PeerTestHarness deployment overrides", () => {
    let harness: PeerTestHarness | undefined;

    afterEach(async () => {
        sinon.restore();
        await harness?.cleanup();
        harness = undefined;
    });

    it("uses custom deployment overrides during setup", async () => {
        const deployOnChainContracts = sinon.spy(
            async ({
                signer,
                stateMachineGasLimit,
                disputeExecutionGasLimit,
                timeConfig
            }) => {
                const deployment = await deployFullStack(signer, {
                    stateMachineArtifact: MathStateMachineArtifact,
                    consumerFacetArtifact: MathConsumerFacetArtifact,
                    stateMachineArgs: [stateMachineGasLimit],
                    consumerFacetArgs: [],
                    timeConfig,
                    disputeExecutionGasLimit
                });
                return deployment.address;
            }
        );

        const deployLocalStateMachine = sinon.spy(
            async ({ signer, stateMachineGasLimit, evm }) => {
                const stateMachineFactory =
                    await hre.ethers.getContractFactoryFromArtifact(
                        MathStateMachineArtifact,
                        signer
                    );
                const deployTx =
                    await stateMachineFactory.getDeployTransaction(
                        stateMachineGasLimit
                    );
                const deployLocalStateMachine =
                    createLocalDeployerFromTx(deployTx);
                const address = await deployLocalStateMachine(evm, signer);
                return address.toString();
            }
        );

        const connectSigner = sinon.spy((address: string, signer) =>
            MathStateMachine__factory.connect(address, signer)
        );

        harness = new PeerTestHarness({
            deployment: {
                deployOnChainContracts,
                deployLocalStateMachine,
                connectSigner
            }
        });

        await harness.setup(2, {
            logLevel: "error",
            disputeExecutionGasLimit: 12_000_000
        });

        expect(harness.peers).to.have.length(2);
        expect(await harness.channelManager.getGasLimit()).to.equal(
            12_000_000n
        );
        expect(deployOnChainContracts.callCount).to.equal(1);
        expect(deployLocalStateMachine.callCount).to.equal(4);
        expect(connectSigner.callCount).to.equal(2);
    });
});
