import fs from "fs";
import path from "path";

function getProviderUrl() {
    const configPath = path.resolve(process.cwd(), "example.peer3.config.json");
    let providerUrl = "http://localhost:8545"; // default

    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (config.PROVIDER_URL) {
            providerUrl = config.PROVIDER_URL;
        }
    }

    return providerUrl;
}

export default getProviderUrl;
