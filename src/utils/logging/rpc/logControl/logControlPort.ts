import type { WorkerLink } from "@/rpc/WorkerLinks";
import { config } from "@/utils/config";
import type { LogControlPort } from "@/utils/logging/logControl";
import type { LogControlService } from "./LogControlService";

/** the far end of a link as a log port: the collection is one call answered
 *  with the subtree's totals, the context a cast */
export function logControlPortOver(link: WorkerLink): LogControlPort {
    const far = link.router.endpoint<{ logControl: LogControlService }>(
        link.transport,
        ["logControl"]
    );
    return {
        remoteRealm: link.remoteRealm,
        // read per call: config is reassigned during worker startup
        flush: (reason) =>
            far.logControl
                .flush(reason)
                .request({ timeoutMs: config.CRASH_LOG_FLUSH_TIMEOUT_MS }),
        postContext: (context) =>
            far.logControl.contextUpdate(context).sendOne()
    };
}
