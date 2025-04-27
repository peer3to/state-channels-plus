/**
 * Utility functions for working with Sets
 */

/**
 * Returns the union of two sets (elements in either set)
 */
export const union = <T>(setA: Set<T>, setB: Set<T>): Set<T> => {
    const result = new Set<T>([...setA]);
    for (const elem of setB) {
        result.add(elem);
    }
    return result;
};

/**
 * Returns the intersection of two sets (elements in both sets)
 */
export const intersection = <T>(setA: Set<T>, setB: Set<T>): Set<T> => {
    const result = new Set<T>();
    for (const elem of setA) {
        if (setB.has(elem)) {
            result.add(elem);
        }
    }
    return result;
};

/**
 * Returns the difference of two sets (elements in setA but not in setB)
 */
export const difference = <T>(setA: Set<T>, setB: Set<T>): Set<T> => {
    const result = new Set<T>([...setA]);
    for (const elem of setB) {
        result.delete(elem);
        if (result.size === 0) return result;
    }
    return result;
};

/**
 * Returns the symmetric difference of two sets (elements in either set but not in both)
 */
export const symmetricDifference = <T>(setA: Set<T>, setB: Set<T>): Set<T> => {
    const unionSet = union(setA, setB);
    const intersectionSet = intersection(setA, setB);
    return difference(unionSet, intersectionSet);
};

/**
 * Checks if setA is a subset of setB (all elements of setA are in setB)
 */
export const isSubset = <T>(setA: Set<T>, setB: Set<T>): boolean => {
    for (const elem of setA) {
        if (!setB.has(elem)) {
            return false;
        }
    }
    return true;
};

/**
 * Checks if setA is a superset of setB (setA contains all elements of setB)
 */
export const isSuperset = <T>(setA: Set<T>, setB: Set<T>): boolean => {
    return isSubset(setB, setA);
};

/**
 * Converts an array to a set
 */
export const fromArray = <T>(array: T[]): Set<T> => {
    return new Set<T>(array);
};

/**
 * Converts a set to an array
 */
export const toArray = <T>(set: Set<T>): T[] => {
    return Array.from(set);
};

/**
 * Creates a set from an array, converting all elements to strings
 * Useful when working with addresses or other values that need string comparison
 */
export const stringSetFromArray = <T>(array: T[]): Set<string> => {
    return new Set(array.map(String));
};

/**
 * Finds elements from the source array that aren't in the excluded set
 * Returns them as an array
 */
export const excludeFromArray = <T>(
    source: T[],
    excluded: Set<string>
): T[] => {
    return source.filter((item) => !excluded.has(String(item)));
};
