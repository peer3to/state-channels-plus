import { AGuard } from "@/rpc/guards/AGuard";
import Rpc from "@/rpc/Rpc";
import ATransport from "@/transport/ATransport";

/**
 * Runs guards sequentially.
 * - returns `true` if all guards pass
 * - returns `false` on the first failing guard (and calls `onFailure`)
 */
export function runGuards(
    guards: AGuard[],
    rpc: Rpc,
    transport: ATransport
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
