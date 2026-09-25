// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

export async function normalizeRealConfirmations(options: {
    strategy: "live" | "spectating" | "dispute" | "calldata";
    sharedBad?: boolean;
    internal?: boolean;
    malformedOnly?: boolean;
    duplicateBad?: boolean;
    invalidV?: boolean;
}) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 1);
    const bundle = await h
        .control(h.getPeer(0))
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!bundle) throw new Error("Expected a committed block");
    await waitFor(
        async () =>
            (await h
                .control(h.getPeer(0))
                .query.getQueuedRetention(bundle.hash)
                .request()) === null
    );
    const confirmation = Codec.decode(
        bundle.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const malformed = "0x" + "00".repeat(64) + (options.invalidV ? "ff" : "1b");
    const good = options.malformedOnly
        ? []
        : bundle.confirmationSignatures.filter(
              (signature) => signature !== confirmation.signedBlock.signature
          );
    const copies = [
        {
            encodedBlockConfirmation: String(
                Codec.encode(
                    {
                        signedBlock: confirmation.signedBlock,
                        signatures: [
                            malformed,
                            ...(options.duplicateBad ? [malformed] : []),
                            ...good
                        ]
                    },
                    Type.BlockConfirmation
                )
            ),
            source: options.internal ? undefined : h.getPeer(1).address
        }
    ];
    if (!options.internal)
        copies.push({
            encodedBlockConfirmation: String(
                Codec.encode(
                    {
                        signedBlock: confirmation.signedBlock,
                        signatures: [
                            ...(options.sharedBad ? [malformed] : []),
                            ...good
                        ]
                    },
                    Type.BlockConfirmation
                )
            ),
            source: h.getPeer(2).address
        });
    const result = await h
        .control(h.getPeer(0))
        .validation.normalizeConfirmationCopies(copies, options.strategy)
        .request();
    return {
        ...result,
        malformed,
        good,
        badSource: h.getPeer(1).address,
        otherSource: h.getPeer(2).address
    };
}
