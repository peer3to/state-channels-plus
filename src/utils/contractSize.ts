export const EIP170_RUNTIME_LIMIT_BYTES = 24_576;
export const EIP3860_INITCODE_LIMIT_BYTES = 49_152;

// Development console libraries: Hardhat's, and forge-std's under its
// remapped or library-path source name.
const DEVELOPMENT_CONSOLE_SOURCE =
    /^(hardhat\/console\.sol|(lib\/)?forge-std\/(src\/)?(console2?|safeconsole)\.sol)$/;

export type NamedContractBytecode = {
    contractName: string;
    bytecode: string;
    deployedBytecode: string;
};

type ArtifactCandidate = {
    contractName?: unknown;
    bytecode?: unknown;
    deployedBytecode?: unknown;
};

export type ContractSizeKind = "runtime" | "initcode";

export class InvalidContractArtifactError extends Error {
    readonly code = "INVALID_CONTRACT_ARTIFACT";

    constructor(
        readonly contractName: string,
        readonly field: keyof NamedContractBytecode
    ) {
        super(
            `Invalid artifact for ${contractName}: missing required ${field}`
        );
        this.name = "InvalidContractArtifactError";
    }
}

export class ContractSizeLimitError extends Error {
    readonly code = "CONTRACT_SIZE_LIMIT_EXCEEDED";
    readonly excessBytes: number;

    constructor(
        readonly contractName: string,
        readonly sizeKind: ContractSizeKind,
        readonly measuredBytes: number,
        readonly limitBytes: number
    ) {
        const excessBytes = measuredBytes - limitBytes;
        super(
            `${contractName} ${sizeKind} is ${measuredBytes} bytes, exceeding the ${limitBytes}-byte limit by ${excessBytes} bytes`
        );
        this.name = "ContractSizeLimitError";
        this.excessBytes = excessBytes;
    }
}

export function requireNamedContractBytecode(
    artifact: ArtifactCandidate
): NamedContractBytecode {
    const contractName =
        typeof artifact.contractName === "string" && artifact.contractName
            ? artifact.contractName
            : "<unknown-contract>";
    for (const field of [
        "contractName",
        "bytecode",
        "deployedBytecode"
    ] as const) {
        if (typeof artifact[field] !== "string") {
            throw new InvalidContractArtifactError(contractName, field);
        }
    }
    return artifact as NamedContractBytecode;
}

export function bytecodeLength(bytecode: string): number {
    const body = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
    if (body.length % 2 !== 0) {
        throw new Error("Bytecode must contain complete bytes");
    }
    return body.length / 2;
}

export function assertArtifactRuntimeSize(artifact: ArtifactCandidate): number {
    const named = requireNamedContractBytecode(artifact);
    const measuredBytes = bytecodeLength(named.deployedBytecode);
    if (measuredBytes > EIP170_RUNTIME_LIMIT_BYTES) {
        throw new ContractSizeLimitError(
            named.contractName,
            "runtime",
            measuredBytes,
            EIP170_RUNTIME_LIMIT_BYTES
        );
    }
    return measuredBytes;
}

export function assertDeploymentInitcodeSize(
    contractName: string,
    deploymentData: string
): number {
    const measuredBytes = bytecodeLength(deploymentData);
    if (measuredBytes > EIP3860_INITCODE_LIMIT_BYTES) {
        throw new ContractSizeLimitError(
            contractName,
            "initcode",
            measuredBytes,
            EIP3860_INITCODE_LIMIT_BYTES
        );
    }
    return measuredBytes;
}

// Returns the development console libraries among the source files a
// contract's compilation read. A production artifact must have none.
export function developmentConsoleSources(
    sourceNames: readonly string[]
): string[] {
    return sourceNames.filter((sourceName) =>
        DEVELOPMENT_CONSOLE_SOURCE.test(sourceName)
    );
}
