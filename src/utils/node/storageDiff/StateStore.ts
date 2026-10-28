import type { AccountDiffs } from "./blockStorageDiff";
import type { CachedState } from "./StateCache";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE_VERSION = 1;
const FILE_NAME = "state.json";

/** A block the file keeps with its changes, to undo it after a reorg. */
export interface PersistedBlock {
    number: string;
    hash: string;
    parentHash: string;
    pre: AccountDiffs;
    post: AccountDiffs;
}

/** What the file holds: the cache at `head`, and the blocks that led to it. */
export interface PersistedState {
    version: typeof FILE_VERSION;
    head: { number: string; hash: string };
    cache: CachedState;
    /** The newest blocks up to `head`, oldest first, for the cached accounts only. */
    recent: PersistedBlock[];
}

/** The cache on disk, in one file of a directory, written whole and renamed into place. */
export class StateStore {
    private readonly file: string;
    private readonly directory: string;

    constructor(directory: string) {
        this.directory = directory;
        this.file = path.join(directory, FILE_NAME);
    }

    /** The saved state, or undefined when there is none or it is not ours. */
    async load(): Promise<PersistedState | undefined> {
        let text: string;
        try {
            text = await readFile(this.file, "utf8");
        } catch {
            return undefined;
        }
        try {
            const parsed = JSON.parse(text) as PersistedState;
            return parsed.version === FILE_VERSION ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    async save(state: Omit<PersistedState, "version">): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        const temporary = `${this.file}.${process.pid}.tmp`;
        await writeFile(
            temporary,
            JSON.stringify({ version: FILE_VERSION, ...state })
        );
        await rename(temporary, this.file);
    }
}
