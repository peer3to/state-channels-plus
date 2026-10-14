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
    productionConsoleImports,
    productionSizeViolations
} from "@test/fixtures/ContractSizeFixture";
import { expect } from "chai";
import { ContractFactory } from "ethers";

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

    it("keeps every compiled production artifact free of development console imports", async function () {
        expect(
            productionConsoleImports(await compiledContractArtifacts()),
            "production contracts that compile in a console library"
        ).to.deep.equal([]);
    });

    it("reports Hardhat and forge-std console libraries reached through an import", function () {
        const classified = classifyContractArtifacts(
            [
                {
                    fullyQualifiedName: "contracts/Facet.sol:Facet",
                    artifact: { ...artifact(1), contractName: "Facet" },
                    sourceNames: [
                        "contracts/Facet.sol",
                        "contracts/Helper.sol",
                        "hardhat/console.sol"
                    ]
                },
                {
                    fullyQualifiedName: "contracts/Machine.sol:Machine",
                    artifact: { ...artifact(1), contractName: "Machine" },
                    sourceNames: [
                        "contracts/Machine.sol",
                        "forge-std/console2.sol",
                        "lib/forge-std/src/safeconsole.sol"
                    ]
                },
                {
                    fullyQualifiedName: "contracts/Clean.sol:Clean",
                    artifact: { ...artifact(1), contractName: "Clean" },
                    sourceNames: [
                        "contracts/Clean.sol",
                        "contracts/console/Ledger.sol"
                    ]
                }
            ],
            []
        );

        expect(productionConsoleImports(classified)).to.deep.equal([
            "contracts/Facet.sol:Facet imports hardhat/console.sol",
            "contracts/Machine.sol:Machine imports forge-std/console2.sol",
            "contracts/Machine.sol:Machine imports lib/forge-std/src/safeconsole.sol"
        ]);
    });

    it("reports forge-std console under its library-path and package source names", function () {
        const classified = classifyContractArtifacts(
            [
                {
                    fullyQualifiedName: "contracts/Adapter.sol:Adapter",
                    artifact: { ...artifact(1), contractName: "Adapter" },
                    sourceNames: [
                        "contracts/Adapter.sol",
                        "lib/forge-std/src/console.sol",
                        "forge-std/src/console.sol"
                    ]
                }
            ],
            []
        );

        expect(productionConsoleImports(classified)).to.deep.equal([
            "contracts/Adapter.sol:Adapter imports lib/forge-std/src/console.sol",
            "contracts/Adapter.sol:Adapter imports forge-std/src/console.sol"
        ]);
    });

    it("ignores a console library name nested under another path or extended past .sol", function () {
        const classified = classifyContractArtifacts(
            [
                {
                    fullyQualifiedName: "contracts/Lookalike.sol:Lookalike",
                    artifact: { ...artifact(1), contractName: "Lookalike" },
                    sourceNames: [
                        "contracts/Lookalike.sol",
                        "contracts/hardhat/console.sol",
                        "hardhat/console.sol.bak"
                    ]
                }
            ],
            []
        );

        expect(productionConsoleImports(classified)).to.deep.equal([]);
    });

    it("accepts a console import in an explicitly exempt local-only contract", function () {
        const classified = classifyContractArtifacts(
            [
                {
                    fullyQualifiedName: "contracts/Local.sol:Local",
                    artifact: { ...artifact(1), contractName: "Local" },
                    sourceNames: ["contracts/Local.sol", "hardhat/console.sol"]
                }
            ],
            [
                {
                    fullyQualifiedName: "contracts/Local.sol:Local",
                    reason: "local-only test entry"
                }
            ]
        );

        expect(productionConsoleImports(classified)).to.deep.equal([]);
    });

    it("reports every production violation in one result", function () {
        const violations = productionSizeViolations([
            {
                fullyQualifiedName:
                    "contracts/RuntimeTooLarge.sol:RuntimeTooLarge",
                artifact: {
                    ...artifact(EIP170_RUNTIME_LIMIT_BYTES + 1),
                    contractName: "RuntimeTooLarge"
                },
                sourceNames: ["contracts/RuntimeTooLarge.sol"]
            },
            {
                fullyQualifiedName:
                    "contracts/InitcodeTooLarge.sol:InitcodeTooLarge",
                artifact: {
                    ...artifact(1, EIP3860_INITCODE_LIMIT_BYTES + 1),
                    contractName: "InitcodeTooLarge"
                },
                sourceNames: ["contracts/InitcodeTooLarge.sol"]
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

    it("recognizes every explicit non-production exemption", async function () {
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
                        artifact: artifact(1),
                        sourceNames: ["contracts/A.sol"]
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
