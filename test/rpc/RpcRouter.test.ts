import { adaptPort } from "@/evm/p2pRuntime/node/P2pRuntimeChannel";
import MessagePortTransport from "@/transport/MessagePortTransport";
import {
    linkedRouters,
    type ProbeEnd
} from "@test/fixtures/rpc/PortRpcProbe.fixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { MessageChannel } from "node:worker_threads";

/** what the logger of one end recorded, as messages */
function logged(end: ProbeEnd): string[] {
    return end.logStore.getAllLogs().map((entry) => entry.message);
}

describe("RpcRouter", function () {
    let link: ReturnType<typeof linkedRouters> | undefined;

    afterEach(function () {
        link?.close();
        link = undefined;
    });

    it("resolves a request with the far handler's return value", async function () {
        link = linkedRouters();

        const sum = await link.a.far.probe.sum(20, 22).request();

        expect(sum).to.equal(42);
        expect(link.b.router.localRpc.probe.calls).to.deep.equal([]);
    });

    it("rejects with the far error, its name, revert data and code restored", async function () {
        link = linkedRouters();

        let caught: (Error & { data?: string; code?: string }) | undefined;
        try {
            await link.a.far.probe.revert("0xdeadbeef").request();
        } catch (error) {
            caught = error as Error & { data?: string; code?: string };
        }

        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.equal("execution reverted");
        expect(caught!.data).to.equal("0xdeadbeef");
        expect(caught!.code).to.equal("CALL_EXCEPTION");
        expect(caught!.stack).to.include("revert");
    });

    it("times out with the router's default and clears the pending entry", async function () {
        link = linkedRouters({
            a: (router) => (router.requestTimeoutMs = () => 50)
        });

        let caught: Error | undefined;
        try {
            await link.a.far.probe.never().request();
        } catch (error) {
            caught = error as Error;
        }

        expect(caught?.message).to.equal(
            "RPC request 'probe.never' timed out after 50ms"
        );
        // a later request on the same line is unaffected by the stale entry
        expect(await link.a.far.probe.echo("after").request()).to.equal(
            "after"
        );
    });

    it("a null timeout outlives a handler slower than the default", async function () {
        link = linkedRouters({
            a: (router) => (router.requestTimeoutMs = () => 30)
        });

        const result = await link.a.far.probe
            .slow(120)
            .request({ timeoutMs: null });

        expect(result).to.equal("done");
    });

    it("closing a transport rejects its pending requests and nothing else", async function () {
        link = linkedRouters();
        const other = linkedRouters();

        const pending = link.a.far.probe.never().request();
        const untouched = other.a.far.probe.slow(60).request();
        link.b.transport.close(false);

        let caught: Error | undefined;
        try {
            await pending;
        } catch (error) {
            caught = error as Error;
        }
        expect(caught?.message).to.equal("RPC transport closed");
        expect(await untouched).to.equal("done");
        // the closed link logged what it still owed
        expect(logged(link.a)).to.include(
            "RPC transport closed with pending requests"
        );
        other.close();
    });

    it("refuses a request on a closed transport at once instead of timing out", async function () {
        link = linkedRouters();
        link.b.transport.close(true);
        link.a.transport.close(true);

        const started = Date.now();
        let caught: Error | undefined;
        try {
            // a null timeout would otherwise wait forever on a dropped post
            await link.a.far.probe.sum(1, 2).request({ timeoutMs: null });
        } catch (error) {
            caught = error as Error;
        }
        expect(caught?.message).to.equal(
            "RPC request 'probe.sum' refused: the transport is closed or disposed"
        );
        // refused before any timer, not after one
        expect(Date.now() - started).to.be.lessThan(1000);
    });

    it("answers an unknown service or method with an error and keeps the line", async function () {
        link = linkedRouters();
        // the far root has neither; the type is the only contract, so a stale
        // caller reaches both names at runtime
        const far = link.a.far as unknown as {
            missing: { anything(): { request(): Promise<unknown> } };
            probe: { nowhere(): { request(): Promise<unknown> } };
        };

        let service: Error | undefined;
        try {
            await far.missing.anything().request();
        } catch (error) {
            service = error as Error;
        }
        let method: Error | undefined;
        try {
            await far.probe.nowhere().request();
        } catch (error) {
            method = error as Error;
        }

        expect(service?.message).to.equal("Unknown RPC service 'missing'");
        expect(method?.message).to.equal(
            "Unknown RPC endpoint 'probe.nowhere'"
        );
        expect(await link.a.far.probe.echo("still up").request()).to.equal(
            "still up"
        );
    });

    it("delivers a one-way call and logs a throwing one-way handler without closing", async function () {
        link = linkedRouters();

        link.a.far.notice.notice({ n: 1 }).sendOne();
        link.a.far.notice.noticeThrows().sendOne();

        await waitFor(
            () => link!.b.router.localRpc.notice.received.length === 1,
            2000
        );
        expect(link.b.router.localRpc.notice.received).to.deep.equal([
            { n: 1 }
        ]);
        await waitFor(
            () => logged(link!.b).includes("Unhandled RPC handler exception"),
            2000
        );
        expect(await link.a.far.probe.echo("still up").request()).to.equal(
            "still up"
        );
    });

    it("runs every inbound dispatch inside the wrapper", async function () {
        let entered = 0;
        link = linkedRouters({
            b: (router) => {
                router.wrapInbound = (run) => {
                    entered += 1;
                    return run();
                };
            }
        });

        await link.a.far.probe.echo(1).request();
        link.a.far.notice.notice(2).sendOne();
        await waitFor(
            () => link!.b.router.localRpc.notice.received.length === 1,
            2000
        );

        // the request, the one-way call; the reply enters a's router, not b's
        expect(entered).to.equal(2);
    });

    it("a bigint and a byte array cross the line unchanged", async function () {
        link = linkedRouters();

        const value = { amount: 10n ** 20n, bytes: new Uint8Array([1, 2, 3]) };
        const echoed = await link.a.far.probe.echoBinary(value).request();

        expect(echoed.amount).to.equal(10n ** 20n);
        expect(echoed.bytes).to.be.instanceOf(Uint8Array);
        expect([...echoed.bytes]).to.deep.equal([1, 2, 3]);
    });

    it("request() with no target uses the router's only transport", async function () {
        link = linkedRouters();

        // no loopback on a port router and one line held -> that line is the
        // whole far end
        expect(link.a.router.transports.size).to.equal(1);
        expect(await link.a.far.probe.echo("only line").request()).to.equal(
            "only line"
        );
    });

    it("request() with no target and two transports rejects", async function () {
        link = linkedRouters();
        const spare = new MessageChannel();
        const second = new MessagePortTransport(
            adaptPort(spare.port1),
            link.a.router
        );

        let caught: Error | undefined;
        try {
            await link.a.far.probe.echo("ambiguous").request();
        } catch (error) {
            caught = error as Error;
        }

        expect(caught?.message).to.equal(
            "RpcHandler: 'probe.echo' needs a target: this router has no loopback and 2 transports"
        );
        // naming the line it wants still works
        expect(
            await link.a.far.probe.echo("named").request(link.a.transport)
        ).to.equal("named");
        second.close(true);
        spare.port2.close();
    });

    it("a targetless send on a closed line drops and a request refuses", async function () {
        link = linkedRouters();
        link.a.transport.close(true);

        // the only line is gone -> nothing to post to, and nothing thrown
        expect(link.a.router.transports.size).to.equal(0);
        link.a.far.notice.notice({ n: 1 }).sendOne();

        let caught: Error | undefined;
        try {
            await link.a.far.probe.echo("no line").request();
        } catch (error) {
            caught = error as Error;
        }
        expect(caught?.message).to.equal(
            "RPC request 'probe.echo' refused: the transport is closed or disposed"
        );
    });
});
