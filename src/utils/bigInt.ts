function toBigInt(value: number | bigint): bigint {
    return typeof value === "bigint" ? value : BigInt(value);
}

export function sum(...args: (number | bigint)[]): bigint {
    return args.reduce((sum: bigint, value) => sum + BigInt(value), 0n);
}

/**
 * Less than comparison for mixed number and bigint types
 */
export function lt(a: number | bigint, b: number | bigint): boolean {
    return toBigInt(a) < toBigInt(b);
}

/**
 * Less than or equal comparison for mixed number and bigint types
 */
export function lte(a: number | bigint, b: number | bigint): boolean {
    return toBigInt(a) <= toBigInt(b);
}

/**
 * Greater than comparison for mixed number and bigint types
 */
export function gt(a: number | bigint, b: number | bigint): boolean {
    return toBigInt(a) > toBigInt(b);
}

/**
 * Greater than or equal comparison for mixed number and bigint types
 */
export function gte(a: number | bigint, b: number | bigint): boolean {
    return toBigInt(a) >= toBigInt(b);
}

/**
 * Equal comparison for mixed number and bigint types
 */
export function eq(a: number | bigint, b: number | bigint): boolean {
    return toBigInt(a) === toBigInt(b);
}
