// @spec-test-coverage-ignore: shared artifact classification; executable evidence is mapped from ContractSize.test.ts
import {
    assertArtifactRuntimeSize,
    assertDeploymentInitcodeSize,
    ContractSizeLimitError,
    developmentConsoleSources,
    NamedContractBytecode
} from "@/utils/contractSize";
import { artifacts } from "hardhat";
import { BuildInfo, CompilerOutputContract, DebugFile } from "hardhat/types";
import { parseFullyQualifiedName } from "hardhat/utils/contract-names";
import { readFile } from "node:fs/promises";
import path from "node:path";

// `<source name>:<contract name>`, as Hardhat names an artifact.
export type FullyQualifiedName = string;
// A source unit name as solc records it in compiler metadata.
export type SourceName = string;
// Absolute path of a Hardhat build-info file.
type BuildInfoPath = string;

export type ContractSizeExemption = {
    fullyQualifiedName: FullyQualifiedName;
    reason: string;
};

// Artifacts that are not production contracts: local-only contracts, test
// helpers, and the development console library compiled only for them. Both
// the size scan and the console-import scan skip every entry.
export const contractSizeExemptions: readonly ContractSizeExemption[] = [
    {
        fullyQualifiedName:
            "contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol:LocalDiamond",
        reason: "local-only mirror deployed on allowUnlimitedContractSize networks"
    },
    {
        fullyQualifiedName: "hardhat/console.sol:console",
        reason: "development console library, compiled only for the local-only LocalDiamond and the ConsoleImportProbe test helper"
    },
    {
        fullyQualifiedName:
            "contracts/test/ConsoleImportProbe.sol:ConsoleImportProbe",
        reason: "contract test helper that reaches the console library through an import"
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
    fullyQualifiedName: FullyQualifiedName;
    artifact: NamedContractBytecode;
    // Every source file the compiler read for this contract, imports
    // included, as recorded in its metadata.
    sourceNames: readonly SourceName[];
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
// compiler metadata. Artifacts do not change during a run, so the
// build-info files are parsed once per run.
let sourceNamesByContractOnce:
    | Promise<Map<FullyQualifiedName, readonly SourceName[]>>
    | undefined;

function compiledSourceNames(): Promise<
    Map<FullyQualifiedName, readonly SourceName[]>
> {
    sourceNamesByContractOnce ??= readCompiledSourceNames();
    return sourceNamesByContractOnce;
}

// After an incremental compile an older build-info can still hold a stale
// copy of a recompiled contract. Read each contract only from the build-info
// its own artifact's debug file points to, as artifacts.getBuildInfo does,
// and parse each build-info file once.
async function readCompiledSourceNames(): Promise<
    Map<FullyQualifiedName, readonly SourceName[]>
> {
    const contractsByBuildInfo = new Map<
        BuildInfoPath,
        FullyQualifiedName[]
    >();
    for (const fullyQualifiedName of await artifacts.getAllFullyQualifiedNames()) {
        const buildInfoPath = await buildInfoPathOf(fullyQualifiedName);
        const contracts = contractsByBuildInfo.get(buildInfoPath) ?? [];
        contracts.push(fullyQualifiedName);
        contractsByBuildInfo.set(buildInfoPath, contracts);
    }

    const sourceNamesByContract = new Map<
        FullyQualifiedName,
        readonly SourceName[]
    >();
    for (const [buildInfoPath, contracts] of contractsByBuildInfo) {
        const buildInfo = JSON.parse(
            await readFile(buildInfoPath, "utf8")
        ) as BuildInfo;
        for (const fullyQualifiedName of contracts) {
            const { sourceName, contractName } =
                parseFullyQualifiedName(fullyQualifiedName);
            const output =
                buildInfo.output.contracts[sourceName]?.[contractName];
            if (!output) {
                throw new Error(
                    `${buildInfoPath} has no output for ${fullyQualifiedName}`
                );
            }
            // Hardhat's CompilerOutputContract does not type the
            // metadata output that hardhat.config selects by default.
            const { metadata } = output as CompilerOutputContract & {
                metadata: string;
            };
            const { sources } = JSON.parse(metadata) as {
                sources: Record<SourceName, unknown>;
            };
            sourceNamesByContract.set(fullyQualifiedName, Object.keys(sources));
        }
    }
    return sourceNamesByContract;
}

// The build-info file an artifact was compiled into, read from the artifact's
// Hardhat debug file the same way artifacts.getBuildInfo resolves it.
async function buildInfoPathOf(
    fullyQualifiedName: FullyQualifiedName
): Promise<BuildInfoPath> {
    const debugFilePath = artifacts
        .formArtifactPathFromFullyQualifiedName(fullyQualifiedName)
        .replace(/\.json$/, ".dbg.json");
    const { buildInfo } = JSON.parse(
        await readFile(debugFilePath, "utf8")
    ) as DebugFile;
    return path.resolve(path.dirname(debugFilePath), buildInfo);
}
