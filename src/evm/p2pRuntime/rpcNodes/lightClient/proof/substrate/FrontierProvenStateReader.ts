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
import type { SubstrateHeaderJson } from "../../lightClientWire";
import AProvenStateReader, {
    type AccountStateRead,
    type BlockEnvironment,
    type NodeRequest,
    type ProvenAccountState,
    type ProvenBlock
} from "../AProvenStateReader";
import StorageProofError from "../StorageProofError";

function isHexString(value: unknown): value is string {
    return typeof value === "string" && /^0x[0-9a-f]*$/i.test(value);
}

function isHeader(answer: unknown): answer is SubstrateHeaderJson {
    const header = answer as Partial<SubstrateHeaderJson> | null;
    return (
        typeof header === "object" &&
        header !== null &&
        isHexString(header.parentHash) &&
        isHexString(header.number) &&
        isHexString(header.stateRoot) &&
        isHexString(header.extrinsicsRoot) &&
        Array.isArray(header.digest?.logs) &&
        header.digest.logs.every(isHexString)
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
        return {
            number: header.number,
            // a contract reads the runtime's clock in whole seconds
            timestamp: header.timestampMs / 1000n,
            coinbase: header.beneficiary,
            gasLimit: header.gasLimit,
            difficulty: header.difficulty,
            prevRandao: header.mixHash,
            baseFeePerGas: this.constants.baseFeePerGas
        };
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
        return reads.map(({ address, slots, account, code }) => ({
            address,
            storage:
                slots.length > 0
                    ? this.storageVerifier.provenStorage(
                          block.stateRoot,
                          address,
                          slots,
                          proofNodes
                      )
                    : [],
            ...(account && {
                account: this.accountVerifier.provenAccount(
                    block.stateRoot,
                    address,
                    proofNodes
                )
            }),
            ...(code && {
                code: this.accountVerifier.provenCode(
                    block.stateRoot,
                    address,
                    proofNodes
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
        if (!Array.isArray(proofNodes) || !proofNodes.every(isHexString))
            throw new StorageProofError("The node answered no read proof");
        return proofNodes;
    }
}
