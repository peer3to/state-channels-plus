// Keep model/storage dependencies out of runtime and logging foundations.
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
