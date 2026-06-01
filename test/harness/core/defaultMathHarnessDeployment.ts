import MathStateMachineArtifact from "../../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { ContractFactory, Signer } from "ethers";

import { deployFullStack } from "../../../scripts/V1/deploy";
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
        stateMachineArgs: [params.stateMachineGasLimit],
        consumerFacetArgs: [],
        timeConfig: params.timeConfig,
        disputeExecutionGasLimit: params.disputeExecutionGasLimit
    });

    return deployment.address;
}

export async function deployDefaultMathLocalStateMachine(
    params: HarnessLocalStateMachineDeploymentParams
): Promise<string> {
    const stateMachineFactory = new ContractFactory(
        MathStateMachineArtifact.abi,
        MathStateMachineArtifact.bytecode,
        params.signer
    );
    const response = await params.signer.sendTransaction(
        await stateMachineFactory.getDeployTransaction(
            params.stateMachineGasLimit
        )
    );
    const receipt = await response.wait();
    if (!receipt?.contractAddress) {
        throw new Error("No local MathStateMachine contract address created");
    }

    return receipt.contractAddress;
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

export default DEFAULT_MATH_HARNESS_DEPLOYMENT;
