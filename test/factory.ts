// @spec-test-coverage-ignore: typed test data factories; executable cases own their coverage
// Plain ethers, not hardhat's: the SDK worker thread imports helpers from this
// file (via HarnessControlRpc → DisputeService), and requiring "hardhat" there
// boots the whole Hardhat runtime — incl. hardhat-foundry's sync `forge config`
// exec — blocking the worker's event loop for ~800ms.
import { ethers } from "ethers";
import {
    BlockStruct,
    TransactionStruct,
    TransactionHeaderStruct,
    TransactionBodyStruct,
    JoinChannelStruct,
    SignedBlockStruct,
    BlockConfirmationStruct,
    StateSnapshotStruct,
    SnapshotDataStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeStruct,
    SignedDisputeStruct,
    DisputeInputStruct,
    ReduceOutputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { ReduceData } from "@/types/disputes";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { randomInt } from "crypto";
import { Codec, Type } from "@/utils";
import {
    tryDecodeCustomError,
    type CustomEvmError
} from "@/utils/evmErrorHandler";
import { Block, StateSnapshot } from "@/models";
import { Address, BlockHeight, Bytes, ForkId, Timestamp } from "@/types/types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export const hash = (): `0x${string}` =>
    ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;

export const zeroHash = () => ethers.ZeroHash as `0x${string}`;

export const randomWallet = (): ethers.HDNodeWallet =>
    ethers.Wallet.createRandom();

export const randomAddress = (): Address => randomWallet().address as Address;

export const hexString = (length: number = 32): Bytes => {
    return ethers.hexlify(ethers.randomBytes(length));
};

export const zeroHex = (length: number = 32): Bytes => {
    return ethers.hexlify(ethers.zeroPadBytes("0x00", length));
};

// Create a dummy wallet for generating valid signatures
const dummyWallet = new ethers.Wallet(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
);

export const signature = () => {
    // Sign a fixed message to get a valid signature
    const message = "dummy message for testing";
    return dummyWallet.signMessageSync(message);
};

/**
 * Creates a default transaction header
 * @returns A transaction header with default values
 */
export function transactionHeader(
    overrides: Partial<TransactionHeaderStruct> = {},
    signer?: HardhatEthersSigner
): TransactionHeaderStruct {
    return {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        forkId: ethers.hexlify(ethers.zeroPadBytes("0x01", 32)),
        transactionCnt: 0,
        participant: signer?.address || ethers.Wallet.createRandom().address,
        timestamp: Math.floor(Date.now() / 1000),
        ...overrides
    };
}

/**
 * Creates a default transaction body
 * @returns A transaction body with default values
 */
export function transactionBody(
    overrides: Partial<TransactionBodyStruct> = {}
): TransactionBodyStruct {
    return {
        encodedData: "0x",
        data: "0x",
        ...overrides
    };
}

/**
 * Creates a default transaction
 * @returns A transaction with default values
 */
export function transaction(
    overrides: Partial<TransactionStruct> = {},
    signer?: HardhatEthersSigner
): TransactionStruct {
    const transaction: TransactionStruct = {
        header: transactionHeader(undefined, signer),
        body: transactionBody()
    };

    // Deep merge for nested properties
    if (overrides.header) {
        transaction.header = { ...transaction.header, ...overrides.header };
    }

    if (overrides.body) {
        transaction.body = { ...transaction.body, ...overrides.body };
    }

    // Apply other top-level overrides
    const { header: _header, body: _body, ...topLevelOverrides } = overrides;
    return { ...transaction, ...topLevelOverrides };
}

export type BlockFactoryOverrides = Partial<BlockStruct> & {
    /** Shorthand for `transaction.header` — merged with any nested `transaction.header`. */
    header?: Partial<TransactionHeaderStruct>;
};

/**
 * Creates a mock block for testing
 * @param overrides Optional overrides for the block properties
 * @returns A mock Block instance
 */
export function block(
    overrides: BlockFactoryOverrides = {},
    signer?: HardhatEthersSigner
): Block {
    const { header, transaction: transactionOverride, ...rest } = overrides;

    const transactionOverrides: Partial<TransactionStruct> = {
        ...transactionOverride,
        ...(header
            ? {
                  header: {
                      ...transactionOverride?.header,
                      ...header
                  } as TransactionHeaderStruct
              }
            : {})
    };

    const blockStruct: BlockStruct = {
        transaction: transaction(
            Object.keys(transactionOverrides).length > 0
                ? transactionOverrides
                : undefined,
            signer
        ),
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        stateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
        messageBlocks: [],
        ...rest
    };

    const signedBlockStruct: SignedBlockStruct = {
        encodedBlock: Codec.encode(blockStruct, Type.Block),
        signature: signature()
    };

    return Block.fromSignedBlock(signedBlockStruct);
}

/** Copy of `blockStruct` with `transaction.header` shallow-merged with `header`. */
export function blockStructWithTransactionHeader(
    bs: BlockStruct,
    header: Partial<TransactionHeaderStruct>
): BlockStruct {
    return {
        transaction: {
            header: { ...bs.transaction.header, ...header },
            body: { ...bs.transaction.body }
        },
        stateSnapshotHash: bs.stateSnapshotHash,
        previousBlockHash: bs.previousBlockHash,
        messageBlocks: [...bs.messageBlocks]
    };
}

/**
 * Creates a mock DisputeStruct for testing
 * @param overrides Optional override values for the dispute fields
 * @returns A DisputeStruct with default values and any provided overrides
 */
export function dispute(
    overrides: Partial<{
        input: Partial<DisputeInputStruct>;
        outputSnapshotDataHash?: Bytes;
        postedAuditingData?: boolean;
    }> = {}
): DisputeStruct {
    const defaultDispute: DisputeStruct = {
        input: {
            channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
            forkId: ethers.hexlify(ethers.randomBytes(32)),
            latestStateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
            latestInboundMessageBlockHash: hash(),
            lastInboundMessageBlockHeight: 0,
            stateProof: {
                milestones: [],
                signedBlocks: []
            },
            onChainSlashes: [],
            disputeAuditingDataHash: ethers.hexlify(ethers.randomBytes(32)),
            disputer: ethers.ZeroAddress,
            timeout: {
                participant: ethers.ZeroAddress,
                blockHeight: 0,
                minTimeStamp: Math.floor(Date.now() / 1000),
                isForced: false,
                previousBlockProducer: ethers.ZeroAddress,
                previousBlockProducerPostedCalldata: false,
                participantSignatureOnPreviousBlock: ethers.hexlify(
                    ethers.randomBytes(32)
                )
            },
            requireExistingDisputeWindow: false,
            selfRemoval: false
        },

        outputSnapshotDataHash: ethers.hexlify(ethers.randomBytes(32)),
        postedAuditingData: false
    };
    const dispute = {
        input: {
            ...defaultDispute.input,
            ...overrides.input
        },
        outputSnapshotDataHash:
            overrides.outputSnapshotDataHash ||
            defaultDispute.outputSnapshotDataHash,
        postedAuditingData:
            overrides.postedAuditingData ?? defaultDispute.postedAuditingData
    };

    return { ...dispute };
}

export function joinChannel(
    overrides: Partial<JoinChannelStruct> = {}
): JoinChannelStruct {
    const defaultJoinChannel: JoinChannelStruct = {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        participant: ethers.Wallet.createRandom().address,
        balance: {
            amount: BigInt(randomInt(1, 100)),
            data: ethers.hexlify(ethers.randomBytes(32))
        },
        deadlineTimestamp: BigInt(randomInt(1, 100))
    };

    return { ...defaultJoinChannel, ...overrides };
}
export function signedBlock(
    overrides: Partial<SignedBlockStruct> = {},
    signer?: HardhatEthersSigner
): SignedBlockStruct {
    const mockBlock = block(undefined, signer);
    const defaultSignedBlock: SignedBlockStruct = {
        encodedBlock: Codec.encode(mockBlock.blockStruct, Type.Block),
        signature: signature()
    };

    return { ...defaultSignedBlock, ...overrides };
}

export function signedDispute(
    overrides: Partial<SignedDisputeStruct> = {}
): SignedDisputeStruct {
    const defaultSignedDispute: SignedDisputeStruct = {
        encodedDispute: Codec.encode(dispute(), Type.Dispute),
        signature: signature()
    };

    return { ...defaultSignedDispute, ...overrides };
}

export function blockConfirmation(
    overrides: Partial<BlockConfirmationStruct> = {}
): BlockConfirmationStruct {
    const defaultBlockConfirmation: BlockConfirmationStruct = {
        signedBlock: signedBlock(),
        signatures: [signature(), signature()]
    };

    return { ...defaultBlockConfirmation, ...overrides };
}

export async function encodeAuthoredConfirmation(
    block: Block,
    signer: ethers.Signer,
    signatures: string[] = []
): Promise<string> {
    const signature = await signer.signMessage(ethers.getBytes(block.hash));
    return Codec.encode(
        {
            signedBlock: { encodedBlock: block.encode(), signature },
            signatures
        },
        Type.BlockConfirmation
    ) as string;
}

/**
 * Craft a block and return its author-signed confirmation encoding.
 * The signer is the author by default -> pass `header.participant` only to
 * deliberately craft a signer/author mismatch.
 */
export async function buildAndEncodeBlock(
    signer: ethers.Signer,
    overrides: BlockFactoryOverrides = {},
    signatures: string[] = []
): Promise<string> {
    const authoredOverrides: BlockFactoryOverrides = {
        ...overrides,
        header: {
            participant: (await signer.getAddress()) as Address,
            ...overrides.header
        }
    };
    return encodeAuthoredConfirmation(
        block(authoredOverrides),
        signer,
        signatures
    );
}

export function messageBlock(
    overrides: Partial<MessageBlockStruct> = {}
): MessageBlockStruct {
    const defaultMessageBlock: MessageBlockStruct = {
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        blockHeight: BigInt(randomInt(0, 1000)),
        messages: [],
        totalBalance: {
            amount: 0n,
            data: "0x"
        },
        timestamp: BigInt(Math.floor(Date.now() / 1000))
    };

    return {
        ...defaultMessageBlock,
        ...overrides,
        messages: overrides.messages ?? defaultMessageBlock.messages
    };
}

export function exitChannelBlock(
    overrides: Partial<MessageBlockStruct> = {}
): MessageBlockStruct {
    return messageBlock(overrides);
}

/**
 * A chain of message blocks where each block's `previousBlockHash` is the
 * encoded hash of the one before it, starting from `previousBlockHash` -
 * exactly the linkage `_verifyInboundMessageBlocks` walks.
 */
export function linkedMessageBlocks(
    count: number,
    previousBlockHash: Bytes = hash()
): MessageBlockStruct[] {
    const blocks: MessageBlockStruct[] = [];
    let runningHash = previousBlockHash;
    for (let height = 0; height < count; height++) {
        const nextBlock = messageBlock({
            previousBlockHash: runningHash,
            blockHeight: BigInt(height)
        });
        blocks.push(nextBlock);
        runningHash = ethers.keccak256(
            Codec.encode(nextBlock, Type.MessageBlock)
        );
    }
    return blocks;
}

export function reduceOutput(
    overrides: Partial<ReduceOutputStruct> = {}
): ReduceOutputStruct {
    const defaultReduceOutput: ReduceOutputStruct = {
        latestBlock: {
            transaction: transaction(),
            previousBlockHash: zeroHex(),
            stateSnapshotHash: zeroHex(),
            messageBlocks: []
        },
        slashedParticipants: [],
        latestInboundMessageBlockHash: hash(),
        latestInboundMessageBlockHeight: 0n,
        timeout: {
            participant: randomAddress(),
            blockHeight: 0n,
            minTimeStamp: 0n,
            isForced: false,
            previousBlockProducer: randomAddress(),
            previousBlockProducerPostedCalldata: false,
            participantSignatureOnPreviousBlock: "0x"
        },
        selfRemovals: []
    };

    return { ...defaultReduceOutput, ...overrides };
}

export function reduceData(overrides: Partial<ReduceData> = {}): ReduceData {
    const defaultReduceData: ReduceData = {
        forkId: zeroHex() as ForkId,
        reducedOutput: reduceOutput(),
        latestStateSnapshot: {
            snapshotData: snapshotData(),
            forkId: zeroHex(),
            blockHeight: 0n,
            timestamp: 0n
        },
        encodedStateMachineState: "0x",
        inboundMessageBlocks: []
    };

    return { ...defaultReduceData, ...overrides };
}

let errorInterface: ethers.Interface | undefined;

// GeneratedArtifacts is ~2MB, and this file loads in the SDK worker thread, so
// importing it at module scope stalls the worker event loop long enough to skew
// the protocol clock and fail unrelated time-sensitive tests. Load it on first
// use instead - only error-decoding tests pay for it.
function getErrorInterface(): ethers.Interface {
    if (!errorInterface) {
        const { errorAbis } =
            require("@/utils/GeneratedArtifacts") as typeof import("@/utils/GeneratedArtifacts");
        errorInterface = new ethers.Interface(errorAbis);
    }
    return errorInterface;
}

/**
 * A real ABI-encoded revert, decoded by the SDK's own decoder. Built from the
 * generated error ABIs, so a rename in Errors.sol breaks the tests instead of
 * silently feeding them an undefined field.
 */
export function customEvmError(
    errorName: string,
    args: readonly unknown[] = []
): CustomEvmError {
    const encodedRevert = getErrorInterface().encodeErrorResult(
        errorName,
        args
    );
    const revertError = Object.assign(new Error("execution reverted"), {
        data: encodedRevert
    });
    return tryDecodeCustomError(revertError)!;
}

// The zero value for one ABI parameter: 0 for integers, the zero address, an
// empty dynamic value, the all-zero fixed-width bytes, and so on recursively
// for arrays and tuples.
function zeroValueForParamType(paramType: ethers.ParamType): unknown {
    if (paramType.baseType === "array") {
        const arrayLength = paramType.arrayLength ?? -1;
        if (arrayLength < 0) return [];
        return Array.from({ length: arrayLength }, () =>
            zeroValueForParamType(paramType.arrayChildren!)
        );
    }
    if (paramType.baseType === "tuple") {
        return (paramType.components ?? []).map(zeroValueForParamType);
    }
    if (paramType.baseType === "address") return ethers.ZeroAddress;
    if (paramType.baseType === "bool") return false;
    if (paramType.baseType === "string") return "";
    if (paramType.baseType === "bytes") return "0x";
    const fixedBytesWidth = /^bytes(\d+)$/.exec(paramType.baseType);
    if (fixedBytesWidth) {
        return ethers.zeroPadValue("0x", Number(fixedBytesWidth[1]));
    }
    if (/^u?int\d*$/.test(paramType.baseType)) return 0n;
    throw new Error(
        `Unsupported custom error parameter type: ${paramType.type}`
    );
}

/**
 * Revert data for `errorName`, with a zero value for every argument the error
 * declares. Derived from the error's own ABI fragment, so a test that only
 * cares about the error's identity keeps working when the error gains
 * arguments - never hand-hash `keccak256("Name()")`, which silently stops
 * matching the moment a parameter is added.
 *
 * Throws when `errorName` is not a known contract error.
 */
export function encodedCustomErrorRevert(
    errorName: string,
    args?: string[]
): Bytes {
    const errorInterface = getErrorInterface();
    const errorFragment = errorInterface.getError(errorName);
    if (!errorFragment) {
        throw new Error(`Unknown contract error: ${errorName}`);
    }
    return errorInterface.encodeErrorResult(
        errorFragment,
        args ?? errorFragment.inputs.map(zeroValueForParamType)
    );
}

export function snapshotData(
    overrides: Partial<SnapshotDataStruct> = {}
): SnapshotDataStruct {
    return {
        originForkId: zeroHex(),
        stateMachineStateHash: zeroHex(),
        participants: [],
        latestInboundMessageBlockHash: zeroHex(),
        latestInboundMessageBlockHeight: 0n,
        latestOutboundMessageBlockHash: zeroHex(),
        latestOutboundMessageBlockHeight: 0n,
        totalDeposits: {
            amount: 0n,
            data: "0x"
        },
        totalWithdrawals: {
            amount: 0n,
            data: "0x"
        },
        ...overrides
    };
}

export function stateSnapshot(
    overrides: Partial<{
        snapshotData: Partial<SnapshotDataStruct>;
        forkId?: ForkId;
        blockHeight?: BlockHeight;
        timestamp?: Timestamp;
    }> = {}
): StateSnapshot {
    const defaultStateSnapshot: StateSnapshotStruct = {
        snapshotData: {
            originForkId: ethers.hexlify(ethers.randomBytes(32)),
            stateMachineStateHash: ethers.hexlify(ethers.randomBytes(32)),
            participants: [
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address
            ],
            latestInboundMessageBlockHash: hash(),
            latestInboundMessageBlockHeight: 0n,
            latestOutboundMessageBlockHash: hash(),
            latestOutboundMessageBlockHeight: 0n,
            totalDeposits: {
                amount: BigInt(randomInt(1, 1000)),
                data: "0x"
            },
            totalWithdrawals: {
                amount: BigInt(randomInt(1, 500)),
                data: "0x"
            }
        },
        forkId: ethers.hexlify(ethers.randomBytes(32)),
        blockHeight: BigInt(randomInt(0, 500)),
        timestamp: Math.floor(Date.now() / 1000)
    };
    const snapshotDataObj = {
        ...defaultStateSnapshot.snapshotData,
        ...overrides.snapshotData
    };
    const stateSnapshotObj = {
        ...defaultStateSnapshot,
        ...overrides,
        // after the spread: a partial snapshotData override must not replace
        // the merged object wholesale
        snapshotData: snapshotDataObj
    };

    return StateSnapshot.from(stateSnapshotObj as StateSnapshotStruct);
}

export function milestoneProof(
    forkId: ForkId,
    height: number = 0,
    overrides: Partial<StateProofStruct> = {}
): {
    forkId: ForkId;
    height: number;
    proof: StateProofStruct;
} {
    return {
        forkId,
        height,
        proof: {
            milestones: [
                {
                    blockConfirmations: [blockConfirmation()]
                }
            ],
            signedBlocks: [],
            ...overrides
        }
    };
}
