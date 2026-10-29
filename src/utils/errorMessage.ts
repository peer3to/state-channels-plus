// Keep model/storage dependencies out of runtime and logging foundations.
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The text of any value. `String()` throws for a value whose conversion
 * throws, such as a null-prototype object; its object tag names it then.
 */
export function valueText(value: unknown): string {
    try {
        return String(value);
    } catch {
        return Object.prototype.toString.call(value);
    }
}
