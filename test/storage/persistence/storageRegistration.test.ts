import { expect } from "chai";
import { describe, it } from "mocha";

import Storage from "@/storage";
import { PersistenceEngine } from "@/storage/persistence/PersistenceEngine";

// Store field -> the schema id it must be registered under.
const STORE_FIELD_SCHEMA_IDS: Record<string, string> = {
    blocks: "blocks",
    inboundMessages: "inboundMessages",
    outboundMessages: "outboundMessages",
    stateSnapshots: "stateSnapshots",
    stateMachineStates: "stateMachineStates",
    timeout: "timeout",
    forceExit: "forceExit",
    forceJoin: "forceJoin",
    fraudProofs: "fraudProofs"
};

// Permanent opt-out: QueueStorage is a transient CRDT reassembly buffer.
// Persisting it would mislead flood-detection after a restart.
const OPT_OUT = ["queues"];

// Stores still awaiting a schema (be-06). This list shrinks as later slices
// land; a store leaving it must gain a registered schema.
const PENDING_SCHEMA = [
    "participantSetChanges",
    "disputes",
    "disputeFraudProofs",
    "blockCalldata",
    "eventSync"
];

// Non-store infrastructure fields on Storage (not sub-stores).
const INFRASTRUCTURE = ["engine"];

function classify(field: string, registeredIds: ReadonlySet<string>): boolean {
    const schemaId = STORE_FIELD_SCHEMA_IDS[field];
    const isRegistered = schemaId !== undefined && registeredIds.has(schemaId);
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
                "fraudProofs"
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
