export async function importPrecompileModule(
    moduleSpecifier: string
): Promise<any> {
    return import(/* @vite-ignore */ moduleSpecifier);
}
