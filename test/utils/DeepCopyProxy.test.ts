import { deepCopyProxy } from "@/utils";
import { expect } from "chai";

class Holder {
    public readonly value = { nested: { count: 1 } };
    public received?: { nested: { count: number } };

    public async read(): Promise<{ nested: { count: number } }> {
        return this.value;
    }

    public keep(argument: { nested: { count: number } }): void {
        this.received = argument;
    }
}

describe("deepCopyProxy", function () {
    it("copies the value an asynchronous read resolves to", async () => {
        const holder = new Holder();
        const proxy = deepCopyProxy(holder);

        const result = await proxy.read();
        result.nested.count = 99;

        expect(holder.value.nested.count).to.equal(1);
    });

    it("passes the arguments of a preserved method through uncopied", () => {
        const holder = new Holder();
        const proxy = deepCopyProxy(holder, {
            preserveArgumentsFor: new Set(["keep"])
        });
        const argument = { nested: { count: 1 } };

        proxy.keep(argument);

        expect(holder.received).to.equal(argument);
    });
});
