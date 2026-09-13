// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { createLoggerSdkFixture } from "./LoggerServiceFixture";
import { startLogReceiver } from "../logging/LogUploader.fixture";
import { DetachedPromises } from "@/utils/DetachedPromises";
import { getErrorPeerAddress } from "@/utils/errorPeerAddress";
import { PeerIdentityExecutionContext } from "@test/harness/core/peerErrorAttribution";
import { expect } from "chai";
import { Wallet } from "ethers";

export async function assertInlineErrorIdentity(
    executor: boolean,
    asyncFailure: boolean
): Promise<void> {
    const receiver = await startLogReceiver();
    const sdk = await createLoggerSdkFixture(receiver, {
        inlineSdk: true,
        identityContext: true
    });
    try {
        const probe = sdk.remote.runtimeProbe;
        const request = executor
            ? probe.childFail(asyncFailure, "context failure").request()
            : asyncFailure
              ? probe.failAsync("context failure").request()
              : probe.failSync("context failure").request();
        const error = await request.catch((failure: unknown) => failure);
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("context failure");
        expect(getErrorPeerAddress(error)).to.equal(
            await sdk.instance.p2pSigner.getAddress()
        );
        expect(await probe.sum(3, 4).request()).to.equal(7);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
    } finally {
        try {
            await sdk.dispose();
        } finally {
            await receiver.close();
        }
    }
}

export async function assertDetachedInlineIdentity(
    executor: boolean
): Promise<void> {
    PeerIdentityExecutionContext.installDetachedPromiseRejectionStamping();
    const receiver = await startLogReceiver();
    const first = await createLoggerSdkFixture(receiver, {
        inlineSdk: true,
        identityContext: true
    });
    const second = await createLoggerSdkFixture(receiver, {
        inlineSdk: true,
        identityContext: true,
        signerSecret: Wallet.createRandom().privateKey
    });
    // Observe the real detached owner without draining unrelated SDK work.
    const pending = Reflect.get(DetachedPromises, "pending") as Array<{
        promise: Promise<unknown>;
        collectedAtStack?: string;
    }>;
    let owned: (typeof pending)[number] | undefined;
    try {
        const before = new Set(pending);
        const probe = first.remote.runtimeProbe;
        if (executor) await probe.childDetachFailure("identity").request();
        else await probe.detachFailure("identity").request();
        owned = pending.find(
            (entry) =>
                !before.has(entry) &&
                entry.collectedAtStack?.includes("detachFailure")
        );
        expect(owned !== undefined).to.equal(true);
        const failure = owned!.promise.catch((error: unknown) => error);
        const secondError = await second.remote.runtimeProbe
            .failAsync("other peer")
            .request()
            .catch((error: unknown) => error);
        expect(getErrorPeerAddress(secondError)).to.equal(
            await second.instance.p2pSigner.getAddress()
        );
        expect(await second.instance.p2pSigner.getAddress()).not.to.equal(
            await first.instance.p2pSigner.getAddress()
        );
        if (executor) await probe.childRelease("identity").request();
        else await probe.release("identity").request();
        const error = await failure;
        expect((error as Error).message).to.equal("detached identity");
        expect(getErrorPeerAddress(error)).to.equal(
            await first.instance.p2pSigner.getAddress()
        );
    } finally {
        if (owned) {
            const index = pending.indexOf(owned);
            if (index >= 0) pending.splice(index, 1);
        }
        try {
            await second.dispose();
            await first.dispose();
        } finally {
            await receiver.close();
        }
    }
}
