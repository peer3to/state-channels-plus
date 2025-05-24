import { expect } from "chai";
import { AgnosticStorage } from "../../src/storage/AgnosticStorage";

const isBrowser = typeof window !== "undefined";

describe("AgnosticStorage", () => {
    describe("Memory-only mode", () => {
        let storage: AgnosticStorage<any>;

        beforeEach(async () => {
            storage = new AgnosticStorage();
            await storage.initialize();
        });

        it("has correct config", () => {
            const info = storage.getInfo();
            expect(info.persistent).to.be.false;
            expect(info.storeName).to.equal("default-store");
            expect(info.size).to.equal(0);
        });

        it("sets and gets values", async () => {
            await storage.set("key1", "value1");
            await storage.set("key2", { data: "object" });

            expect(await storage.get("key1")).to.equal("value1");
            expect(await storage.get("key2")).to.deep.equal({ data: "object" });
            expect(await storage.get("nonexistent")).to.be.null;
        });

        it("updates atomically", async () => {
            const result1 = await storage.update(
                "counter",
                (current) => (current || 0) + 1
            );
            expect(result1).to.equal(1);
            expect(await storage.get("counter")).to.equal(1);

            const result2 = await storage.update(
                "counter",
                (current) => (current || 0) + 5
            );
            expect(result2).to.equal(6);
            expect(await storage.get("counter")).to.equal(6);
        });

        it("removes and clears", async () => {
            await storage.set("key1", "value1");
            await storage.set("key2", "value2");

            expect(await storage.has("key1")).to.be.true;
            await storage.remove("key1");
            expect(await storage.has("key1")).to.be.false;
            expect(await storage.get("key1")).to.be.null;

            expect(await storage.length()).to.equal(1);
            await storage.clear();
            expect(await storage.length()).to.equal(0);
        });
    });

    (isBrowser ? describe : describe.skip)(
        "Persistent mode (Browser only)",
        () => {
            let storage: AgnosticStorage<any>;
            const storeName =
                "test-store-" + Math.random().toString(36).substr(2, 9);

            beforeEach(async () => {
                storage = new AgnosticStorage({ persist: true, storeName });
                await storage.initialize();
                await storage.clear({ wait: true });
            });

            afterEach(async () => {
                try {
                    await storage.clear({ wait: true });
                } catch (error) {
                    // ignore cleanup errors
                }
            });

            it("has correct config", () => {
                const info = storage.getInfo();
                expect(info.persistent).to.be.true;
                expect(info.storeName).to.equal(storeName);
            });

            it("persists across instances", async () => {
                await storage.set("persistent-key", "persistent-value", {
                    wait: true
                });

                const newStorage = new AgnosticStorage({
                    persist: true,
                    storeName
                });
                await newStorage.initialize();

                expect(await newStorage.get("persistent-key")).to.equal(
                    "persistent-value"
                );

                await newStorage.clear({ wait: true });
            });

            it("handles fast vs wait ops", async () => {
                await storage.set("fast-key", "fast-value");
                expect(await storage.get("fast-key")).to.equal("fast-value");

                await storage.set("wait-key", "wait-value", { wait: true });
                expect(await storage.get("wait-key")).to.equal("wait-value");
            });
        }
    );

    describe("Bulk operations", () => {
        let storage: AgnosticStorage<string>;

        beforeEach(async () => {
            storage = new AgnosticStorage<string>();
            await storage.initialize();

            await storage.set("key1", "value1");
            await storage.set("key2", "value2");
            await storage.set("key3", "value3");
        });

        it("returns all keys", async () => {
            const keys = await storage.keys();
            expect(keys).to.have.length(3);
            expect(keys).to.include.members(["key1", "key2", "key3"]);
        });

        it("returns all values", async () => {
            const values = await storage.values();
            expect(values).to.have.length(3);
            expect(values).to.include.members(["value1", "value2", "value3"]);
        });

        it("returns all entries", async () => {
            const entries = await storage.entries();
            expect(entries).to.have.length(3);
            expect(entries).to.deep.include.members([
                ["key1", "value1"],
                ["key2", "value2"],
                ["key3", "value3"]
            ]);
        });

        it("tracks length correctly", async () => {
            expect(await storage.length()).to.equal(3);

            await storage.remove("key1");
            expect(await storage.length()).to.equal(2);

            await storage.clear();
            expect(await storage.length()).to.equal(0);
        });
    });

    describe("Type safety", () => {
        interface TestUser {
            id: number;
            name: string;
            active: boolean;
        }

        let userStorage: AgnosticStorage<TestUser>;

        beforeEach(async () => {
            userStorage = new AgnosticStorage<TestUser>();
            await userStorage.initialize();
        });

        it("works with complex objects", async () => {
            const user: TestUser = { id: 1, name: "John", active: true };

            await userStorage.set("user1", user);
            const retrieved = await userStorage.get("user1");

            expect(retrieved).to.deep.equal(user);
            expect(retrieved?.id).to.equal(1);
            expect(retrieved?.name).to.equal("John");
            expect(retrieved?.active).to.be.true;
        });

        it("handles typed updates", async () => {
            const user: TestUser = { id: 1, name: "John", active: false };
            await userStorage.set("user1", user);

            const updatedUser = await userStorage.update(
                "user1",
                (current) => ({
                    ...current!,
                    active: true,
                    name: "John Doe"
                })
            );

            expect(updatedUser.active).to.be.true;
            expect(updatedUser.name).to.equal("John Doe");
            expect(updatedUser.id).to.equal(1);
        });
    });

    describe("Edge cases", () => {
        let storage: AgnosticStorage<any>;

        beforeEach(async () => {
            storage = new AgnosticStorage();
            await storage.initialize();
        });

        it("handles null values", async () => {
            await storage.set("null-key", null);
            expect(await storage.get("null-key")).to.equal(null);
        });

        it("handles complex nested objects", async () => {
            const complexObject = {
                users: [
                    {
                        id: 1,
                        profile: { name: "John", settings: { theme: "dark" } }
                    },
                    {
                        id: 2,
                        profile: { name: "Jane", settings: { theme: "light" } }
                    }
                ],
                metadata: {
                    version: "1.0",
                    created: new Date().toISOString()
                }
            };

            await storage.set("complex", complexObject);
            const retrieved = await storage.get("complex");

            expect(retrieved).to.deep.equal(complexObject);
            expect(retrieved.users).to.have.length(2);
            expect(retrieved.users[0].profile.settings.theme).to.equal("dark");
        });

        it("syncs gracefully", async () => {
            await storage.set("key1", "value1");
            await storage.set("key2", "value2");

            await storage.sync();

            expect(await storage.get("key1")).to.equal("value1");
            expect(await storage.get("key2")).to.equal("value2");
        });

        it("ignores wait on memory-only", async () => {
            await storage.set("key", "value", { wait: true });
            await storage.remove("key", { wait: true });
            await storage.clear({ wait: true });

            expect(await storage.length()).to.equal(0);
        });
    });
});
