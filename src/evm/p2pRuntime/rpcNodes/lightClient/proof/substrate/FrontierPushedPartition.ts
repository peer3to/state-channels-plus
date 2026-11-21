import FrontierAccountProofVerifier from "./FrontierAccountProofVerifier";
import type { FrontierChainConstants } from "./FrontierChainConstants";
import FrontierEthereumHeader from "./FrontierEthereumHeader";
import { isStorageBlock } from "./FrontierProvenStateReader";
import FrontierStorageProofVerifier from "./FrontierStorageProofVerifier";
import SubstrateHeader from "./SubstrateHeader";
import SubstrateTrieProof, {
    type NodeHash,
    trieNodeHash
} from "./SubstrateTrieProof";
import type {
    AccountStateRead,
    BlockEnvironment,
    ProvenAccountState,
    ProvenBlock
} from "../AProvenStateReader";
import APushedPartition, {
    type AcceptedBlock,
    type PartitionDecision
} from "../APushedPartition";
import type { StorageSlot } from "../AStorageProofVerifier";
import StorageProofError from "../StorageProofError";
import { getBytes, hexlify } from "ethers";

/** A key of the state trie, lowercase 0x-prefixed hex. */
type StorageKey = string;
/** What a key holds, SCALE bytes as lowercase 0x-prefixed hex, or `null` for nothing. */
type StorageValue = string | null;

/** The held state at one block. */
type HeldBlock = { block: ProvenBlock; environment: BlockEnvironment };

/**
 * A partition a Frontier node pushes: raw state trie keys and their values,
 * with the trie nodes that prove them under a Substrate header's state root.
 * The block values a call reads come from the Ethereum header the message
 * carries, which must hash to the Ethereum block hash the header's digest
 * names.
 */
export default class FrontierPushedPartition extends APushedPartition {
    private readonly storageVerifier = new FrontierStorageProofVerifier();
    private readonly accountVerifier: FrontierAccountProofVerifier;
    private readonly constants: FrontierChainConstants;
    /** Each held key and what it holds at the held block, as pushed and proven. */
    private values = new Map<StorageKey, StorageValue>();
    /** The trie nodes on the paths to the held keys under the held block's state root. */
    private nodes = new Map<NodeHash, string>();
    private held?: HeldBlock;

    constructor(constants: FrontierChainConstants) {
        super();
        this.constants = constants;
        this.accountVerifier = new FrontierAccountProofVerifier(
            constants.existentialDeposit
        );
    }

    get block(): ProvenBlock | undefined {
        return this.held?.block;
    }

    get environment(): BlockEnvironment | undefined {
        return this.held?.environment;
    }

    accept(message: unknown): AcceptedBlock | undefined {
        try {
            return this.take(message);
        } catch (error) {
            // a refused message leaves nothing to build on until a sync
            this.values = new Map();
            this.nodes = new Map();
            this.held = undefined;
            throw error;
        }
    }

    decide(reads: AccountStateRead[]): PartitionDecision {
        const decision: PartitionDecision = { decided: [], undecided: [] };
        if (!this.held) {
            decision.undecided.push(...reads);
            return decision;
        }
        const { stateRoot } = this.held.block;
        const proofNodes = [...this.nodes.values()];
        for (const read of reads) {
            const { address } = read;
            const storage = this.decideSlots(stateRoot, read);
            const account = read.account
                ? this.decided(() =>
                      this.accountVerifier.provenAccount(
                          stateRoot,
                          address,
                          proofNodes
                      )
                  )
                : undefined;
            const code = read.code
                ? this.decided(() =>
                      this.accountVerifier.provenCode(
                          stateRoot,
                          address,
                          proofNodes
                      )
                  )
                : undefined;
            if (
                storage.decided.length > 0 ||
                account !== undefined ||
                code !== undefined
            )
                decision.decided.push({
                    read: {
                        address,
                        slots: storage.decided.map(({ slot }) => slot),
                        account: account !== undefined,
                        code: code !== undefined
                    },
                    proven: {
                        address,
                        storage: storage.decided.map(({ value }) => value),
                        ...(account !== undefined && { account }),
                        ...(code !== undefined && { code })
                    }
                });
            const accountMissing = read.account && account === undefined;
            const codeMissing = read.code && code === undefined;
            if (storage.undecided.length > 0 || accountMissing || codeMissing)
                decision.undecided.push({
                    address,
                    slots: storage.undecided,
                    account: accountMissing,
                    code: codeMissing
                });
        }
        return decision;
    }

    private take(message: unknown): AcceptedBlock | undefined {
        if (!isStorageBlock(message))
            throw new StorageProofError("The node pushed no storage block");
        if (!message.sync && !this.held)
            throw new StorageProofError(
                "The node pushed a change to a partition it never synced"
            );
        const header = new SubstrateHeader(message.header);
        const block: ProvenBlock = {
            number: header.number,
            hash: header.hash,
            ethereumBlockHash: header.ethereumBlockHash(),
            stateRoot: header.stateRoot
        };
        if (!message.sync && this.held) {
            const held = this.held.block;
            // the same block again changes nothing
            if (block.hash === held.hash) return undefined;
            // a reorg may push another block of the same height, never an earlier one
            if (block.number < held.number)
                throw new StorageProofError(
                    `The node pushed block ${block.number} after block ${held.number}`
                );
        }
        const ethereumHeader = new FrontierEthereumHeader(
            getBytes(message.ethereumHeader)
        );
        ethereumHeader.assertHash(block.ethereumBlockHash);

        const values = message.sync
            ? new Map<StorageKey, StorageValue>()
            : new Map(this.values);
        for (const { key, value } of message.values)
            values.set(key.toLowerCase(), value?.toLowerCase() ?? null);
        const nodes = message.sync
            ? new Map<NodeHash, string>()
            : new Map(this.nodes);
        let newNodes = 0;
        for (const proofNode of message.proofNodes) {
            const nodeHash = trieNodeHash(getBytes(proofNode));
            if (nodes.has(nodeHash)) continue;
            nodes.set(nodeHash, proofNode);
            newNodes++;
        }

        // every held key, pushed now or earlier, must read as held under the new root
        const proof = new SubstrateTrieProof([...nodes.values()]);
        const used = new Set<NodeHash>();
        for (const [key, value] of values) {
            const proven = proof.read(block.stateRoot, key, used);
            if ((proven === null ? null : hexlify(proven)) !== value)
                throw new StorageProofError(
                    `The proof of block ${block.number} decides key ${key} otherwise than the partition holds it`
                );
        }
        // what no held key uses belongs to an earlier root
        for (const nodeHash of [...nodes.keys()])
            if (!used.has(nodeHash)) nodes.delete(nodeHash);

        this.values = values;
        this.nodes = nodes;
        this.held = {
            block,
            environment: ethereumHeader.environment(
                this.constants.baseFeePerGas
            )
        };
        return {
            block,
            sync: message.sync,
            values: message.values.length,
            newNodes,
            heldNodes: nodes.size,
            stages: message.stages
        };
    }

    /** The slots of `read` the held proof decides, with their values, and the rest. */
    private decideSlots(
        stateRoot: string,
        { address, slots }: AccountStateRead
    ): {
        decided: { slot: StorageSlot; value: string }[];
        undecided: StorageSlot[];
    } {
        const proofNodes = [...this.nodes.values()];
        // most reads stay inside the partition: one proof for all of them
        const all = this.decided(() =>
            this.storageVerifier.provenStorage(
                stateRoot,
                address,
                slots,
                proofNodes
            )
        );
        if (all !== undefined)
            return {
                decided: slots.map((slot, index) => ({
                    slot,
                    value: all[index]
                })),
                undecided: []
            };
        const decided: { slot: StorageSlot; value: string }[] = [];
        const undecided: StorageSlot[] = [];
        for (const slot of slots) {
            const value = this.decided(() =>
                this.storageVerifier.provenStorage(
                    stateRoot,
                    address,
                    [slot],
                    proofNodes
                )
            );
            if (value === undefined) undecided.push(slot);
            else decided.push({ slot, value: value[0] });
        }
        return { decided, undecided };
    }

    /** What `prove` proves, or undefined when the held proof does not decide it. */
    private decided<T>(prove: () => T): T | undefined {
        try {
            return prove();
        } catch (error) {
            if (error instanceof StorageProofError) return undefined;
            throw error;
        }
    }
}
