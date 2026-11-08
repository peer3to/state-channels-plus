import {
    assertApplicationEventReachesClient,
    assertBundledHostRootAppliesPeerConfig,
    assertDefaultHostRootStarts,
    assertDisposalRejectsRunningCall,
    assertFailedBuildRepliesPromptly,
    assertManifestHostRootServesProbe,
    assertNonClassManifestRejects,
    assertSecondDeployCompleteRejects,
    assertServiceErrorKeepsIdentity
} from "@test/fixtures/hostRoot/ApplicationHostRootFixture";
import { probeHostRootManifest } from "@test/fixtures/hostRoot/ProbeHostRootManifest";
import { checkPreDeploymentRequest } from "@test/fixtures/P2pRuntimeHostReadinessStaging";

describe("ApplicationHostRoot", function () {
    it("a host root loaded by manifest serves its own internal service in a worker", async function () {
        await assertManifestHostRootServesProbe(true);
    });
    it("a host root loaded by manifest serves its own internal service inline", async function () {
        await assertManifestHostRootServesProbe(false);
    });
    it("without a manifest the default host root starts in a worker", async function () {
        await assertDefaultHostRootStarts(true);
    });
    it("without a manifest the default host root starts inline", async function () {
        await assertDefaultHostRootStarts(false);
    });
    it("a manifest whose export is not a class rejects setup in a worker", async function () {
        await assertNonClassManifestRejects(true);
    });
    it("a manifest whose export is not a class rejects setup inline", async function () {
        await assertNonClassManifestRejects(false);
    });
    it("a failed build answers the setup promptly in a worker", async function () {
        await assertFailedBuildRepliesPromptly(true);
    });
    it("a failed build answers the setup promptly inline", async function () {
        await assertFailedBuildRepliesPromptly(false);
    });
    it("rejects with the service error's name, message and code in a worker", async function () {
        await assertServiceErrorKeepsIdentity(true);
    });
    it("rejects with the service error's name, message and code inline", async function () {
        await assertServiceErrorKeepsIdentity(false);
    });
    it("rejects a service call before the runtime is built", async function () {
        await checkPreDeploymentRequest(
            (connection) => connection.probe.echo("early").request(),
            false,
            probeHostRootManifest()
        );
    });
    it("rejects a running service call and a later one at disposal in a worker", async function () {
        await assertDisposalRejectsRunningCall(true);
    });
    it("an application event emitted in the runtime reaches the client listener with its args in a worker", async function () {
        await assertApplicationEventReachesClient(true);
    });
    it("an application event emitted in the runtime reaches the client listener with its args inline", async function () {
        await assertApplicationEventReachesClient(false);
    });
    it("rejects a second deployComplete and keeps the original runtime serving in a worker", async function () {
        await assertSecondDeployCompleteRejects(true);
    });
    it("a worker host root compiled apart from the SDK reads its peer's config from its own config module", async function () {
        await assertBundledHostRootAppliesPeerConfig();
    });
});
