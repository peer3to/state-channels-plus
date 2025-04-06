import dotenv from "dotenv";
import path from "path";

function getProviderUrl() {
    const envPath = path.resolve("../.env");
    dotenv.config({ path: envPath });
    return process.env.PROVIDER_URL || "http://localhost:8545";
}

export default getProviderUrl;
