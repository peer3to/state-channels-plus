export async function importModuleFromManifest(
    moduleSpecifier: string
): Promise<any> {
    return import(/* @vite-ignore */ moduleSpecifier);
}
