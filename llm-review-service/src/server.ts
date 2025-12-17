import "dotenv/config";
import { loadConfig } from "./config";
import { buildApp } from "./app";

async function main() {
  const config = loadConfig(process.env);
  const app = await buildApp({ config });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
