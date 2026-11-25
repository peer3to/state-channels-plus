// @spec-test-coverage-ignore: shared deployment setup for real test sessions; executable evidence belongs to its calling test declarations
import type {
    HarnessDeploymentConfig,
    HarnessLocalStateMachineDeploymentParams
} from "./types";
import OpeningDataMathConsumerFacetArtifact from "../../../artifacts/contracts/test/OpeningDataMathConsumerFacet.sol/OpeningDataMathConsumerFacet.json";
import MathConsumerFacetArtifact from "../../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import MathStateMachineArtifact from "../../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";

import {
    deployFullStack,
    DEFAULT_MAX_CHANNEL_PARTICIPANTS
} from "../../../scripts/V1/deploy";
import type { MathStateMachine } from "@typechain-types";
import { MathStateMachine__factory } from "@typechain-types";
import { ContractFactory, Signer } from "ethers";
import type { Artifact } from "hardhat/types";

function mathOnChainDeployer(
    consumerFacetArtifact: Artifact
): HarnessDeploymentConfig<MathStateMachine>["deployOnChainContracts"] {
    return async (params) => {
        const deployment = await deployFullStack(params.signer, {
            stateMachineArtifact: MathStateMachineArtifact,
            consumerFacetArtifact,
            stateMachineArgs: [
                params.stateMachineGasLimit,
                params.maxChannelParticipants ??
                    DEFAULT_MAX_CHANNEL_PARTICIPANTS
            ],
            maxChannelParticipants: params.maxChannelParticipants,
            consumerFacetArgs: [],
            timeConfig: params.timeConfig,
            disputeExecutionGasLimit: params.disputeExecutionGasLimit,
            facetAddresses: params.facetAddresses
        });

        return deployment.address;
    };
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
            params.stateMachineGasLimit,
            params.maxChannelParticipants ?? DEFAULT_MAX_CHANNEL_PARTICIPANTS
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
        deployOnChainContracts: mathOnChainDeployer(MathConsumerFacetArtifact),
        deployLocalStateMachine: deployDefaultMathLocalStateMachine,
        connectSigner: connectDefaultMathSigner
    };

/** Math with a consumer whose genesis folds in the opening data. */
export const OPENING_DATA_MATH_HARNESS_DEPLOYMENT: HarnessDeploymentConfig<MathStateMachine> =
    {
        ...DEFAULT_MATH_HARNESS_DEPLOYMENT,
        deployOnChainContracts: mathOnChainDeployer(
            OpeningDataMathConsumerFacetArtifact
        ),
        getDeploymentCacheKeyFragment: () => "opening-data-consumer"
    };
