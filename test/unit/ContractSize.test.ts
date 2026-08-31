import { expect } from "chai";
import { ContractFactory } from "ethers";
import {
    assertArtifactRuntimeSize,
    assertDeploymentInitcodeSize,
    ContractSizeLimitError,
    EIP170_RUNTIME_LIMIT_BYTES,
    EIP3860_INITCODE_LIMIT_BYTES,
    InvalidContractArtifactError
} from "@/utils/contractSize";
import {
    classifyContractArtifacts,
    compiledContractArtifacts,
    contractSizeExemptions,
    productionSizeViolations
} from "@test/fixtures/ContractSizeFixture";

function bytes(length: number): string {
    return `0x${"00".repeat(length)}`;
}

function artifact(runtimeBytes: number, initcodeBytes = 1) {
    return {
        contractName: "BoundaryContract",
        bytecode: bytes(initcodeBytes),
        deployedBytecode: bytes(runtimeBytes)
    };
}

describe("contract size", function () {
    it("keeps every compiled production artifact within both deployment limits", async function () {
        const violations = productionSizeViolations(
            await compiledContractArtifacts()
        );
        expect(
            violations.map((error) => error.message),
            "all production size violations"
        ).to.deep.equal([]);
    });

    it("reports every production violation in one result", function () {
        const violations = productionSizeViolations([
            {
                fullyQualifiedName:
                    "contracts/RuntimeTooLarge.sol:RuntimeTooLarge",
                artifact: {
                    ...artifact(EIP170_RUNTIME_LIMIT_BYTES + 1),
                    contractName: "RuntimeTooLarge"
                }
            },
            {
                fullyQualifiedName:
                    "contracts/InitcodeTooLarge.sol:InitcodeTooLarge",
                artifact: {
                    ...artifact(1, EIP3860_INITCODE_LIMIT_BYTES + 1),
                    contractName: "InitcodeTooLarge"
                }
            }
        ]);

        expect(violations).to.have.length(2);
        expect(violations[0]).to.be.instanceOf(ContractSizeLimitError);
        expect(violations[0].contractName).to.equal("RuntimeTooLarge");
        expect(violations[0].sizeKind).to.equal("runtime");
        expect(violations[1]).to.be.instanceOf(ContractSizeLimitError);
        expect(violations[1].contractName).to.equal("InitcodeTooLarge");
        expect(violations[1].sizeKind).to.equal("initcode");
    });

    it("accepts 24,576 runtime bytes and rejects 24,577", function () {
        expect(
            assertArtifactRuntimeSize(artifact(EIP170_RUNTIME_LIMIT_BYTES))
        ).to.equal(EIP170_RUNTIME_LIMIT_BYTES);
        expect(() =>
            assertArtifactRuntimeSize(artifact(EIP170_RUNTIME_LIMIT_BYTES + 1))
        ).to.throw(ContractSizeLimitError);
    });

    it("accepts 49,152 initcode bytes and rejects 49,153", function () {
        expect(
            assertDeploymentInitcodeSize(
                "BoundaryContract",
                bytes(EIP3860_INITCODE_LIMIT_BYTES)
            )
        ).to.equal(EIP3860_INITCODE_LIMIT_BYTES);
        expect(() =>
            assertDeploymentInitcodeSize(
                "BoundaryContract",
                bytes(EIP3860_INITCODE_LIMIT_BYTES + 1)
            )
        ).to.throw(ContractSizeLimitError);
    });

    it("counts constructor arguments in full deployment initcode", async function () {
        const factory = new ContractFactory(
            [
                {
                    type: "constructor",
                    inputs: [{ name: "value", type: "uint256" }]
                }
            ],
            bytes(EIP3860_INITCODE_LIMIT_BYTES - 32)
        );
        const deployTx = await factory.getDeployTransaction(1n);

        expect(
            assertDeploymentInitcodeSize(
                "ConstructorContract",
                deployTx.data!.toString()
            )
        ).to.equal(EIP3860_INITCODE_LIMIT_BYTES);
    });

    it("rejects an artifact missing deployedBytecode as invalid", function () {
        let failure: unknown;
        try {
            assertArtifactRuntimeSize({
                contractName: "IncompleteArtifact",
                bytecode: "0x00"
            });
        } catch (error) {
            failure = error;
        }

        expect(failure).to.be.instanceOf(InvalidContractArtifactError);
        expect((failure as InvalidContractArtifactError).field).to.equal(
            "deployedBytecode"
        );
    });

    it("recognizes every explicit local or test-only exemption", async function () {
        const classified = await compiledContractArtifacts();
        expect(
            classified
                .filter(({ exemption }) => exemption !== undefined)
                .map(({ fullyQualifiedName }) => fullyQualifiedName)
                .sort()
        ).to.deep.equal(
            contractSizeExemptions
                .map(({ fullyQualifiedName }) => fullyQualifiedName)
                .sort()
        );
    });

    it("rejects stale contract-size exemptions", function () {
        expect(() =>
            classifyContractArtifacts(
                [
                    {
                        fullyQualifiedName: "contracts/A.sol:A",
                        artifact: artifact(1)
                    }
                ],
                [
                    {
                        fullyQualifiedName: "contracts/Missing.sol:Missing",
                        reason: "stale test entry"
                    }
                ]
            )
        ).to.throw("Stale contract-size exemptions");
    });

    it("reports contract name, measured bytes, limit, and excess", function () {
        let failure: unknown;
        try {
            assertArtifactRuntimeSize(artifact(EIP170_RUNTIME_LIMIT_BYTES + 7));
        } catch (error) {
            failure = error;
        }

        expect(failure).to.be.instanceOf(ContractSizeLimitError);
        const sizeError = failure as ContractSizeLimitError;
        expect(sizeError.contractName).to.equal("BoundaryContract");
        expect(sizeError.measuredBytes).to.equal(
            EIP170_RUNTIME_LIMIT_BYTES + 7
        );
        expect(sizeError.limitBytes).to.equal(EIP170_RUNTIME_LIMIT_BYTES);
        expect(sizeError.excessBytes).to.equal(7);
    });
});
