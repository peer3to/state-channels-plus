import { expect } from "chai";

import {
    convertEthersValue,
    createEthersResultProxy
} from "@/utils/EthersResultProxy";
import {
    createEthersNamedResult,
    EthersResultProxyContractFixture,
    EthersResultProxyEventLog
} from "@test/fixtures/EthersResultProxyFixture";

describe("EthersResultProxy", function () {
    it("recursively converts Results in arrays and plain objects while retaining clean branches", function () {
        const result = createEthersNamedResult();
        const cleanBranch = { status: "ready" };
        const input = {
            cleanBranch,
            nested: [result]
        };

        const converted = convertEthersValue(input);

        expect(converted).to.deep.equal({
            cleanBranch,
            nested: [
                {
                    amount: 3n,
                    owner: "0x0000000000000000000000000000000000000001"
                }
            ]
        });
        expect(converted).to.not.equal(input);
        expect(converted.cleanBranch).to.equal(cleanBranch);
    });

    it("converts a synchronous direct method result", function () {
        const fixture = new EthersResultProxyContractFixture(
            createEthersNamedResult()
        );
        const contract = createEthersResultProxy(fixture);

        expect(contract.read()).to.deep.equal({
            amount: 3n,
            owner: "0x0000000000000000000000000000000000000001"
        });
    });

    it("converts an asynchronous direct method result", async function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        fixture.directResult = Promise.resolve(createEthersNamedResult(4n));
        const contract = createEthersResultProxy(fixture);

        expect(await contract.read()).to.deep.equal({
            amount: 4n,
            owner: "0x0000000000000000000000000000000000000001"
        });
    });

    it("converts a staticCall result", async function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        fixture.staticResult = Promise.resolve(createEthersNamedResult(5n));
        const contract = createEthersResultProxy(fixture);

        expect(await contract.read.staticCall()).to.deep.equal({
            amount: 5n,
            owner: "0x0000000000000000000000000000000000000001"
        });
    });

    it("converts Result arguments before direct and static calls", function () {
        const result = createEthersNamedResult(6n);
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);

        contract.read(result);
        contract.read.staticCall([result]);

        expect(fixture.directArgs).to.deep.equal([
            {
                amount: 6n,
                owner: "0x0000000000000000000000000000000000000001"
            }
        ]);
        expect(fixture.staticArgs).to.deep.equal([
            [
                {
                    amount: 6n,
                    owner: "0x0000000000000000000000000000000000000001"
                }
            ]
        ]);
    });

    it("preserves method properties and invokes wrapped calls with the contract receiver", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);

        contract.read();
        contract.read.staticCall();

        expect(contract.read.methodTag).to.equal("read-method");
        expect(fixture.directReceiver).to.equal(fixture);
        expect(fixture.staticReceiver).to.equal(fixture);
    });

    it("propagates a wrapped method rejection unchanged", async function () {
        const failure = new Error("read failed");
        const fixture = new EthersResultProxyContractFixture(undefined);
        fixture.directResult = Promise.reject(failure);
        const contract = createEthersResultProxy(fixture);

        let caught: unknown;
        try {
            await contract.read();
        } catch (cause) {
            caught = cause;
        }

        expect(caught).to.equal(failure);
    });

    it("converts on listener arguments and preserves event-log identity fields", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);
        const received: unknown[] = [];
        contract.on("value", (...args: unknown[]) => received.push(...args));

        fixture.emit(
            "value",
            createEthersNamedResult(7n),
            new EthersResultProxyEventLog(createEthersNamedResult(8n))
        );

        expect(received[0]).to.deep.equal({
            amount: 7n,
            owner: "0x0000000000000000000000000000000000000001"
        });
        expect(received[1]).to.be.instanceOf(EthersResultProxyEventLog);
        expect((received[1] as EthersResultProxyEventLog).eventName).to.equal(
            "ValueChanged"
        );
        expect((received[1] as EthersResultProxyEventLog).args).to.deep.equal({
            amount: 8n,
            owner: "0x0000000000000000000000000000000000000001"
        });
    });

    it("keeps once listener semantics while converting arguments", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);
        const received: unknown[] = [];
        contract.once("value", (value: unknown) => received.push(value));

        fixture.emit("value", createEthersNamedResult(9n));
        fixture.emit("value", createEthersNamedResult(10n));

        expect(received).to.deep.equal([
            {
                amount: 9n,
                owner: "0x0000000000000000000000000000000000000001"
            }
        ]);
    });

    it("converts addListener arguments", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);
        let received: unknown;
        contract.addListener("value", (value: unknown) => {
            received = value;
        });

        fixture.emit("value", createEthersNamedResult(11n));

        expect(received).to.deep.equal({
            amount: 11n,
            owner: "0x0000000000000000000000000000000000000001"
        });
    });

    it("keeps prependListener ordering while converting arguments", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);
        const order: string[] = [];
        contract.on("value", () => order.push("normal"));
        contract.prependListener("value", (value: unknown) => {
            expect(value).to.deep.equal({
                amount: 12n,
                owner: "0x0000000000000000000000000000000000000001"
            });
            order.push("prepended");
        });

        fixture.emit("value", createEthersNamedResult(12n));

        expect(order).to.deep.equal(["prepended", "normal"]);
    });

    it("keeps prependOnceListener ordering and one-shot semantics", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);
        const order: string[] = [];
        contract.on("value", () => order.push("normal"));
        contract.prependOnceListener("value", () => order.push("once"));

        fixture.emit("value", createEthersNamedResult());
        fixture.emit("value", createEthersNamedResult());

        expect(order).to.deep.equal(["once", "normal", "normal"]);
    });

    it("removes an on listener through its original callback", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);
        let calls = 0;
        const listener = () => {
            calls += 1;
        };
        contract.on("value", listener);

        contract.off("value", listener);
        fixture.emit("value", createEthersNamedResult());

        expect(calls).to.equal(0);
    });

    it("removes repeated registrations through the original callback", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);
        let calls = 0;
        const listener = () => {
            calls += 1;
        };
        contract.addListener("value", listener);
        contract.addListener("value", listener);

        contract.removeListener("value", listener);
        contract.removeListener("value", listener);
        fixture.emit("value", createEthersNamedResult());

        expect(calls).to.equal(0);
    });

    it("converts every event log returned by queryFilter", async function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        fixture.queryResult = [
            new EthersResultProxyEventLog(createEthersNamedResult(13n)),
            new EthersResultProxyEventLog(createEthersNamedResult(14n))
        ];
        const contract = createEthersResultProxy(fixture);

        const logs =
            (await contract.queryFilter()) as EthersResultProxyEventLog[];

        expect(logs[0]).to.be.instanceOf(EthersResultProxyEventLog);
        expect(logs[0].args).to.deep.equal({
            amount: 13n,
            owner: "0x0000000000000000000000000000000000000001"
        });
        expect(logs[1].args).to.deep.equal({
            amount: 14n,
            owner: "0x0000000000000000000000000000000000000001"
        });
    });

    it("returns a non-array queryFilter result unchanged", async function () {
        const unchanged = { status: "pending" };
        const fixture = new EthersResultProxyContractFixture(undefined);
        fixture.queryResult = unchanged;
        const contract = createEthersResultProxy(fixture);

        expect(await contract.queryFilter()).to.equal(unchanged);
    });

    it("passes ordinary methods and non-function properties through", function () {
        const fixture = new EthersResultProxyContractFixture(undefined);
        const contract = createEthersResultProxy(fixture);

        expect(contract.marker).to.equal("fixture-contract");
        expect(contract.ordinaryMethod()).to.equal(contract);
    });
});
