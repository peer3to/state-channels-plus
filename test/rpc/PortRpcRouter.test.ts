import { expect } from "chai";

import {
    linkedRouters,
    type ProbeEnd
} from "@test/fixtures/rpc/PortRpcProbe.fixture";
import { waitFor } from "@test/utils/waitFor";

/** what the logger of one end recorded, as messages */
function logged(end: ProbeEnd): string[] {
    return end.logStore.getAllLogs().map((entry) => entry.message);
}

describe("PortRpcRouter", function () {
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
        link = linkedRouters({ a: { defaultTimeoutMs: 50 } });

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
        link = linkedRouters({ a: { defaultTimeoutMs: 30 } });

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
        expect(caught?.message).to.equal(
            "Worker link closed before the reply arrived"
        );
        expect(await untouched).to.equal("done");
        // the closed link logged what it still owed
        expect(logged(link.a)).to.include(
            "Worker link closed with pending requests"
        );
        other.close();
    });

    it("answers an unknown service or method with an error and keeps the line", async function () {
        link = linkedRouters();
        const far = link.a.far as unknown as {
            missing: { anything(): { request(): Promise<unknown> } };
            probe: { nowhere(): { request(): Promise<unknown> } };
        };
        // the manifest has no such service; forge the handle the way a stale
        // caller would
        const forged = link.a.router.endpoint<{ missing: never }>(
            link.a.transport,
            ["missing"] as never
        ) as unknown as typeof far;

        let service: Error | undefined;
        try {
            await forged.missing.anything().request();
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
            b: {
                wrapInbound: (run) => {
                    entered += 1;
                    return run();
                }
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

    it("logs a request that settles slower than the threshold", async function () {
        link = linkedRouters({ a: { slowRequestMs: 20 } });

        await link.a.far.probe.slow(40).request();
        await link.a.far.probe.echo("fast").request();

        const slow = link.a.logStore
            .getAllLogs()
            .filter(
                (entry) => entry.message === "Slow worker request completed"
            );
        expect(slow).to.have.length(1);
        expect(slow[0].meta[0].operation).to.equal("probe.slow");
    });

    it("holds inbound requests until released and dispatches them in order", async function () {
        link = linkedRouters();
        link.b.router.holdInbound();

        const first = link.a.far.probe.echo("first").request();
        const second = link.a.far.probe.echo("second").request();
        await new Promise((resolve) => setTimeout(resolve, 30));
        // nothing answered while held, and the far root saw nothing
        expect(link.b.router.localRpc.probe.calls).to.deep.equal([]);

        link.b.router.releaseInbound();

        expect(await first).to.equal("first");
        expect(await second).to.equal("second");
        expect(link.b.router.localRpc.probe.calls).to.deep.equal([
            "echo",
            "echo"
        ]);
    });
});
