import { expect } from "chai";

import { InMemoryPersistencePort } from "@/storage/persistence/InMemoryPersistencePort";
import { PersistRecord } from "@/storage/persistence/PersistencePort";

async function collect(
    iterable: AsyncIterable<PersistRecord>
): Promise<PersistRecord[]> {
    const records: PersistRecord[] = [];
    for await (const record of iterable) {
        records.push(record);
    }
    return records;
}

describe("InMemoryPersistencePort", function () {
    it("commit then load round-trips a put in the right namespace", async function () {
        const port = new InMemoryPersistencePort();

        await port.commit([
            { namespace: "n", type: "put", key: "k", encoded: "0x01" }
        ]);

        const records = await collect(port.load("n"));
        expect(records).to.deep.equal([{ key: "k", encoded: "0x01" }]);
    });

    it("del removes a previously committed key", async function () {
        const port = new InMemoryPersistencePort();

        await port.commit([
            { namespace: "n", type: "put", key: "k", encoded: "0x01" }
        ]);
        await port.commit([{ namespace: "n", type: "del", key: "k" }]);

        const records = await collect(port.load("n"));
        expect(records).to.deep.equal([]);
    });

    it("load is namespace-scoped", async function () {
        const port = new InMemoryPersistencePort();

        await port.commit([
            { namespace: "n1", type: "put", key: "k", encoded: "0x01" },
            { namespace: "n2", type: "put", key: "k", encoded: "0x02" }
        ]);

        const records = await collect(port.load("n1"));
        expect(records).to.deep.equal([{ key: "k", encoded: "0x01" }]);
    });

    it("prune drops records failing the keep predicate", async function () {
        const port = new InMemoryPersistencePort();

        await port.commit([
            { namespace: "n", type: "put", key: "keep", encoded: "0x01" },
            { namespace: "n", type: "put", key: "drop", encoded: "0x02" }
        ]);

        await port.prune("n", (r) => r.key === "keep");

        const records = await collect(port.load("n"));
        expect(records).to.deep.equal([{ key: "keep", encoded: "0x01" }]);
    });
});
