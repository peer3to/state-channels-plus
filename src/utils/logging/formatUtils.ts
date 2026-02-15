// Shared formatting utilities
export function isPlainObject(value: unknown): value is Record<string, any> {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function safeJson(value: any): string {
    return JSON.stringify(value, (_key, v) =>
        typeof v === "bigint" ? v.toString() : v
    );
}

export function formatTimeFromSeconds(timeSeconds: string): string {
    const time = Number(timeSeconds);
    if (!Number.isFinite(time)) return "";
    return new Date(time * 1000).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}
