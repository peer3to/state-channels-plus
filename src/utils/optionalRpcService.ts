import type MainRpcService from "@/rpc/MainRpcService";

/**
 * Resolves an opt-in RPC service off `localRpc`.
 *
 * `MainRpcService` does not declare the opt-in services (a lobby, an
 * open-channel negotiation), because a deployment may not wire them. Reaching
 * for one directly would either not compile or throw at the call site, so this
 * narrows by constructor instead: absent means absent, present means the real
 * thing.
 *
 * One owner on purpose - the same lookup was previously written out at every
 * call site, each with its own structural cast of `localRpc`.
 */
export function getOptionalRpcService<T>(
    localRpc: MainRpcService,
    name: string,
    ctor: abstract new (...args: never[]) => T
): T | undefined {
    const candidate = (localRpc as unknown as Record<string, unknown>)[name];
    return candidate instanceof ctor ? candidate : undefined;
}
