import { expect } from "chai";
import { describe, it } from "mocha";

import Storage from "@/storage";
import { PersistenceEngine } from "@/storage/persistence/PersistenceEngine";

// Store field -> the schema id(s) it must be registered under. `disputes`
// covers two independent maps on the same DisputeStorage instance
// (disputes + disputedForks), so it maps to two ids.
const STORE_FIELD_SCHEMA_IDS: Record<string, string[]> = {
    blocks: ["blocks"],
    inboundMessages: ["inboundMessages"],
    outboundMessages: ["outboundMessages"],
    stateSnapshots: ["stateSnapshots"],
    stateMachineStates: ["stateMachineStates"],
    timeout: ["timeout"],
    forceExit: ["forceExit"],
    forceJoin: ["forceJoin"],
    fraudProofs: ["fraudProofs"],
    participantSetChanges: ["participantSetChanges"],
    disputes: ["disputes", "disputedForks"],
    disputeFraudProofs: ["disputeFraudProofs"],
    blockCalldata: ["blockCalldata"],
    eventSync: ["eventSync"]
};

// Permanent opt-out: QueueStorage is a transient CRDT reassembly buffer.
// Persisting it would mislead flood-detection after a restart.
const OPT_OUT = ["queues"];

// Stores still awaiting a schema. This list shrinks as later slices land; a
// store leaving it must gain a registered schema.
const PENDING_SCHEMA: string[] = [];

// Non-store infrastructure fields on Storage (not sub-stores). `rawBlocks` is
// the same underlying store as `blocks` (kept unproxied for the
// post-hydrate height-contiguity check), not a distinct sub-store.
const INFRASTRUCTURE = ["engine", "rawBlocks"];

function classify(field: string, registeredIds: ReadonlySet<string>): boolean {
    const schemaIds = STORE_FIELD_SCHEMA_IDS[field];
    const isRegistered =
        schemaIds !== undefined &&
        schemaIds.every((id) => registeredIds.has(id));
    const isAllowlisted =
        OPT_OUT.includes(field) || PENDING_SCHEMA.includes(field);
    return isRegistered || isAllowlisted;
}

describe("Storage persistence registration", () => {
    function engineOf(storage: Storage): PersistenceEngine {
        return (storage as unknown as { engine: PersistenceEngine }).engine;
    }

    it("every Storage sub-store is engine-registered or explicitly allowlisted", () => {
        const storage = new Storage();
        const registeredIds = engineOf(storage).registeredIds();

        const storeFields = Object.keys(storage).filter(
            (field) => !INFRASTRUCTURE.includes(field)
        );

        // Sanity: reflection actually saw the sub-stores (not an empty set).
        expect(storeFields).to.include("blocks");
        expect(storeFields.length).to.be.greaterThan(1);

        for (const field of storeFields) {
            expect(
                classify(field, registeredIds),
                `store '${field}' must be engine-registered or allowlisted`
            ).to.be.true;
        }
    });

    it("all persistence-covered stores are registered", () => {
        const storage = new Storage();
        const registeredIds = engineOf(storage).registeredIds();
        expect(Array.from(registeredIds).sort()).to.deep.equal(
            [
                "blocks",
                "inboundMessages",
                "outboundMessages",
                "stateSnapshots",
                "stateMachineStates",
                "timeout",
                "forceExit",
                "forceJoin",
                "fraudProofs",
                "participantSetChanges",
                "disputes",
                "disputedForks",
                "disputeFraudProofs",
                "blockCalldata",
                "eventSync"
            ].sort()
        );
    });

    it("a brand-new sub-store with neither registration nor allowlist entry fails loudly", () => {
        const storage = new Storage();
        const registeredIds = engineOf(storage).registeredIds();
        // A rogue store field, present in none of the three lists.
        expect(classify("rogueStore", registeredIds)).to.be.false;
    });
});
