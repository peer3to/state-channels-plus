import * as fs from "node:fs";
import * as path from "node:path";

import type { Logger } from "@/utils";

export type SharedDeploymentResolution = {
    value: string;
    source: "cache" | "deployed";
};

/**
 * Resolve a node-scoped shared deployment through a marker file: reuse a valid
 * marker, otherwise deploy and publish one for everyone after us.
 *
 * Deliberately lock-free. Concurrent first callers for the same key may each
 * deploy a copy — but they run at the same time and would otherwise WAIT the
 * same duration anyway, so coordinating them saves nothing while adding lock
 * ownership, heartbeat, and takeover failure modes. Each caller uses the
 * address it deployed; the marker keeps whichever landed last, and every later
 * caller reuses that one. The runner resets the cache dir on every node
 * (re)boot, so a marker can never describe a wiped chain.
 */
export async function resolveOrDeployShared(options: {
    cacheDir: string | undefined;
    markerName: string;
    /** Confirms a stored value still matches the live node (e.g. has code). */
    validate: (stored: string) => Promise<boolean>;
    deploy: () => Promise<string>;
    logger: Logger;
}): Promise<SharedDeploymentResolution> {
    const { cacheDir, markerName, validate, deploy, logger } = options;
    if (!cacheDir) {
        return { value: await deploy(), source: "deployed" };
    }
    const markerPath = path.join(cacheDir, markerName);

    try {
        const stored = fs.readFileSync(markerPath, "utf8").trim();
        if (stored.length > 0 && (await validate(stored))) {
            return { value: stored, source: "cache" };
        }
    } catch {
        // Missing or unreadable marker → deploy below.
    }

    const value = await deploy();
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(markerPath, value);
    } catch (error) {
        logger.debug(`Failed to write deployment marker (non-fatal): ${error}`);
    }
    return { value, source: "deployed" };
}
