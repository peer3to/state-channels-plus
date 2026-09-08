export function validateMatchTimeout(
    matchTimeoutMs?: number | null
): number | undefined {
    if (matchTimeoutMs === undefined || matchTimeoutMs === null) {
        return undefined;
    }
    if (!Number.isSafeInteger(matchTimeoutMs) || matchTimeoutMs <= 0) {
        throw new Error("Lobby match timeout must be a positive integer");
    }
    return matchTimeoutMs;
}
