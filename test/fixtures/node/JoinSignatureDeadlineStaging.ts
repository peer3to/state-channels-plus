// @spec-test-coverage-ignore: local-clock staging for the exact join deadline boundary
import { Codec, SignatureUtils, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { expect } from "chai";

/** How far around the responder's clock reading the joiner pre-signs deadlines. */
const DEADLINE_SPAN_SECONDS = 30;

export async function assertJoinSignatureDeadlineBoundary(
    h: MathPeerTestHarness
) {
    await h.lifecycle.start(2, 0);
    const joiner = await h.join.addSpectatorWait();
    const responder = h.getPeer(0);
    const responderTime = await h.execOnHost(responder, async (_sm, _args, m) =>
        m.Clock.getTimeInSeconds()
    );
    // One signed request per deadline around the responder's clock, so the
    // responder can pick the exact one for the second it reads.
    const requests: Record<string, string> = {};
    for (
        let deadline = responderTime - DEADLINE_SPAN_SECONDS;
        deadline <= responderTime + DEADLINE_SPAN_SECONDS;
        deadline++
    ) {
        const signed = await SignatureUtils.signJoinChannel(
            {
                participant: joiner.address,
                channelId: h.channelId,
                balance: { amount: 500n, data: "0x00" },
                deadlineTimestamp: BigInt(deadline)
            },
            joiner.signer
        );
        requests[deadline] = String(
            Codec.encode(
                {
                    encodedJoinChannel: String(signed.encoded),
                    signature: String(signed.signature)
                },
                Type.SignedJoinChannel
            )
        );
    }
    const result = await h.execOnHost(
        responder,
        async (sm, args, m) => {
            const transport =
                sm.p2pManager.profileManager.getTransportByEvmAddress(
                    args.joiner
                );
            if (!transport) throw new Error("Expected connected joiner");
            const service = sm.p2pManager.localRpc.joinChannelService;
            const settle = (encoded: string | undefined) => {
                if (!encoded)
                    throw new Error("No request signed for this second");
                return service.signJoinRequest(transport, encoded).then(
                    (response) => String(response.signature),
                    (error: unknown) =>
                        error instanceof Error ? error.message : String(error)
                );
            };
            for (;;) {
                // signJoinRequest checks the deadline before its first await,
                // so both checks below read the clock in this synchronous run
                const now = m.Clock.getTimeInSeconds();
                const exact = settle(args.requests[now]);
                const late = settle(args.requests[now - 1]);
                const isSameSecond = m.Clock.getTimeInSeconds() === now;
                const outcomes = await Promise.all([exact, late]);
                if (isSameSecond) return { now, outcomes };
            }
        },
        { joiner: joiner.address, requests }
    );
    const {
        now,
        outcomes: [exact, late]
    } = result;
    const exactRequest = Codec.decode(requests[now], Type.SignedJoinChannel);
    // the request whose deadline is the responder's current second is signed
    expect(
        SignatureUtils.getSignerAddress(
            String(exactRequest.encodedJoinChannel),
            exact
        )
    ).to.equal(responder.address);
    expect(late).to.equal("requestJoinSignature: join expired");
}
