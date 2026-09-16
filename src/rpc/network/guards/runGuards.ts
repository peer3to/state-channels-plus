import type { AGuard } from "@/rpc/network/guards/AGuard";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * Runs guards sequentially.
 * - returns `true` if all guards pass
 * - returns `false` on the first failing guard (and calls `onFailure`)
 */
export function runGuards(
    guards: AGuard[],
    rpc: Rpc,
    transport: NetworkTransport
): boolean {
    for (const guard of guards) {
        if (guard.check(rpc, transport)) {
            continue;
        }
        guard.onFailure(rpc, transport);
        return false;
    }
    return true;
}
