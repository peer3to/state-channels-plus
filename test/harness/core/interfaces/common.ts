/** Worker-issued handle for restoring a stub install (see stubRoutes). */
export type RestoreTokenId = string;

/** Orchestrator-side closure id from StubCallbackRegistry (`stub#N`). */
export type StubCallbackId = string;

/** Orchestrator-side disconnect-filter id from StubCallbackRegistry (`filter#N`). */
export type FilterCallbackId = string;

/** Dotted path into StateManager for stubMethod (e.g. `disputeManager.constructDispute`). */
export type StubMethodPath = string;

/** `${serviceName}:${methodName}` slot key for createRpcMethod stubs. */
export type RpcStubSlotKey = string;

export type RestoreToken = { id: RestoreTokenId };
export type ConnectionId = string;
