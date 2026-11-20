import type {
    AccountStateRead,
    BlockEnvironment,
    ProvenAccountState,
    ProvenBlock
} from "./AProvenStateReader";
import type { LightClientStages } from "../lightClientWire";

/** What a partition decides of reads at its block. */
export type PartitionDecision = {
    /** The parts of the reads the held proof decides, each with what it proves. */
    decided: { read: AccountStateRead; proven: ProvenAccountState }[];
    /** The parts the held proof does not reach: a node must prove them. */
    undecided: AccountStateRead[];
};

/** A pushed block a partition took. */
export type AcceptedBlock = {
    block: ProvenBlock;
    sync: boolean;
    /** Keys whose value the message carried. */
    values: number;
    /** Proof nodes the message added. */
    newNodes: number;
    /** Proof nodes the partition holds now. */
    heldNodes: number;
    /** The stages the node gives for the block and the message. */
    stages: LightClientStages;
};

/**
 * The state a node pushes to one light client subscription, kept verified:
 * the values of the partition's keys at the last accepted block, and the proof
 * nodes that prove them under that block's state root. Each node kind pushes
 * its own proof representation: one subclass per representation.
 */
export default abstract class APushedPartition {
    /** The block whose state the partition holds; undefined before a sync or after a refusal. */
    abstract get block(): ProvenBlock | undefined;

    /** The block values a call reads, of {@link block}. */
    abstract get environment(): BlockEnvironment | undefined;

    /**
     * Takes the next message the node pushed to the subscription. Throws
     * {@link StorageProofError} when it is no such message, when it changes a
     * partition that was never synced, or when the proof the partition then
     * holds does not decide every held key as pushed; the partition then holds
     * nothing until the next sync.
     */
    abstract accept(message: unknown): AcceptedBlock;

    /** What the held proof decides of `reads` at {@link block}. */
    abstract decide(reads: AccountStateRead[]): PartitionDecision;
}
