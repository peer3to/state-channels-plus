import { MirrorUnavailableError } from "@/evm/p2pRuntime/rpcNodes/mirror/MirrorUnavailableError";
import { SnapshotWaits } from "@/evm/p2pRuntime/rpcNodes/mirror/SnapshotWaits";
import { sleep } from "@/utils";
import { expect } from "chai";

const ACCOUNT = "0x" + "aa".repeat(20);

describe("SnapshotWaits", function () {
    // Mutation: forget leaves the read's entries, or removes a later read's.
    it("forgets the waits of a read that ends early, and only its own", function () {
        const waits = new SnapshotWaits(
            () => 1_000,
            () => false
        );
        const first = waits.expectSnapshots([ACCOUNT]);
        expect(waits.isAwaited(ACCOUNT)).to.equal(true);

        first.forget();
        expect(waits.isAwaited(ACCOUNT)).to.equal(false);

        waits.expectSnapshots([ACCOUNT]);
        first.forget();
        expect(waits.isAwaited(ACCOUNT)).to.equal(true);
    });

    // Mutation: settled returns at the backstop while a snapshot is still being placed.
    it("ends a wait past its backstop only once the snapshot being placed for it is placed", async function () {
        const waits = new SnapshotWaits(
            () => 20,
            () => false
        );
        const expected = waits.expectSnapshots([ACCOUNT]);
        let place!: () => void;
        waits.holdWhile(new Promise<void>((resolve) => (place = resolve)));

        let ended = false;
        const outcome = expected.settled().then(
            () => undefined,
            (error: unknown) => error
        );
        void outcome.finally(() => (ended = true));
        // time is the input: well past the 20 ms backstop
        await sleep(200);
        expect(ended, "the snapshot is still being placed").to.equal(false);
        place();

        expect(await outcome).to.be.instanceOf(MirrorUnavailableError);
    });
});
