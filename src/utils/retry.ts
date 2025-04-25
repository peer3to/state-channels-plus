/**
 * Configuration options for the retry function
 */
export interface RetryConfig {
    /** Maximum number of retry attempts (excluding the initial attempt) */
    maxRetries: number;
    /** Delay in milliseconds between retry attempts (default: 0) */
    delayMs?: number;
    /** Whether to use exponential backoff for delays (default: false) */
    useExponentialBackoff?: boolean;
    /** Base multiplier for exponential backoff (default: 2) */
    backoffFactor?: number;
    /** Optional callback function to run before each retry */
    onRetry?: (attempt: number, error: any) => void;
}

/**
 * Retries an async function according to the provided configuration
 *
 * @param fn Async function to retry
 * @param config Retry configuration options
 * @returns Promise that resolves with the result of the function or rejects after all retries fail
 *
 * @example
 * // Basic usage with 3 retries
 * const result = await retry(
 *   () => someAsyncFunction(arg1, arg2),
 *   { maxRetries: 3 }
 * );
 *
 * @example
 * // Advanced usage with exponential backoff
 * const result = await retry(
 *   () => someAsyncFunction(arg1, arg2),
 *   {
 *     maxRetries: 5,
 *     delayMs: 100,
 *     useExponentialBackoff: true,
 *     onRetry: (attempt, error) => console.log(`Retry attempt ${attempt} failed: ${error.message}`)
 *   }
 * );
 */
export async function retry<T>(
    fn: () => Promise<T>,
    config: RetryConfig
): Promise<T> {
    const {
        maxRetries,
        delayMs = 0,
        useExponentialBackoff = false,
        backoffFactor = 2,
        onRetry
    } = config;

    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // If this was the last attempt, don't prepare for retry
            if (attempt === maxRetries) {
                break;
            }

            // Call the onRetry callback if provided
            if (onRetry) {
                onRetry(attempt + 1, error);
            }

            // Calculate delay for next attempt
            if (delayMs > 0) {
                const delay = useExponentialBackoff
                    ? delayMs * Math.pow(backoffFactor, attempt)
                    : delayMs;

                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}
