import FrontierAccountProofVerifier from "./FrontierAccountProofVerifier";
import type { FrontierChainConstants } from "./FrontierChainConstants";
import FrontierEthereumHeader from "./FrontierEthereumHeader";
import {
    accountCodeKey,
    contractStorageKey,
    CURRENT_ETHEREUM_BLOCK_KEY,
    systemAccountKey
} from "./frontierStateKeys";
import FrontierStorageProofVerifier from "./FrontierStorageProofVerifier";
import SubstrateHeader from "./SubstrateHeader";
import SubstrateTrieProof from "./SubstrateTrieProof";
import type {
    LightClientStages,
    LightClientStorageBlock,
    SubstrateHeaderJson
} from "../../lightClientWire";
import AProvenStateReader, {
    type AccountStateRead,
    type BlockEnvironment,
    type NodeRequest,
    type ProvenAccountState,
    type ProvenBlock
} from "../AProvenStateReader";
import StorageProofError from "../StorageProofError";
import { isHexString } from "ethers";

/** Whether `value` is hex of whole bytes, as every hash, log and proof node is. */
function isBytes(value: unknown): value is string {
    return isHexString(value, true);
}

function isHeader(answer: unknown): answer is SubstrateHeaderJson {
    const header = answer as Partial<SubstrateHeaderJson> | null;
    return (
        typeof header === "object" &&
        header !== null &&
        isBytes(header.parentHash) &&
        isHexString(header.number) &&
        isBytes(header.stateRoot) &&
        isBytes(header.extrinsicsRoot) &&
        Array.isArray(header.digest?.logs) &&
        header.digest.logs.every(isBytes)
    );
}

function isStages(value: unknown): value is LightClientStages {
    const stages = value as Partial<LightClientStages> | null;
    return (
        typeof stages === "object" &&
        stages !== null &&
        (stages.executedAt === null || typeof stages.executedAt === "number") &&
        typeof stages.builtAt === "number" &&
        typeof stages.sentAt === "number"
    );
}

/** Whether `pushed` has the shape of a block a node pushes to a light client subscription. */
export function isStorageBlock(
    pushed: unknown
): pushed is LightClientStorageBlock {
    const block = pushed as Partial<LightClientStorageBlock> | null;
    return (
        typeof block === "object" &&
        block !== null &&
        isHeader(block.header) &&
        isBytes(block.ethereumHeader) &&
        typeof block.sync === "boolean" &&
        Array.isArray(block.values) &&
        block.values.every(
            (entry) =>
                isBytes(entry?.key) &&
                (entry.value === null || isBytes(entry.value))
        ) &&
        Array.isArray(block.proofNodes) &&
        block.proofNodes.every(isBytes) &&
        isStages(block.stages)
    );
}

/**
 * Proven state of a Frontier chain, read through the node's Substrate RPC:
 * `chain_getHeader` for the best block and one `state_getReadProof` for
 * everything a read asks. A block's environment is the header of its
 * Ethereum block, which the chain's state holds.
 */
export default class FrontierProvenStateReader extends AProvenStateReader {
    private readonly requestNode: NodeRequest;
    private readonly storageVerifier = new FrontierStorageProofVerifier();
    private readonly accountVerifier: FrontierAccountProofVerifier;
    private readonly constants: FrontierChainConstants;

    constructor(requestNode: NodeRequest, constants: FrontierChainConstants) {
        super();
        this.requestNode = requestNode;
        this.constants = constants;
        this.accountVerifier = new FrontierAccountProofVerifier(
            constants.existentialDeposit
        );
    }

    async head(): Promise<ProvenBlock> {
        const answer = await this.requestNode("chain_getHeader", []);
        if (!isHeader(answer))
            throw new StorageProofError("The node answered no block header");
        const header = new SubstrateHeader(answer);
        return {
            number: header.number,
            hash: header.hash,
            ethereumBlockHash: header.ethereumBlockHash(),
            stateRoot: header.stateRoot
        };
    }

    async environment(block: ProvenBlock): Promise<BlockEnvironment> {
        const proofNodes = await this.readProof(block, [
            CURRENT_ETHEREUM_BLOCK_KEY
        ]);
        const encodedBlock = new SubstrateTrieProof(proofNodes).read(
            block.stateRoot,
            CURRENT_ETHEREUM_BLOCK_KEY
        );
        if (encodedBlock === null)
            throw new StorageProofError(
                "The block's state holds no Ethereum block"
            );
        const header = new FrontierEthereumHeader(encodedBlock);
        header.assertHash(block.ethereumBlockHash);
        return header.environment(this.constants.baseFeePerGas);
    }

    async read(
        block: ProvenBlock,
        reads: AccountStateRead[]
    ): Promise<ProvenAccountState[]> {
        const keys = reads.flatMap(({ address, slots, account, code }) => [
            ...slots.map((slot) => contractStorageKey(address, slot)),
            ...(account ? [systemAccountKey(address)] : []),
            ...(code ? [accountCodeKey(address)] : [])
        ]);
        // a read that asks nothing needs no proof
        const proofNodes =
            keys.length > 0 ? await this.readProof(block, keys) : [];
        // one proof for the whole read, so each of its nodes is hashed once
        const proof = new SubstrateTrieProof(proofNodes);
        return reads.map(({ address, slots, account, code }) => ({
            address,
            storage:
                slots.length > 0
                    ? this.storageVerifier.storageIn(
                          proof,
                          block.stateRoot,
                          address,
                          slots
                      )
                    : [],
            ...(account && {
                account: this.accountVerifier.accountIn(
                    proof,
                    block.stateRoot,
                    address
                )
            }),
            ...(code && {
                code: this.accountVerifier.codeIn(
                    proof,
                    block.stateRoot,
                    address
                )
            })
        }));
    }

    /** One proof of all of `keys` at `block`, as the node gave it. */
    private async readProof(
        block: ProvenBlock,
        keys: string[]
    ): Promise<string[]> {
        const answer = (await this.requestNode("state_getReadProof", [
            keys,
            block.hash
        ])) as { proof?: unknown } | null;
        const proofNodes = answer?.proof;
        if (!Array.isArray(proofNodes) || !proofNodes.every(isBytes))
            throw new StorageProofError("The node answered no read proof");
        return proofNodes;
    }
}
