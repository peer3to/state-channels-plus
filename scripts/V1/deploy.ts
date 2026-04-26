import {
    ContractFactory,
    Signer,
    ContractDeployTransaction,
    Wallet,
    ethers
} from "ethers";
import { EVM } from "@ethereumjs/evm";

import DisputeVerificationFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol/DisputeVerificationFacet.json";
import DisputeManagerFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol/DisputeManagerFacet.json";
import FraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol/FraudProofFacet.json";
import DisputeFraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol/DisputeFraudProofFacet.json";
import StateSnapshotFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol/StateSnapshotFacet.json";
import JoinChannelFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol/JoinChannelFacet.json";
import StateProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol/StateProofFacet.json";
import StateChannelManagerProxyArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol/StateChannelManagerProxy.json";
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";
import UtilityFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol/UtilityFacet.json";

import { StateChannelManagerProxy } from "@typechain-types/index";
import { Artifact } from "hardhat/types";
import { Address } from "@ethereumjs/util";
import { config } from "@/utils/config";

const facetArtifacts = [
    DisputeManagerFacetArtifact,
    DisputeVerificationFacetArtifact,
    FraudProofFacetArtifact,
    DisputeFraudProofFacetArtifact,
    StateSnapshotFacetArtifact,
    JoinChannelFacetArtifact,
    StateProofFacetArtifact,
    UtilityFacetArtifact
];

export type DeploymentResult = {
    address: Address;
    signer: Signer;
};

export type LocalStateMachineDeployer = (
    evm: EVM,
    signer: Signer
) => Promise<Address>;

function logDeployed(
    address: string,
    params: {
        contractName?: string;
        gasUsed?: bigint;
    }
): void {
    const name = params.contractName ?? "<unknown-contract>";
    if (params.gasUsed != null) {
        if (!config.DEBUG_LOCAL_TRANSPORT)
            console.log(
                `Deployed ${name} at ${address} gasUsed=${params.gasUsed.toString()}`
            );
        return;
    }
    if (!config.DEBUG_LOCAL_TRANSPORT)
        console.log(`Deployed ${name} at ${address}`);
}

export async function deployArtifact<T>(
    artifact: Artifact,
    signer: Signer,
    options?: {
        libs?: Record<string, string>;
        args?: any[];
    }
): Promise<{ address: string; contract: T }> {
    const linkedArtifact = linkLibraries(artifact, options?.libs || {});

    const factory = new ContractFactory(artifact.abi, linkedArtifact.bytecode);
    const deployTx = await factory.getDeployTransaction(
        ...(options?.args || [])
    );

    const sentTx = await signer.sendTransaction(deployTx);
    const receipt = await sentTx.wait();

    const address = receipt?.contractAddress;
    if (!address) {
        throw new Error(
            `Deployment failed: missing contractAddress in receipt for ${artifact.contractName}`
        );
    }
    logDeployed(address, {
        contractName: artifact.contractName,
        gasUsed: receipt.gasUsed
    });
    const contract = new ethers.Contract(address, artifact.abi, signer as any);
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

export async function deployFacets(
    signer: Signer,
    libs: Record<string, string> = {}
): Promise<string[]> {
    return Promise.all(
        facetArtifacts.map((artifact) =>
            deployArtifact(artifact, signer, { libs }).then(
                ({ address }) => address
            )
        )
    );
}

export async function deployFacetsLocal(
    evm: EVM,
    signer: Signer,
    libs: Record<string, string> = {}
): Promise<string[]> {
    return Promise.all(
        facetArtifacts.map((artifact) =>
            deployArtifactLocal(artifact, evm, signer, { libs }).then((a) =>
                a.toString()
            )
        )
    );
}

export type TimeConfig = {
    p2pTime?: number;
    agreementTime?: number;
    chainFallbackTime?: number;
    evidenceTime?: number;
};

export function getTimeConfig(overrides?: TimeConfig): TimeConfig {
    return {
        p2pTime: overrides?.p2pTime ?? 0,
        agreementTime: overrides?.agreementTime ?? 0,
        chainFallbackTime: overrides?.chainFallbackTime ?? 0,
        evidenceTime: overrides?.evidenceTime ?? 0
    };
}

export type DeployFullStackParams = {
    stateMachineArtifact: Artifact;
    consumerFacetArtifact: Artifact;
    stateMachineArgs?: any[];
    consumerFacetArgs?: any[];
    timeConfig?: TimeConfig;
};

export async function deploy(
    stateMachineAddress: string,
    consumerFacetAddress: string,
    signer: Signer,
    timeConfigOverrides?: TimeConfig
): Promise<{ address: string; contract: StateChannelManagerProxy }> {
    const facetAddresses = await deployFacets(signer);
    const timeConfig = getTimeConfig(timeConfigOverrides);
    return await deployArtifact<StateChannelManagerProxy>(
        StateChannelManagerProxyArtifact,
        signer,
        {
            args: [
                stateMachineAddress,
                ...facetAddresses,
                consumerFacetAddress,
                timeConfig.p2pTime,
                timeConfig.agreementTime,
                timeConfig.chainFallbackTime,
                timeConfig.evidenceTime
            ]
        }
    );
}

export async function deployFullStack(
    signer: Signer,
    params: DeployFullStackParams
): Promise<{ address: string; contract: StateChannelManagerProxy }> {
    const {
        stateMachineArtifact,
        consumerFacetArtifact,
        stateMachineArgs,
        consumerFacetArgs,
        timeConfig
    } = params;

    const stateMachinePromise = deployArtifact(stateMachineArtifact, signer, {
        args: stateMachineArgs
    });

    const consumerFacetPromise = deployArtifact(consumerFacetArtifact, signer, {
        args: consumerFacetArgs
    });

    const { address: stateMachineAddress } = await stateMachinePromise;
    const { address: consumerFacetAddress } = await consumerFacetPromise;

    return deploy(
        stateMachineAddress,
        consumerFacetAddress,
        signer,
        timeConfig
    );
}

export function createLocalDeployerFromTx(
    tx: ContractDeployTransaction
): LocalStateMachineDeployer {
    return async (evm: EVM, _signer: Signer) => deployLocalFromTx(tx, evm);
}

export async function deployLocalDiamond(
    stateMachineDeployment:
        | ContractDeployTransaction
        | LocalStateMachineDeployer,
    evm: EVM,
    signer?: Signer,
    timeConfigOverrides?: TimeConfig
): Promise<DeploymentResult> {
    const usedSigner = signer || Wallet.createRandom();

    const deployStateMachine =
        typeof stateMachineDeployment === "function"
            ? stateMachineDeployment
            : createLocalDeployerFromTx(stateMachineDeployment);

    const facetAddresses = await deployFacetsLocal(evm, usedSigner);

    const stateMachineAddress = (
        await deployStateMachine(evm, usedSigner)
    ).toString();

    const timeConfig = getTimeConfig(timeConfigOverrides);

    const diamondAddress = await deployArtifactLocal(
        LocalDiamondArtifact,
        evm,
        usedSigner,
        {
            args: [
                stateMachineAddress,
                ...facetAddresses,
                timeConfig.p2pTime,
                timeConfig.agreementTime,
                timeConfig.chainFallbackTime,
                timeConfig.evidenceTime
            ]
        }
    );

    return { address: diamondAddress, signer: usedSigner };
}

// Counter for unique deployments
let deploymentCounter = 0;

export async function deployLocalFromTx(
    tx: ContractDeployTransaction,
    evm: EVM
): Promise<Address> {
    // Create a deterministic but unique caller address for each deployment
    const counterHex = deploymentCounter.toString(16).padStart(8, "0");
    const caller = Address.fromString(`0x${"0".repeat(32)}${counterHex}`);
    deploymentCounter++;

    const deploymentResult = await evm.runCall({
        data: ethers.getBytes(tx.data as string),
        caller: caller,
        origin: caller
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
