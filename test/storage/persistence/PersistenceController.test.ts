import {
    PersistenceController,
    PersistentCollection
} from "@/storage/persistence";
import { GatedMemoryLevel } from "@test/fixtures/GatedMemoryLevel";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

const RECORD = "records!v1!stateMachineStates!";

type States = PersistentCollection<string, "stateMachineStates">;

/** a controller with one collection over a gated memory database; the timer is off unless asked */
function build(flushIntervalMs = 60_000, onLoad?: () => void) {
    const controller = new PersistenceController({
        flushIntervalMs,
        maxRetries: 2
    });
    const states: States = new PersistentCollection(
        "stateMachineStates",
        controller,
        onLoad
    );
    const failures: Error[] = [];
    const open = (database: GatedMemoryLevel) =>
        controller.open(database.handle(), (error) => failures.push(error));
    return { controller, states, failures, open };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error("expected a rejection");
}

describe("PersistenceController", function () {
    it("writes one synchronous step of many writes, past the pending-size warning, as one batch with one operation per key", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build();
        await open(database);

        for (let index = 0; index < 2_500; index++) {
            states.set(`key-${index}`, "0x01");
            states.set(`key-${index}`, "0x02");
        }
        await controller.flush();

        expect(database.batches).to.have.length(1);
        expect(database.batches[0].operations).to.have.length(2_500);
        await controller.close();
    });

    it("replaces an earlier write to a key in the same window, and a set then delete is one delete", async () => {
        const database = new GatedMemoryLevel();
        const first = build();
        await first.open(database);
        first.states.set("kept", "0x01");
        first.states.set("kept", "0x02");
        first.states.set("dropped", "0x03");
        first.states.delete("dropped");
        await first.controller.close();

        expect(database.batches).to.have.length(1);
        expect(
            database.batches[0].operations.map(({ type, key }) => [type, key])
        ).to.deep.equal([
            ["put", `${RECORD}kept`],
            ["del", `${RECORD}dropped`]
        ]);
        const second = build();
        await second.open(database);
        expect([...second.states.entries()]).to.deep.equal([["kept", "0x02"]]);
        await second.controller.close();
    });

    it("writes pending state on flush without waiting for the timer, resolves only once the disk confirms, and resolves at once with nothing pending", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build();
        await open(database);
        database.hold();

        states.set("a", "0x01");
        let flushed = false;
        const flush = controller.flush().then(() => {
            flushed = true;
        });
        await tick();

        expect(database.batches).to.have.length(1);
        expect(database.batches[0].committed).to.equal(false);
        expect(flushed).to.equal(false);
        database.release();
        await flush;
        expect(database.batches[0].committed).to.equal(true);
        expect(await database.get(`${RECORD}a`)).to.not.equal(undefined);
        // nothing pending: no batch
        await controller.flush();
        expect(database.batches).to.have.length(1);
        await controller.close();
    });

    it("resolves a flush at once when nothing is pending, with or without a disk", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build();
        states.set("memory-only", "0x01");
        await controller.flush();
        await open(database);
        // the late bind writes what memory held
        await controller.flush();
        const batchesAfterBind = database.batches.length;

        await controller.flush();

        expect(batchesAfterBind).to.equal(1);
        expect(database.batches).to.have.length(batchesAfterBind);
        await controller.close();
    });

    it("resolves a flush issued while a batch is in flight only after the batch that covers its writes", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build();
        await open(database);
        database.hold();
        states.set("a", "0x01");
        const firstFlush = controller.flush();
        await tick();
        states.set("b", "0x02");
        let secondFlushed = false;
        const secondFlush = controller.flush().then(() => {
            secondFlushed = true;
        });
        await tick();
        expect(database.batches).to.have.length(1);
        expect(secondFlushed).to.equal(false);

        database.release();
        await firstFlush;
        await secondFlush;

        expect(database.batches).to.have.length(2);
        expect(database.batches[1].committed).to.equal(true);
        expect(database.batches[1].operations[0].key).to.equal(`${RECORD}b`);
        await controller.close();
    });

    it("syncs the batch a flush waits for, also when a timer batch already wrote the flush's writes, and never a timer batch", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build(5);
        await open(database);

        states.set("timer", "0x01");
        await waitFor(
            () => database.batches[0]?.committed === true,
            undefined,
            5
        );
        states.set("flushed", "0x02");
        await controller.flush();

        // the timer wrote this one too: the flush still waits for a synced batch
        states.set("timer-again", "0x03");
        await waitFor(
            () => database.batches[2]?.committed === true,
            undefined,
            5
        );
        database.hold();
        let flushed = false;
        const flush = controller.flush().then(() => {
            flushed = true;
        });
        await tick();
        expect(flushed).to.equal(false);
        database.release();
        await flush;

        expect(database.batches.map(({ sync }) => sync)).to.deep.equal([
            false,
            true,
            false,
            true
        ]);
        expect(database.batches[3].committed).to.equal(true);
        // that synced batch writes no record
        expect(
            database.batches[3].operations.map(({ type }) => type)
        ).to.deep.equal(["del"]);
        await controller.close();
    });

    it("retries a failed batch and writes it", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, failures, open } = build();
        await open(database);
        database.failNext(1);

        states.set("a", "0x01");
        await controller.flush();

        expect(database.batches).to.have.length(2);
        expect(await database.get(`${RECORD}a`)).to.not.equal(undefined);
        expect(failures).to.have.length(0);
        await controller.close();
    });

    it("fails after its retries: waiting flushes reject, the failure handler runs once, later writes stay in memory and close still closes the database", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, failures, open } = build();
        await open(database);
        database.failNext(3);

        states.set("a", "0x01");
        const error = await rejection(controller.flush());
        states.set("b", "0x02");
        const laterError = await rejection(controller.flush());

        expect(error.message).to.include("memory:gated");
        expect(laterError).to.equal(error);
        expect(failures).to.deep.equal([error]);
        expect(database.batches).to.have.length(3);
        expect(states.get("b")).to.equal("0x02");
        expect(await database.get(`${RECORD}a`)).to.equal(undefined);
        await controller.close();
        expect(database.status).to.equal("closed");
        expect(failures).to.have.length(1);
    });

    it("closes by draining pending writes, waiting for the last batch, then closing the database", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build();
        await open(database);
        database.hold();

        states.set("a", "0x01");
        const closed = controller.close();
        await tick();
        expect(database.status).to.equal("open");
        database.release();
        await closed;

        expect(database.batches[0].committed).to.equal(true);
        expect(database.status).to.equal("closed");
    });

    it("keeps a write made after close started off the disk while the close's batch is held", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build();
        await open(database);
        database.hold();

        states.set("a", "0x01");
        const closed = controller.close();
        states.set("late", "0x02");
        database.release();
        await closed;

        expect(states.get("late")).to.equal("0x02");
        expect(database.batches).to.have.length(1);
        await database.open();
        expect(await database.get(`${RECORD}a`)).to.not.equal(undefined);
        expect(await database.get(`${RECORD}late`)).to.equal(undefined);
        await database.close();
    });

    it("keeps a write after close in memory, raises no error and never writes it to disk", async () => {
        const database = new GatedMemoryLevel();
        const { controller, states, open } = build();
        await open(database);
        await controller.close();

        states.set("late", "0x01");
        await controller.flush();

        expect(states.get("late")).to.equal("0x01");
        expect(
            database.batches.flatMap(({ operations }) =>
                operations.map(({ key }) => key)
            )
        ).to.not.include(`${RECORD}late`);
        await database.open();
        expect(await database.get(`${RECORD}late`)).to.equal(undefined);
        await database.close();
    });

    it("loads records in their stored order and runs the load callback once", async () => {
        const database = new GatedMemoryLevel();
        const first = build();
        await first.open(database);
        first.states.set("a", "0x01");
        first.states.set("b", "0x02");
        first.states.set("c", "0x03");
        first.states.set("a", "0x0a");
        first.states.delete("b");
        first.states.set("b", "0x0b");
        await first.controller.close();

        let loads = 0;
        const second = build(60_000, () => loads++);
        await second.open(database);

        expect([...second.states.keys()]).to.deep.equal(["a", "c", "b"]);
        expect(second.states.get("a")).to.equal("0x0a");
        expect(loads).to.equal(1);
        await second.controller.close();
    });

    it("binds an empty disk late by keeping what memory holds and writing it", async () => {
        const database = new GatedMemoryLevel();
        const first = build();
        first.states.set("before-bind", "0x01");
        await first.open(database);
        expect(first.states.get("before-bind")).to.equal("0x01");
        await first.controller.close();

        const second = build();
        await second.open(database);
        expect(second.states.get("before-bind")).to.equal("0x01");
        await second.controller.close();
    });

    it("refuses a load when memory and disk both hold records, closes the database and leaves memory as it was", async () => {
        const database = new GatedMemoryLevel();
        const first = build();
        await first.open(database);
        first.states.set("on-disk", "0x01");
        await first.controller.close();

        const second = build();
        second.states.set("in-memory", "0x02");
        const error = await rejection(second.open(database));

        expect(error.message).to.include("already holds records");
        expect(error.message).to.include("memory:gated");
        expect(database.status).to.equal("closed");
        expect([...second.states.keys()]).to.deep.equal(["in-memory"]);
    });

    it("refuses an undecodable record naming its collection, key and location, closes the database and leaves memory empty", async () => {
        const database = new GatedMemoryLevel();
        await database.open();
        await database.put(`${RECORD}broken`, "0x1234");
        await database.close();

        const { states, open } = build();
        const error = await rejection(open(database));

        expect(error.message).to.include("stateMachineStates record broken");
        expect(error.message).to.include("memory:gated");
        expect(database.status).to.equal("closed");
        expect(states.size).to.equal(0);
    });

    it("refuses a record of an unknown collection", async () => {
        const database = new GatedMemoryLevel();
        await database.open();
        await database.put("records!v1!unknown!key", "0x");
        await database.close();

        const { open } = build();
        const error = await rejection(open(database));

        expect(error.message).to.include(
            "Unknown persisted collection unknown"
        );
        expect(database.status).to.equal("closed");
    });

    it("releases the database when close begins while the load is running", async () => {
        const database = new GatedMemoryLevel();
        const first = build();
        await first.open(database);
        first.states.set("a", "0x01");
        await first.controller.close();

        const second = build();
        const opening = second.open(database);
        const closing = second.controller.close();
        const error = await rejection(opening);
        await closing;

        expect(error.message).to.include("closed while opening");
        expect(database.status).to.equal("closed");
        expect(second.states.size).to.equal(0);
    });

    it("refuses a second open", async () => {
        const database = new GatedMemoryLevel();
        const { controller, open } = build();
        await open(database);

        const error = await rejection(open(new GatedMemoryLevel()));

        expect(error.message).to.include("already opened");
        await controller.close();
    });

    it("closes a database handed to an open that begins after close started", async () => {
        const database = new GatedMemoryLevel();
        await database.open();
        const { controller, open } = build();
        await controller.close();

        const error = await rejection(open(database));

        expect(error.message).to.include("already opened");
        expect(database.status).to.equal("closed");
    });

    it("unbinds after draining pending writes, keeps a database that holds records and binds another one with what memory holds", async () => {
        const first = new GatedMemoryLevel();
        const second = new GatedMemoryLevel();
        const { controller, states, open } = build();
        await open(first);
        states.set("a", "0x01");

        await controller.unbind();
        states.set("b", "0x02");
        await open(second);
        await controller.flush();

        expect(first.status).to.equal("closed");
        expect(first.batches).to.have.length(1);
        await first.open();
        expect(await first.get(`${RECORD}a`)).to.not.equal(undefined);
        expect(await first.get(`${RECORD}b`)).to.equal(undefined);
        await first.close();
        expect(await second.get(`${RECORD}a`)).to.not.equal(undefined);
        expect(await second.get(`${RECORD}b`)).to.not.equal(undefined);
        await controller.close();
    });

    it("closes an unbound database that holds no record and keeps its metadata", async () => {
        const database = new GatedMemoryLevel();
        const { controller, open } = build();
        await open(database);
        await database.put("metadata!identity", "channel");

        await controller.unbind();

        expect(database.status).to.equal("closed");
        await database.open();
        expect(await database.get("metadata!identity")).to.equal("channel");
        await database.close();
    });
});
