import fs from "fs";
import path from "path";

export function getPeer3Config() {
    const configPath = path.resolve(process.cwd(), "peer3Config.json");
    if (!fs.existsSync(configPath)) {
        console.log("peer3Config.json not found at", configPath);
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
}
