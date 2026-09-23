// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { MathPeerTestHarness } from "./MathPeerTestHarness";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { ethers } from "ethers";

export async function observeSourceEligibility(
    h: MathPeerTestHarness,
    source: string,
    options: {
        refresh?: boolean;
        reset?: boolean;
        failRead?: boolean;
        lowercase?: boolean;
    } = {}
) {
    const peer = h.getPeer(0);
    const control = h.control(peer);
    await control.stub
        .observeAdmission({ failMembership: options.failRead })
        .request();
    try {
        const state = await h.execOnHost(
            peer,
            async (sm, args) => {
                if (args.reset) sm.membershipService.resetEligibility();
                const source = args.lowercase
                    ? args.source.toLowerCase()
                    : args.source;
                const before =
                    sm.membershipService.getCachedSourceEligibility(source);
                const result = args.refresh
                    ? await sm.membershipService.resolveSourceEligibility(
                          source
                      )
                    : sm.membershipService.getCachedSourceEligibility(source);
                return {
                    before,
                    result,
                    after: sm.membershipService.getCachedSourceEligibility(
                        source
                    )
                };
            },
            { source, ...options }
        );
        return {
            ...state,
            reads: await control.stub.getAdmissionObservation().request()
        };
    } finally {
        await control.stub.restoreAdmissionObservation().request();
    }
}

export async function concurrentUnknownEligibility() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 0);
    const peer = h.getPeer(0);
    const control = h.control(peer);
    await control.stub.observeAdmission({ holdMembership: true }).request();
    const sources = [
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
    ];
    const pending = h.execOnHost(
        peer,
        async (sm, args) =>
            Promise.all(
                args.sources.map((source) =>
                    sm.membershipService.resolveSourceEligibility(source)
                )
            ),
        { sources }
    );
    try {
        await waitFor(
            async () =>
                (await control.stub.getAdmissionObservation().request())
                    .chainReads >= 1
        );
        const beforeRelease = await control.stub
            .getAdmissionObservation()
            .request();
        await control.stub.releaseAdmissionMembership().request();
        const results = await pending;
        return {
            results,
            beforeRelease,
            afterRelease: await control.stub.getAdmissionObservation().request()
        };
    } finally {
        await control.stub.releaseAdmissionMembership().request();
        await pending;
        await control.stub.restoreAdmissionObservation().request();
    }
}

export async function observeSlashDuringRefresh() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 0);
    const peer = h.getPeer(0),
        control = h.control(peer);
    await control.stub.observeAdmission({ holdMembership: true }).request();
    const pending = h.execOnHost(peer, (sm) =>
        sm.membershipService.refreshOnChainEligibility()
    );
    try {
        await waitFor(
            async () =>
                (await control.stub.getAdmissionObservation().request())
                    .chainReads === 1
        );
        await h.execOnHost(
            peer,
            (sm, args) => sm.membershipService.observeOnChainSlash(args.source),
            { source: h.getPeer(1).address }
        );
        await control.stub.releaseAdmissionMembership().request();
        return {
            result: await pending,
            state: await control.query
                .getSourceEligibility(h.getPeer(1).address)
                .request(),
            reads: (await control.stub.getAdmissionObservation().request())
                .chainReads
        };
    } finally {
        await control.stub.releaseAdmissionMembership().request();
        await pending;
        await control.stub.restoreAdmissionObservation().request();
    }
}

/**
 * A refresh parked on its chain read while the runtime leaves the channel:
 * the read resumes after the reset and must write none of that channel's
 * membership into the runtime.
 */
export async function refreshOvertakenByReset() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 0);
    const peer = h.getPeer(0),
        control = h.control(peer);
    await control.stub.observeAdmission({ holdMembership: true }).request();
    const pending = h.execOnHost(peer, (sm) =>
        sm.membershipService.refreshOnChainEligibility()
    );
    try {
        await waitFor(
            async () =>
                (await control.stub.getAdmissionObservation().request())
                    .chainReads === 1
        );
        await h.execOnHost(peer, async (sm) => {
            await sm.resetChannel();
        });
        await control.stub.releaseAdmissionMembership().request();
        return {
            refreshed: await pending,
            membershipSyncs: (
                await control.stub.getAdmissionObservation().request()
            ).membershipSyncs
        };
    } finally {
        await control.stub.releaseAdmissionMembership().request();
        await pending;
        await control.stub.restoreAdmissionObservation().request();
    }
}

export async function eligibilityAppearsDuringRefresh() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 0, { maxChannelParticipants: 3 });
    const newcomer = ethers.Wallet.createRandom().address;
    const peer = h.getPeer(0),
        control = h.control(peer);
    await control.stub.observeAdmission({ holdMembership: true }).request();
    const pending = h.execOnHost(
        peer,
        (sm, args) =>
            sm.membershipService.resolveSourceEligibility(args.source),
        { source: newcomer }
    );
    try {
        await waitFor(
            async () =>
                (await control.stub.getAdmissionObservation().request())
                    .chainReads === 1
        );
        await h.transition.insertParticipantOffChain(newcomer, 0n, {
            waitForPeers: [0, 1],
            waitForFinalization: false
        });
        const beforeRelease = await control.query
            .getSourceEligibility(newcomer)
            .request();
        await control.stub.releaseAdmissionMembership().request();
        return {
            result: await pending,
            beforeRelease,
            after: await control.query.getSourceEligibility(newcomer).request()
        };
    } finally {
        await control.stub.releaseAdmissionMembership().request();
        await pending;
        await control.stub.restoreAdmissionObservation().request();
    }
}

export async function missingInboundEligibility() {
    const h = MathTestSession.getHarness();
    const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
    const observer = h.getPeer(0);
    const control = h.control(observer);
    const dropped = await h.rpcStub.dropInboundMessageLogs(observer.index);
    const blinded = await h.rpcStub.failChainLogQueries(observer.index);
    await control.stub.observeAdmission().request();
    try {
        await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        await dropped.waitUntilDropped();
        const result = await h.execOnHost(
            observer,
            async (sm, args) => {
                const before = args.sources.map((source) =>
                    sm.membershipService.getCachedSourceEligibility(source)
                );
                const result =
                    await sm.membershipService.resolveSourceEligibility(
                        args.joiner
                    );
                return {
                    before,
                    result,
                    after: args.sources.map((source) =>
                        sm.membershipService.getCachedSourceEligibility(source)
                    )
                };
            },
            {
                joiner: prepared.joiner.address,
                sources: [
                    h.getPeer(0).address,
                    h.getPeer(1).address,
                    prepared.joiner.address
                ]
            }
        );
        return {
            ...result,
            reads: await control.stub.getAdmissionObservation().request(),
            blacklisted: await control.query
                .isBlacklisted(prepared.joiner.address)
                .request()
        };
    } finally {
        await blinded.restore();
        await dropped.release();
        await control.stub.restoreAdmissionObservation().request();
    }
}
