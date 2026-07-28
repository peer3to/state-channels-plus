import { mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
    CreatePersistenceDatabaseOptions,
    PersistenceDatabaseHandle
} from "../PersistenceDatabase";

export async function createPersistenceDatabase(
    options: CreatePersistenceDatabaseOptions
): Promise<PersistenceDatabaseHandle> {
    const root = options.location ?? getDefaultRoot();
    const location = path.join(root, options.namespace);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    let ClassicLevel: typeof import("classic-level").ClassicLevel;
    try {
        ({ ClassicLevel } = await import("classic-level"));
    } catch (error) {
        throw new Error(
            `Node persistence requires the optional classic-level package: ${String(error)}`
        );
    }

    const database = new ClassicLevel<string, string>(location, {
        keyEncoding: "utf8",
        valueEncoding: "utf8"
    });
    let closed = false;
    return {
        database,
        location,
        close: async () => {
            if (closed) return;
            closed = true;
            await database.close();
        },
        destroy: async () => {
            if (!closed) {
                closed = true;
                await database.close();
            }
            await ClassicLevel.destroy(location);
        }
    };
}

function getDefaultRoot(): string {
    if (process.platform === "darwin") {
        return path.join(
            homedir(),
            "Library",
            "Application Support",
            "peer3",
            "state-channels-plus"
        );
    }
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        return path.join(
            process.env.LOCALAPPDATA,
            "peer3",
            "state-channels-plus"
        );
    }
    return path.join(
        process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
        "peer3",
        "state-channels-plus"
    );
}
