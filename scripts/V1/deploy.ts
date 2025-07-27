import {
    ContractFactory,
    Signer,
    Contract,
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

export async function deployLocalFromTx<T extends Contract>(
    tx: ContractDeployTransaction,
    signer: Signer
): Promise<{ address: string; contract?: T }> {
    if (!signer) throw new Error("Signer required for deployment");
    const sentTx = await signer.sendTransaction(tx);
    const address = getCreateAddress({
        from: sentTx.from!,
        nonce: sentTx.nonce
    });

    return { address };
}

async function deployArtifact<T>(
    artifact: any,
    signer: Signer,
    libs: Record<string, string> = {},
    args: any[] = []
): Promise<{ address: string; contract: T }> {
    const factory = new ContractFactory(
        artifact.abi,
        artifact.bytecode,
        signer
    );
    const libraries = { libraries: libs };
    console.log(libraries);

    const contract = await factory.deploy(...args, libraries);
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
    let addresses: string[] = [];
    console.log(libs);

    for (const artifact of artifacts) {
        console.log(artifact.contractName);
        const { address } = await deployArtifact(artifact, signer, libs);
        console.log(address);
        addresses.push(address);
    }

    return addresses;
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

    return deployArtifact<AStateChannelManagerProxy>(
        AStateChannelManagerProxyArtifact,
        signer,
        {},
        [stateMachineAddress, ...facetAddresses, consumerFacetAddress]
    );
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

    const { address: stateMachineAddress } = await deployLocalFromTx(
        stateMachineTx,
        signer
    );

    return deployArtifact<LocalDiamond>(LocalDiamondArtifact, signer, {}, [
        stateMachineAddress,
        ...facetAddresses
    ]);
}
