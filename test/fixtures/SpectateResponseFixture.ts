import type { SpectateResponse } from "@/rpc/network/services/spectate/SpectateService";
import type { Bytes } from "@/types/types";

/** The payload of a served sync request; a still-syncing responder fails the test. */
export function servedSyncPayload(response: SpectateResponse): Bytes {
    if (!("encodedSyncPayload" in response)) {
        throw new Error("responder is still in its own initial sync");
    }
    return response.encodedSyncPayload;
}
