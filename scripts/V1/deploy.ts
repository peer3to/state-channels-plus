import {
    ContractFactory,
    Signer,
    ContractDeployTransaction,
    getCreateAddress
} from "ethers";

import StateChannelUtilLibraryArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelUtilLibrary.sol/StateChannelUtilLibrary.json";
import DisputeManagerFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol/DisputeManagerFacet.json";
import FraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol/FraudProofFacet.json";
import DisputeFraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol/DisputeFraudProofFacet.json";
import StateSnapshotFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol/StateSnapshotFacet.json";
import JoinChannelFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol/JoinChannelFacet.json";
import AStateChannelManagerProxyArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol/AStateChannelManagerProxy.json";
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";

import {
    LocalDiamond,
    AStateChannelManagerProxy
} from "@typechain-types/index";
import { Artifact } from "hardhat/types";

export async function deployLocalFromTx(
    tx: ContractDeployTransaction,
    signer: Signer
): Promise<string> {
    if (!signer) throw new Error("Signer required for deployment");
    const sentTx = await signer.sendTransaction(tx);
    return getCreateAddress({
        from: sentTx.from!,
        nonce: sentTx.nonce
    });
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

export async function deployArtifact<T>(
    artifact: Artifact,
    signer: Signer,
    libs: Record<string, string> = {},
    args: any[] = []
): Promise<{ address: string; contract: T }> {
    const linkedArtifact = linkLibraries(artifact, libs);
    const factory = new ContractFactory(
        artifact.abi,
        linkedArtifact.bytecode,
        signer
    );

    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    return { address, contract: contract as unknown as T };
}

async function deployFacets(
    signer: Signer,
    libs: Record<string, string>
): Promise<string[]> {
    const artifacts = [
        DisputeManagerFacetArtifact,
        FraudProofFacetArtifact,
        DisputeFraudProofFacetArtifact,
        StateSnapshotFacetArtifact,
        JoinChannelFacetArtifact
    ];

    return Promise.all(
        artifacts.map((artifact) =>
            deployArtifact(artifact, signer, libs).then(
                ({ address }) => address
            )
        )
    );
}

export async function deploy(
    stateMachineAddress: string,
    consumerFacetAddress: string,
    signer: Signer
): Promise<{ address: string; contract: AStateChannelManagerProxy }> {
    const { address: libAddress } = await deployArtifact(
        StateChannelUtilLibraryArtifact,
        signer
    );

    const facetAddresses = await deployFacets(signer, {
        StateChannelUtilLibrary: libAddress
    });

    return deployArtifact(AStateChannelManagerProxyArtifact, signer, {}, [
        stateMachineAddress,
        ...facetAddresses,
        consumerFacetAddress
    ]);
}

export async function deployLocalDiamond(
    stateMachineTx: ContractDeployTransaction,
    signer: Signer
): Promise<{ address: string; contract: LocalDiamond }> {
    const { address: libAddress } = await deployArtifact(
        StateChannelUtilLibraryArtifact,
        signer
    );
    const facetAddresses = await deployFacets(signer, {
        StateChannelUtilLibrary: libAddress
    });

    const stateMachineAddress = await deployLocalFromTx(stateMachineTx, signer);

    return deployArtifact(LocalDiamondArtifact, signer, {}, [
        stateMachineAddress,
        ...facetAddresses
    ]);
}
