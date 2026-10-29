import { importModuleFromManifest } from "@platform/moduleLoader";

/** Where a runtime-loaded class lives: a module and one of its exports. */
export type ModuleManifest = {
    /**
     * Node import specifier, absolute path, file URL, or browser/bundler URL.
     */
    module: string;
    /**
     * Optional named export to load from the module. If omitted, the loader
     * uses the default export.
     */
    exportName?: string;
};

/**
 * Load a manifest's module and return its named (or default) export, which
 * must be a class. The labels name the module and the expected export in the
 * error.
 */
export async function resolveManifestExport<
    TExport extends abstract new (...args: never[]) => unknown
>(
    manifest: ModuleManifest,
    moduleLabel: string,
    exportLabel: string
): Promise<TExport> {
    const module = await importModuleFromManifest(manifest.module);
    const exported = manifest.exportName
        ? module[manifest.exportName]
        : module.default;

    // A class has a prototype object; an arrow function has none.
    if (
        typeof exported !== "function" ||
        typeof exported.prototype !== "object"
    ) {
        throw new Error(
            `${moduleLabel} module "${manifest.module}" must export a ${exportLabel}`
        );
    }

    return exported as TExport;
}
