export function parseExcludeTags(args: string[] = process.argv): string[] {
    const excludedTags: string[] = [];
    const normalize = (tag: string) => tag.trim().toLowerCase();

    const addTags = (value?: string) => {
        if (!value) return;
        value
            .split(/[,\s]+/)
            .map(normalize)
            .filter(Boolean)
            .forEach((tag) => excludedTags.push(tag));
    };

    // Check environment variables
    if (typeof process !== "undefined" && process.env) {
        addTags(process.env.LOG_EXCLUDE_TAGS);
        addTags(process.env.EXCLUDE_LOG_TAGS);
    }

    // Check command-line args
    const flagIndex = args.findIndex((arg) => arg === "--exclude-tags");
    if (flagIndex !== -1) {
        addTags(args[flagIndex + 1]);
    }

    const eqFlag = args.find((arg) => arg.startsWith("--exclude-tags="));
    if (eqFlag) {
        addTags(eqFlag.split("=", 2)[1]);
    }

    return excludedTags;
}
