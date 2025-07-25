import { ethers, ContractFactory, Signer } from "ethers";

import { AStateChannelManagerProxy } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy";

import StateChannelUtilLibraryArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelUtilLibrary.sol/StateChannelUtilLibrary.json";
import DisputeManagerFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol/DisputeManagerFacet.json";
import FraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol/FraudProofFacet.json";
import DisputeFraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol/DisputeFraudProofFacet.json";
import StateSnapshotFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol/StateSnapshotFacet.json";
import JoinChannelFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol/JoinChannelFacet.json";
import AStateChannelManagerProxyArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol/AStateChannelManagerProxy.json";
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";
import { EVM } from "@ethereumjs/evm";

enum DeploymentMode {
    LOCAL = "LOCAL",
    NETWORK = "NETWORK"
}

type DeploymentContext = {
    mode: DeploymentMode;
    signer?: Signer;
    evm?: EVM;
};

function linkBytecode(bytecode: string, libraryAddress: string): string {
    const placeholder = /__\$[a-f0-9]{34}\$__/g;
    return bytecode.replace(placeholder, libraryAddress.slice(2)); // Remove 0x prefix
}

async function deployLocal(bytecode: string, evm: EVM): Promise<string> {
    const result = await evm.runCall({
        data: ethers.getBytes(bytecode)
    });

    if (result.execResult.exceptionError) {
        throw new Error(
            `Failed to deploy in EVM ${result.execResult.exceptionError.error}`
        );
    }

    if (!result.createdAddress) {
        throw new Error(`Facet returned no address`);
    }

    return result.createdAddress.toString();
}

async function deployStateChannelUtilLibrary(
    context: DeploymentContext
): Promise<string> {
    if (context.mode === DeploymentMode.LOCAL) {
        if (!context.evm) {
            throw new Error("EVM instance required for local deployment");
        }
        return deployLocal(
            StateChannelUtilLibraryArtifact.bytecode,
            context.evm
        );
    }

    if (!context.signer) {
        throw new Error("Signer required for network deployment");
    }

    const StateChannelUtilLibraryFactory = new ContractFactory(
        StateChannelUtilLibraryArtifact.abi,
        StateChannelUtilLibraryArtifact.bytecode,
        context.signer
    );
    const stateChannelUtilLibrary =
        await StateChannelUtilLibraryFactory.deploy().then((contract) =>
            contract.waitForDeployment()
        );

    return stateChannelUtilLibrary.getAddress();
}

async function deployFacet(
    artifact: any,
    libraryAddress: string,
    context: DeploymentContext
): Promise<string> {
    const linkedBytecode = linkBytecode(artifact.bytecode, libraryAddress);

    if (context.mode === DeploymentMode.LOCAL) {
        if (!context.evm) {
            throw new Error("EVM instance required for local deployment");
        }
        return await deployLocal(linkedBytecode, context.evm);
    }

    if (!context.signer) {
        throw new Error("Signer required for network deployment");
    }

    const factory = new ContractFactory(
        artifact.abi,
        linkedBytecode,
        context.signer
    );
    const contract = await factory
        .deploy()
        .then((contract) => contract.waitForDeployment());
    return contract.getAddress();
}

async function deployAllFacets(
    libraryAddress: string,
    context: DeploymentContext
) {
    const facetArtifacts = [
        DisputeManagerFacetArtifact,
        FraudProofFacetArtifact,
        DisputeFraudProofFacetArtifact,
        StateSnapshotFacetArtifact,
        JoinChannelFacetArtifact
    ];

    const [
        disputeManagerFacet,
        fraudProofFacet,
        disputeFraudProofFacet,
        stateSnapshotFacet,
        joinChannelFacet
    ] = await Promise.all(
        facetArtifacts.map((artifact) =>
            deployFacet(artifact, libraryAddress, context)
        )
    );

    return {
        disputeManagerFacet,
        fraudProofFacet,
        disputeFraudProofFacet,
        stateSnapshotFacet,
        joinChannelFacet
    };
}

export async function deploy(
    stateMachineAddress: string,
    consumerFacetAddress: string,
    signer: Signer
): Promise<AStateChannelManagerProxy> {
    const context: DeploymentContext = {
        mode: DeploymentMode.NETWORK,
        signer
    };

    const stateChannelUtilLibrary =
        await deployStateChannelUtilLibrary(context);

    const facets = await deployAllFacets(stateChannelUtilLibrary, context);

    // Deploy AStateChannelManagerProxy with consumer facet
    const AStateChannelManagerProxyFactory = new ContractFactory(
        AStateChannelManagerProxyArtifact.abi,
        AStateChannelManagerProxyArtifact.bytecode,
        signer
    );
    const diamond = await AStateChannelManagerProxyFactory.deploy(
        stateMachineAddress,
        facets.disputeManagerFacet,
        facets.fraudProofFacet,
        facets.disputeFraudProofFacet,
        facets.stateSnapshotFacet,
        facets.joinChannelFacet,
        consumerFacetAddress
    );

    return diamond.waitForDeployment() as Promise<AStateChannelManagerProxy>;
}

export async function deployLocalDiamond(
    bytecode: string,
    evm: EVM
): Promise<string> {
    const context: DeploymentContext = {
        mode: DeploymentMode.LOCAL,
        evm
    };

    const stateChannelUtilLibrary =
        await deployStateChannelUtilLibrary(context);

    const facets = await deployAllFacets(stateChannelUtilLibrary, context);

    const stateMachine = await deployLocal(bytecode, evm);

    const LocalDiamondFactory = new ContractFactory(
        LocalDiamondArtifact.abi,
        LocalDiamondArtifact.bytecode
    );

    const constructorArgs = [
        stateMachine,
        facets.disputeManagerFacet,
        facets.fraudProofFacet,
        facets.disputeFraudProofFacet,
        facets.stateSnapshotFacet,
        facets.joinChannelFacet
    ];

    const encodedConstructorArgs =
        LocalDiamondFactory.interface.encodeDeploy(constructorArgs);
    const deploymentData =
        LocalDiamondArtifact.bytecode + encodedConstructorArgs.slice(2); // Remove 0x prefix

    return deployLocal(deploymentData, evm);
}
