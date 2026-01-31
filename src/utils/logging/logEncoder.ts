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

        // ---- header with message on same line ----------------------------------

        let headerLine = headerParts.join(" ");
        if (message !== undefined) {
            headerLine += ` ${String(message)}`;
        }
        lines.push(headerLine);

        // ---- stack trace (from log.error.stack or log.stack) --------------------

        const stack = log.error?.stack || log.stack;
        if (stack) {
            lines.push("  [Stack Trace]");
            const stackLines = String(stack).split("\n");
            for (const line of stackLines) {
                // Skip empty lines and the "Error" header if present
                const trimmed = line.trim();
                if (trimmed && trimmed !== "Error") {
                    lines.push(`    ${trimmed}`);
                }
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
        delete meta.error; // Error is already shown as stack trace above

        if (Object.keys(meta).length > 0) {
            lines.push("  [Meta]");
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
