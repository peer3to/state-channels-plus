import MathStateMachineArtifact from "../../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import hre from "hardhat";
import { Signer } from "ethers";

import {
    createLocalDeployerFromTx,
    deployFullStack
} from "../../../scripts/V1/deploy";
import type { MathStateMachine } from "@typechain-types";
import { MathStateMachine__factory } from "@typechain-types";
import type {
    HarnessDeploymentConfig,
    HarnessLocalStateMachineDeploymentParams,
    HarnessOnChainContractsDeploymentParams
} from "./types";

export async function deployDefaultMathOnChainContracts(
    params: HarnessOnChainContractsDeploymentParams
): Promise<string> {
    const deployment = await deployFullStack(params.signer, {
        stateMachineArtifact: MathStateMachineArtifact,
        consumerFacetArtifact: MathConsumerFacetArtifact,
        stateMachineArgs: [params.gasLimit],
        consumerFacetArgs: [],
        timeConfig: params.timeConfig
    });

    return deployment.address;
}

export async function deployDefaultMathLocalStateMachine(
    params: HarnessLocalStateMachineDeploymentParams
): Promise<string> {
    const stateMachineFactory = await hre.ethers.getContractFactoryFromArtifact(
        MathStateMachineArtifact,
        params.signer
    );
    const deployTx = await stateMachineFactory.getDeployTransaction(
        params.gasLimit
    );
    const deployLocalStateMachine = createLocalDeployerFromTx(deployTx);
    const address = await deployLocalStateMachine(params.evm, params.signer);

    return address.toString();
}

export function connectDefaultMathSigner(
    address: string,
    signer: Signer
): MathStateMachine {
    return MathStateMachine__factory.connect(address, signer);
}

export const DEFAULT_MATH_HARNESS_DEPLOYMENT: HarnessDeploymentConfig<MathStateMachine> =
    {
        deployOnChainContracts: deployDefaultMathOnChainContracts,
        deployLocalStateMachine: deployDefaultMathLocalStateMachine,
        connectSigner: connectDefaultMathSigner
    };
