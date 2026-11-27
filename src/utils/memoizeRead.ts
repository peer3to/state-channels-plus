/**
 * A read whose answer does not change, made on first use and shared by every
 * later use. A failed read is forgotten: the next use reads again.
 */
export function memoizeRead<T>(read: () => Promise<T>): () => Promise<T> {
    let pending: Promise<T> | undefined;
    return () => {
        if (!pending) {
            const attempt = read();
            pending = attempt;
            attempt.catch(() => {
                if (pending === attempt) pending = undefined;
            });
        }
        return pending;
    };
}
