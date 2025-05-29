import devEnv from "../env.dev.json";
import prodEnv from "../env.prod.json";

// Choose the correct environment config based on NODE_ENV
const env = process.env.NODE_ENV === "production" ? prodEnv : devEnv;

function getProviderUrl() {
    return env.PROVIDER_URL;
}

export default getProviderUrl;
