// @spec-test-coverage-ignore: join lifetime staging exercised by explicit JoinChannel declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { Config } from "@/utils/config";

/**
 * A synced spectator of a two-participant channel prepares its real first
 * join. Returns the chain timestamp that preparation read and the deadline
 * the threshold signed.
 */
export async function prepareFirstJoinDeadline(
    h: MathPeerTestHarness,
    configOverrides?: Partial<Config>
): Promise<{ chainTimestamp: number; deadline: number; signatures: number }> {
    await h.lifecycle.start(2, 0, { configOverrides });
    const joiner = await h.join.addSpectatorWait();
    return await h.execOnHost(
        h.getPeer(joiner.index),
        async (sm) => {
            const service = sm.p2pManager.localRpc.joinChannelService;
            const provider = sm.signer.provider!;
            const getBlock = provider.getBlock;
            const collect = service.collectJoinChannelConfirmation;
            let chainRead: ReturnType<typeof getBlock> | undefined;
            let deadline: bigint | undefined;
            provider.getBlock = (...parameters) => {
                chainRead = getBlock.apply(provider, parameters);
                return chainRead;
            };
            service.collectJoinChannelConfirmation = (joinChannel) => {
                deadline = BigInt(joinChannel.deadlineTimestamp);
                return collect.call(service, joinChannel);
            };
            try {
                const preparing = service.prepareJoinChannelConfirmation({
                    amount: 500n,
                    data: "0x00"
                });
                // the preparation reads its chain time before its first await
                const read = chainRead;
                provider.getBlock = getBlock;
                const prepared = await preparing;
                const block = await read;
                if (!block || deadline === undefined)
                    throw new Error("Expected the preparation's chain read");
                return {
                    chainTimestamp: block.timestamp,
                    deadline: Number(deadline),
                    signatures: prepared.confirmation.signatures.length
                };
            } finally {
                provider.getBlock = getBlock;
                service.collectJoinChannelConfirmation = collect;
            }
        },
        {},
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}
