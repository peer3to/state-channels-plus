// Wire payload/result shapes for the lobby's intent RPCs
// (LobbyRpcMethods.requestIntent/releaseIntent). What used to be a bespoke
// framed protocol (LobbyProtocol.ts) is now plain RPC method params/results -
// these types are all that survives of that file's wire vocabulary.
//
// Kept in `discovery/` (not under `rpc/services/lobby/`) so AdmissionPolicy.ts
// - a discovery-layer, RPC-agnostic module - can depend on
// `IntentDeclineReason` without reaching into the RPC layer.

export type IntentDeclineReason = "busy" | "full" | "terms" | "policy";

export type RequestIntentResult = {
    accepted: boolean;
    reason?: IntentDeclineReason;
    holdMs?: number;
    channelId?: string;
};

// releaseIntent is ACK'd, never fire-and-forget.
export type ReleaseIntentResult = { released: boolean };
