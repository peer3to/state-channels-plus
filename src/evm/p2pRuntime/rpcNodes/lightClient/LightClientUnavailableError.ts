/** The light client cannot answer now; the request goes to the RPC node. */
export class LightClientUnavailableError extends Error {}

/**
 * The call would run here differently from the node (an address the chain
 * serves with its own precompile, a failure only the chain's gas accounting
 * can decide): the whole top-level call goes to the node. Nothing failed.
 */
export class NotLocalError extends LightClientUnavailableError {}
