import {
    assertMissingClientDependencies,
    assertParentedClientRoot,
    assertStandaloneBridge,
    assertDelayedHostInitialization,
    assertStandaloneRoot,
    assertWorkerNeedsParent,
    assertClientInitialization
} from "@test/fixtures/node/ClientRootInitializationFixture";
import {
    assertRootStartupFailureRecovery,
    assertExitDuringDisposal
} from "@test/fixtures/node/RootCreationStaging";
import {
    assertRootCreation,
    assertParentCloseDuringRootStartup,
    assertDisposingParentRejectsChild,
    assertMissingRootWorkerUrl,
    assertTopLevelRoot,
    assertRootCreationCloneFailure
} from "@test/fixtures/RootCreationFixture";

describe("RootCreation", () => {
    it("settles disposal when the worker exits before its acknowledgement", async () => {
        await assertExitDuringDisposal();
    });
    it("rejects inline child creation during and after parent disposal", async () => {
        await assertDisposingParentRejectsChild("inline");
    });
    it("rejects worker child creation during and after parent disposal", async () => {
        await assertDisposingParentRejectsChild("worker");
    });

    it("rejects missing client connection options before allocating a root", async () => {
        await assertMissingClientDependencies();
    });
    it("connects a parented inline client without application objects and acknowledges disposal", async () => {
        await assertParentedClientRoot();
    });
    it("cleans a host root when observation fails before parent attachment", async () => {
        await assertClientInitialization("host-observer");
    });
    it("initializes a standalone WebRTC broker and requires a callback recipient", async () => {
        await assertStandaloneBridge(true);
    });
    it("rejects a worker bridge without its required local factory and broker port", async () => {
        await assertStandaloneBridge(false);
    });
    it("cleans roots when client initialization observation fails", async () => {
        await assertClientInitialization("observer");
    });
    it("waits for a held inline host ready notification during client initialization", async () => {
        await assertDelayedHostInitialization(false);
    });
    it("waits for a held worker host ready notification during client initialization", async () => {
        await assertDelayedHostInitialization(true);
    });
    it("initializes a standalone executor before returning without parent connections", async () => {
        await assertStandaloneRoot(false);
    });
    it("cleans a standalone executor after initialization fails", async () => {
        await assertStandaloneRoot(true);
    });
    it("rejects worker creation without a parent before allocating a root", async () => {
        await assertWorkerNeedsParent();
    });
    it("returns encoded deployment call data through a real SDK worker", async () => {
        await assertClientInitialization(undefined, true);
    });
    it("keeps application setup pending through two independent deployments after client communication is ready", async () => {
        await assertClientInitialization();
    });
    it("cleans client and child roots when the first deployment fails", async () => {
        await assertClientInitialization(1);
    });
    it("cleans client and child roots when the second deployment fails", async () => {
        await assertClientInitialization(2);
    });
    it("rejects worker creation without an entry URL and keeps the SDK usable", async () => {
        await assertMissingRootWorkerUrl();
    });
    it("creates the local top-level root and its inline SDK child through the free function", async () => {
        await assertTopLevelRoot(true);
    });
    it("creates the local top-level root and its worker SDK child through the free function", async () => {
        await assertTopLevelRoot(false);
    });
    it("preserves a startup failure and creates another worker child on the same SDK owner", async () => {
        await assertRootStartupFailureRecovery();
    });
    it("returns an initialized inline child and preserves its SDK owner", async () => {
        await assertRootCreation("inline");
    });
    it("returns an initialized worker child and disposes it through its SDK owner", async () => {
        await assertRootCreation("worker");
    });
    it("rejects uncloneable inline startup arguments without leaking a connection", async () => {
        await assertRootCreationCloneFailure("inline");
    });
    it("rejects uncloneable worker startup arguments and releases the waiting worker", async () => {
        await assertRootCreationCloneFailure("worker");
    });
    it("cleans an inline child when its parent connection closes during startup", async () => {
        await assertParentCloseDuringRootStartup(true);
    });
    it("disposes an initialized inline child when its parent connection closes", async () => {
        await assertParentCloseDuringRootStartup(false);
    });
});
