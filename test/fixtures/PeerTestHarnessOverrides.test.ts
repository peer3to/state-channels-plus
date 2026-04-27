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
            async ({ signer, gasLimit, timeConfig }) => {
                const deployment = await deployFullStack(signer, {
                    stateMachineArtifact: MathStateMachineArtifact,
                    consumerFacetArtifact: MathConsumerFacetArtifact,
                    stateMachineArgs: [gasLimit],
                    consumerFacetArgs: [],
                    timeConfig
                });
                return deployment.address;
            }
        );

        const deployLocalStateMachine = sinon.spy(
            async ({ signer, gasLimit, evm }) => {
                const stateMachineFactory =
                    await hre.ethers.getContractFactoryFromArtifact(
                        MathStateMachineArtifact,
                        signer
                    );
                const deployTx =
                    await stateMachineFactory.getDeployTransaction(gasLimit);
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
            logLevel: "error"
        });

        expect(harness.peers).to.have.length(2);
        expect(deployOnChainContracts.callCount).to.equal(1);
        expect(deployLocalStateMachine.callCount).to.equal(4);
        expect(connectSigner.callCount).to.equal(2);
    });
});
