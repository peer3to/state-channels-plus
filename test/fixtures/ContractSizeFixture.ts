// @spec-test-coverage-ignore: shared artifact classification; executable evidence is mapped from ContractSize.test.ts
import { artifacts } from "hardhat";
import {
    assertArtifactRuntimeSize,
    assertDeploymentInitcodeSize,
    ContractSizeLimitError,
    NamedContractBytecode
} from "@/utils/contractSize";

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

export type ClassifiedArtifact = {
    fullyQualifiedName: string;
    artifact: NamedContractBytecode;
    exemption?: ContractSizeExemption;
};

export function classifyContractArtifacts(
    compiled: readonly {
        fullyQualifiedName: string;
        artifact: NamedContractBytecode;
    }[],
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
    return compiled.map(({ fullyQualifiedName, artifact }) => ({
        fullyQualifiedName,
        artifact,
        exemption: byName.get(fullyQualifiedName)
    }));
}

export async function compiledContractArtifacts(): Promise<
    ClassifiedArtifact[]
> {
    const names = await artifacts.getAllFullyQualifiedNames();
    const compiled = await Promise.all(
        names.map(async (fullyQualifiedName) => ({
            fullyQualifiedName,
            artifact: await artifacts.readArtifact(fullyQualifiedName)
        }))
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
