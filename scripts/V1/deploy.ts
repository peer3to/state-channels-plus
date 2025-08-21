import {
    ContractFactory,
    Signer,
    ContractDeployTransaction,
    Wallet,
    ethers
} from "ethers";
import { EVM } from "@ethereumjs/evm";

import StateChannelUtilLibraryArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelUtilLibrary.sol/StateChannelUtilLibrary.json";
import DisputeVerificationFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol/DisputeVerificationFacet.json";
import DisputeManagerFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol/DisputeManagerFacet.json";
import FraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol/FraudProofFacet.json";
import DisputeFraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol/DisputeFraudProofFacet.json";
import StateSnapshotFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol/StateSnapshotFacet.json";
import JoinChannelFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol/JoinChannelFacet.json";
import StateChannelManagerProxyArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol/StateChannelManagerProxy.json";
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";

import { StateChannelManagerProxy, LocalDiamond } from "@typechain-types/index";
import { Artifact } from "hardhat/types";
import { Address } from "@ethereumjs/util";

const facetArtifacts = [
    DisputeManagerFacetArtifact,
    DisputeVerificationFacetArtifact,
    FraudProofFacetArtifact,
    DisputeFraudProofFacetArtifact,
    StateSnapshotFacetArtifact,
    JoinChannelFacetArtifact
];

export type DeploymentResult = {
    address: Address;
    signer: Signer;
    localDiamond: LocalDiamond;
};

export async function deployArtifact<T>(
    artifact: Artifact,
    signer: Signer,
    options?: {
        libs?: Record<string, string>;
        args?: any[];
    }
): Promise<{ address: string; contract: T }> {
    const linkedArtifact = linkLibraries(artifact, options?.libs || {});
    const factory = new ContractFactory(
        artifact.abi,
        linkedArtifact.bytecode,
        signer
    );

    const contract = await factory.deploy(...(options?.args || []));
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    return { address, contract: contract as unknown as T };
}

async function deployArtifactLocal(
    artifact: Artifact,
    evm: EVM,
    signer: Signer,
    options?: {
        libs?: Record<string, string>;
        args?: any[];
    }
): Promise<Address> {
    const linkedArtifact = linkLibraries(artifact, options?.libs || {});
    const factory = new ContractFactory(
        artifact.abi,
        linkedArtifact.bytecode,
        signer
    );
    const deployTx = await factory.getDeployTransaction(
        ...(options?.args || [])
    );
    return deployLocalFromTx(deployTx, evm);
}

async function deployFacets(
    signer: Signer,
    libs: Record<string, string>
): Promise<string[]> {
    return Promise.all(
        facetArtifacts.map((artifact) =>
            deployArtifact(artifact, signer, { libs }).then(
                ({ address }) => address
            )
        )
    );
}

async function deployFacetsLocal(
    evm: EVM,
    signer: Signer,
    libs: Record<string, string>
): Promise<string[]> {
    return Promise.all(
        facetArtifacts.map((artifact) =>
            deployArtifactLocal(artifact, evm, signer, { libs }).then((a) =>
                a.toString()
            )
        )
    );
}

export async function deploy(
    stateMachineAddress: string,
    consumerFacetAddress: string,
    signer: Signer
): Promise<{ address: string; contract: StateChannelManagerProxy }> {
    const { address: libAddress } = await deployArtifact(
        StateChannelUtilLibraryArtifact,
        signer
    );

    const facetAddresses = await deployFacets(signer, {
        StateChannelUtilLibrary: libAddress
    });

    return deployArtifact<StateChannelManagerProxy>(
        StateChannelManagerProxyArtifact,
        signer,
        {
            args: [stateMachineAddress, ...facetAddresses, consumerFacetAddress]
        }
    );
}

export async function deployLocalDiamond(
    stateMachineTx: ContractDeployTransaction,
    evm: EVM,
    signer?: Signer
): Promise<DeploymentResult> {
    const usedSigner = signer || Wallet.createRandom();

    const libAddress = await deployArtifactLocal(
        StateChannelUtilLibraryArtifact,
        evm,
        usedSigner
    );

    const facetAddresses = await deployFacetsLocal(evm, usedSigner, {
        StateChannelUtilLibrary: libAddress.toString()
    });

    const stateMachineAddress = (
        await deployLocalFromTx(stateMachineTx, evm)
    ).toString();

    const diamondAddress = await deployArtifactLocal(
        LocalDiamondArtifact,
        evm,
        usedSigner,
        {
            args: [stateMachineAddress, ...facetAddresses]
        }
    );

    const localDiamond = new ethers.Contract(
        diamondAddress.toString(),
        LocalDiamondArtifact.abi,
        usedSigner
    ) as unknown as LocalDiamond;

    return { address: diamondAddress, signer: usedSigner, localDiamond };
}

export async function deployLocalFromTx(
    tx: ContractDeployTransaction,
    evm: EVM
): Promise<Address> {
    const deploymentResult = await evm.runCall({
        data: ethers.getBytes(tx.data as string)
    });

    if (deploymentResult.execResult.exceptionError) {
        throw new Error(
            `Failed to deploy tx: ${JSON.stringify(
                deploymentResult.execResult.exceptionError
            )}`
        );
    }

    if (!deploymentResult.createdAddress) {
        throw new Error(`No contract address created for tx`);
    }

    return deploymentResult.createdAddress;
}

export function linkLibraries(
    artifact: Artifact,
    libs: Record<string, string>
): Artifact {
    let linkedBytecode = artifact.bytecode;

    // Iterate over each source path in linkReferences
    for (const sourcePath in artifact.linkReferences) {
        const libraries = artifact.linkReferences[sourcePath];

        // Iterate over each library name under the source path
        for (const libName in libraries) {
            const deployedAddress = libs[libName];
            if (!deployedAddress) {
                throw new Error(
                    `Missing deployed address for library '${libName}'`
                );
            }

            // Replace each occurrence using the exact byte positions
            for (const { start, length } of libraries[libName]) {
                const addressWithoutPrefix = deployedAddress
                    .toLowerCase()
                    .replace(/^0x/, "");
                linkedBytecode =
                    linkedBytecode.substring(0, 2 + start * 2) +
                    addressWithoutPrefix +
                    linkedBytecode.substring(2 + (start + length) * 2);
            }
        }
    }

    return { ...artifact, bytecode: linkedBytecode };
}
