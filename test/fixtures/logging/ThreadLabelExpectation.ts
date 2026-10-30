// @spec-test-coverage-ignore: fixture support shared by the Node logger tests and the browser gate; executable evidence belongs to its calling test declarations.
import type { SharedLoggerContext } from "@/utils/logging/Logger";

/** Peer and component context every thread-label case renders with. */
export const THREAD_LABEL_PEER_ID = 3;
export const THREAD_LABEL_PEER_ADDRESS =
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const THREAD_LABEL_COMPONENT = "ThreadLabelTest";
/** Brackets and punctuation in the message must pass through unchanged. */
export const THREAD_LABEL_MESSAGE = "hand 7 settled: [pot] {chips: 3}";

export function threadLabelSharedContext(
    threadName: string | undefined
): SharedLoggerContext {
    return {
        peerId: THREAD_LABEL_PEER_ID,
        peerAddress: THREAD_LABEL_PEER_ADDRESS,
        ...(threadName === undefined ? {} : { threadName })
    };
}

/**
 * The whole rendered line, color codes removed: time, level, peer, exactly one
 * thread label, component, then the unchanged message.
 */
export function expectedThreadLabelLine(label: string): RegExp {
    const escape = (text: string) =>
        text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
        `^\\[\\d{2}:\\d{2}:\\d{2}\\]\\[INFO\\]` +
            escape(
                `[Peer ${THREAD_LABEL_PEER_ID}][${THREAD_LABEL_PEER_ADDRESS.slice(0, 8)}...]` +
                    `[${label}][${THREAD_LABEL_COMPONENT}] ${THREAD_LABEL_MESSAGE}`
            ) +
            "$"
    );
}
