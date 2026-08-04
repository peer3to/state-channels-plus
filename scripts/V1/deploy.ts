import { ContractFactory, Signer, ethers } from "ethers";

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
import { config } from "@/utils/config";
import type { Address } from "@/types/types";

const DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT = 3_000_000;
const FACET_DEPLOY_GAS_LIMIT = 12_000_000;
const NONCE_GAP_RETRY_DELAY_MS = 10;
const NONCE_GAP_MAX_RETRIES = 500;

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

export type LocalStateMachineDeployer = (signer: Signer) => Promise<Address>;

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
        txOverrides?: ethers.TransactionRequest;
    }
): Promise<{ address: string; contract: T }> {
    const linkedArtifact = linkLibraries(artifact, options?.libs || {});

    const factory = new ContractFactory(artifact.abi, linkedArtifact.bytecode);
    const deployTx = await factory.getDeployTransaction(
        ...(options?.args || [])
    );
    const gasLimit =
        options?.txOverrides?.gasLimit ??
        ((await signer.estimateGas(deployTx)) * 12n) / 10n;

    const sentTx = await signer.sendTransaction({
        ...deployTx,
        gasLimit,
        ...options?.txOverrides
    });
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
    const response = await signer.sendTransaction(
        await factory.getDeployTransaction(...(options?.args || []))
    );
    const receipt = await response.wait();
    const address = receipt?.contractAddress;
    if (!address) {
        throw new Error(
            `Local deployment failed: missing contractAddress in receipt for ${artifact.contractName}`
        );
    }
    return address as Address;
}

export async function deployFacets(
    signer: Signer,
    libs: Record<string, string> = {}
): Promise<string[]> {
    const nextNonce = await signer.getNonce("pending");
    return Promise.all(
        facetArtifacts.map(async (artifact, index) => {
            for (let attempt = 0; ; attempt++) {
                try {
                    return (
                        await deployArtifact(artifact, signer, {
                            libs,
                            txOverrides: {
                                nonce: nextNonce + index,
                                gasLimit: FACET_DEPLOY_GAS_LIMIT
                            }
                        })
                    ).address;
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : String(error);
                    if (
                        !message.includes("Nonce too high") ||
                        attempt >= NONCE_GAP_MAX_RETRIES
                    ) {
                        throw error;
                    }

                    // Automining providers reject future nonces instead of
                    // queueing them. Retry only that provider limitation while
                    // keeping all facet deployments concurrent elsewhere.
                    await new Promise((resolve) =>
                        setTimeout(resolve, NONCE_GAP_RETRY_DELAY_MS)
                    );
                }
            }
        })
    );
}

export async function deployFacetsLocal(
    signer: Signer,
    libs: Record<string, string> = {}
): Promise<string[]> {
    return Promise.all(
        facetArtifacts.map((artifact) =>
            deployArtifactLocal(artifact, signer, { libs }).then((address) =>
                address.toString()
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
    disputeExecutionGasLimit?: number;
    /** Reuse already-deployed config-independent facets (see `deploy`). */
    facetAddresses?: string[];
};

export async function deploy(
    stateMachineAddress: string,
    consumerFacetAddress: string,
    signer: Signer,
    timeConfigOverrides?: TimeConfig,
    disputeExecutionGasLimit: number = DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT,
    // The dispute/verification facets are stateless and config-independent:
    // a caller that already deployed them (or found them cached on the node)
    // passes their addresses to skip the redeploy — only the proxy carries
    // timeConfig/gas-limit state.
    existingFacetAddresses?: string[]
): Promise<{ address: string; contract: StateChannelManagerProxy }> {
    const facetAddresses =
        existingFacetAddresses ?? (await deployFacets(signer));
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
                timeConfig.evidenceTime,
                disputeExecutionGasLimit
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
        timeConfig,
        disputeExecutionGasLimit,
        facetAddresses
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
        timeConfig,
        disputeExecutionGasLimit,
        facetAddresses
    );
}

export async function deployLocalDiamond(
    deployStateMachine: LocalStateMachineDeployer,
    signer: Signer,
    timeConfigOverrides?: TimeConfig,
    disputeExecutionGasLimit: number = DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT
): Promise<DeploymentResult> {
    const facetAddresses = await deployFacetsLocal(signer);

    const stateMachineAddress = (await deployStateMachine(signer)).toString();

    const timeConfig = getTimeConfig(timeConfigOverrides);

    const diamondAddress = await deployArtifactLocal(
        LocalDiamondArtifact,
        signer,
        {
            args: [
                stateMachineAddress,
                ...facetAddresses,
                timeConfig.p2pTime,
                timeConfig.agreementTime,
                timeConfig.chainFallbackTime,
                timeConfig.evidenceTime,
                disputeExecutionGasLimit
            ]
        }
    );

    return { address: diamondAddress, signer };
}

export async function deployLocalDiamondWithStateMachineAddress(
    stateMachineAddress: Address,
    signer: Signer,
    timeConfigOverrides?: TimeConfig,
    disputeExecutionGasLimit: number = DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT
): Promise<DeploymentResult> {
    const facetAddresses = await deployFacetsLocal(signer);
    const timeConfig = getTimeConfig(timeConfigOverrides);

    const diamondAddress = await deployArtifactLocal(
        LocalDiamondArtifact,
        signer,
        {
            args: [
                stateMachineAddress.toString(),
                ...facetAddresses,
                timeConfig.p2pTime,
                timeConfig.agreementTime,
                timeConfig.chainFallbackTime,
                timeConfig.evidenceTime,
                disputeExecutionGasLimit
            ]
        }
    );

    return { address: diamondAddress, signer };
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
