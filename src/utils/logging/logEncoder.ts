export function encodePlainLog(logs: any[]): string {
    const lines: string[] = [];

    for (const log of logs) {
        const timestamp = new Date(log.ts).toISOString();
        const level = String(log.level).toUpperCase();
        const message = log.message;
        const component = log.component;
        const peerId = log.peerId;
        const peerAddress = log.peerAddress;

        // ---- header -------------------------------------------------------------

        const headerParts: string[] = [];
        headerParts.push(`[${timestamp}]`);
        headerParts.push(`[${level}]`);

        if (component) {
            headerParts.push(`[${component}]`);
        }

        if (peerAddress) {
            if (peerId != null) {
                headerParts.push(`[peer ${peerId}]`);
            }
            headerParts.push(`[${peerAddress.slice(0, 8)}…]`);
        }

        lines.push(headerParts.join(" "));

        // ---- message ------------------------------------------------------------

        if (message !== undefined) {
            lines.push(`  ${String(message)}`);
        }

        // ---- stack trace (errors only, foldable) --------------------------------

        if (level === "ERROR" && log.stack) {
            const stackLines = String(log.stack).split("\n");
            for (const line of stackLines) {
                lines.push(`    ${line}`);
            }
        }

        // ---- metadata (foldable JSON) -------------------------------------------

        const meta: Record<string, any> = { ...log };
        delete meta.ts;
        delete meta.level;
        delete meta.message;
        delete meta.component;
        delete meta.peerId;
        delete meta.peerAddress;
        delete meta.stack;

        if (Object.keys(meta).length > 0) {
            const metaJson = JSON.stringify(
                meta,
                (_k, v) => (typeof v === "bigint" ? v.toString() : v),
                2
            );

            for (const line of metaJson.split("\n")) {
                lines.push(`    ${line}`);
            }
        }
    }

    return lines.join("\n") + "\n";
}
