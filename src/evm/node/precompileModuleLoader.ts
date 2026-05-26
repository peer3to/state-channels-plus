export async function importPrecompileModule(
    moduleSpecifier: string
): Promise<any> {
    if (typeof require === "function") {
        if (isTypeScriptModuleSpecifier(moduleSpecifier)) {
            registerNodeTypeScriptLoader(moduleSpecifier);
        }

        try {
            return require(moduleSpecifier);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ERR_REQUIRE_ESM" && code !== "MODULE_NOT_FOUND") {
                throw error;
            }
        }
    }

    return nativeImport(moduleSpecifier);
}

function isTypeScriptModuleSpecifier(moduleSpecifier: string): boolean {
    const withoutQuery = moduleSpecifier.split(/[?#]/, 1)[0];
    return /\.(c|m)?tsx?$/.test(withoutQuery);
}

function registerNodeTypeScriptLoader(moduleSpecifier: string): void {
    try {
        require("ts-node/register/transpile-only");
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "MODULE_NOT_FOUND") {
            throw new Error(
                `Loading TypeScript precompile module "${moduleSpecifier}" requires ts-node/register/transpile-only`
            );
        }
        throw error;
    }

    try {
        require("tsconfig-paths/register");
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "MODULE_NOT_FOUND") {
            throw error;
        }
    }
}

const nativeImport = new Function(
    "moduleSpecifier",
    "return import(moduleSpecifier)"
) as (moduleSpecifier: string) => Promise<any>;
