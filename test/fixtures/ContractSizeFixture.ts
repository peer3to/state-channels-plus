// @spec-test-coverage-ignore: shared artifact classification; executable evidence is mapped from ContractSize.test.ts
import {
    assertArtifactRuntimeSize,
    assertDeploymentInitcodeSize,
    ContractSizeLimitError,
    developmentConsoleSources,
    NamedContractBytecode
} from "@/utils/contractSize";
import { artifacts } from "hardhat";
import { BuildInfo, CompilerOutputContract } from "hardhat/types";
import { readFile } from "node:fs/promises";

export type ContractSizeExemption = {
    fullyQualifiedName: string;
    reason: string;
};

export const contractSizeExemptions: readonly ContractSizeExemption[] = [
    {
        fullyQualifiedName:
            "contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol:LocalDiamond",
        reason: "local-only mirror deployed on allowUnlimitedContractSize networks"
    },
    {
        fullyQualifiedName: "hardhat/console.sol:console",
        reason: "development console library, compiled only for the local-only LocalDiamond"
    },
    {
        fullyQualifiedName:
            "contracts/V1/helpers/LibraryTestContract.sol:LibraryTestContract",
        reason: "contract test helper"
    },
    {
        fullyQualifiedName:
            "contracts/test/SimpleNumberStorage.sol:SimpleNumberStorage",
        reason: "contract test helper"
    }
];

export type CompiledContract = {
    fullyQualifiedName: string;
    artifact: NamedContractBytecode;
    // Every source file the compiler read for this contract, imports
    // included, as recorded in its metadata.
    sourceNames: readonly string[];
};

export type ClassifiedArtifact = CompiledContract & {
    exemption?: ContractSizeExemption;
};

export function classifyContractArtifacts(
    compiled: readonly CompiledContract[],
    exemptions: readonly ContractSizeExemption[] = contractSizeExemptions
): ClassifiedArtifact[] {
    const byName = new Map(
        exemptions.map((exemption) => [exemption.fullyQualifiedName, exemption])
    );
    const compiledNames = new Set(
        compiled.map(({ fullyQualifiedName }) => fullyQualifiedName)
    );
    const stale = exemptions.filter(
        ({ fullyQualifiedName }) => !compiledNames.has(fullyQualifiedName)
    );
    if (stale.length > 0) {
        throw new Error(
            `Stale contract-size exemptions: ${stale.map((item) => item.fullyQualifiedName).join(", ")}`
        );
    }
    return compiled.map((contract) => ({
        ...contract,
        exemption: byName.get(contract.fullyQualifiedName)
    }));
}

export async function compiledContractArtifacts(): Promise<
    ClassifiedArtifact[]
> {
    const names = await artifacts.getAllFullyQualifiedNames();
    const sourceNamesByContract = await compiledSourceNames();
    const compiled = await Promise.all(
        names.map(async (fullyQualifiedName) => {
            const sourceNames = sourceNamesByContract.get(fullyQualifiedName);
            if (!sourceNames) {
                throw new Error(
                    `No compiler metadata for ${fullyQualifiedName}`
                );
            }
            return {
                fullyQualifiedName,
                artifact: await artifacts.readArtifact(fullyQualifiedName),
                sourceNames
            };
        })
    );
    return classifyContractArtifacts(
        compiled.filter(({ artifact }) => artifact.bytecode !== "0x")
    );
}

export function productionSizeViolations(
    classified: readonly ClassifiedArtifact[]
): ContractSizeLimitError[] {
    const violations: ContractSizeLimitError[] = [];
    for (const { artifact, exemption } of classified) {
        if (exemption) continue;
        for (const check of [
            () => assertArtifactRuntimeSize(artifact),
            () =>
                assertDeploymentInitcodeSize(
                    artifact.contractName,
                    artifact.bytecode
                )
        ]) {
            try {
                check();
            } catch (error) {
                if (error instanceof ContractSizeLimitError) {
                    violations.push(error);
                    continue;
                }
                throw error;
            }
        }
    }
    return violations;
}

// Lists each production contract that compiles in a development console
// library, directly or through an import.
export function productionConsoleImports(
    classified: readonly ClassifiedArtifact[]
): string[] {
    const violations: string[] = [];
    for (const { fullyQualifiedName, sourceNames, exemption } of classified) {
        if (exemption) continue;
        for (const sourceName of developmentConsoleSources(sourceNames)) {
            violations.push(`${fullyQualifiedName} imports ${sourceName}`);
        }
    }
    return violations;
}

// Fully qualified contract name -> the source names in that contract's
// compiler metadata. Each build-info file is read once.
async function compiledSourceNames(): Promise<Map<string, readonly string[]>> {
    const sourceNamesByContract = new Map<string, readonly string[]>();
    for (const buildInfoPath of await artifacts.getBuildInfoPaths()) {
        const buildInfo = JSON.parse(
            await readFile(buildInfoPath, "utf8")
        ) as BuildInfo;
        for (const [sourceName, contracts] of Object.entries(
            buildInfo.output.contracts
        )) {
            for (const [contractName, output] of Object.entries(contracts)) {
                // Hardhat's CompilerOutputContract does not type the
                // metadata output that hardhat.config selects by default.
                const { metadata } = output as CompilerOutputContract & {
                    metadata: string;
                };
                const { sources } = JSON.parse(metadata) as {
                    sources: Record<string, unknown>;
                };
                sourceNamesByContract.set(
                    `${sourceName}:${contractName}`,
                    Object.keys(sources)
                );
            }
        }
    }
    return sourceNamesByContract;
}
