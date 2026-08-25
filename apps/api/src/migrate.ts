import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await pool.end();
console.log("Database migrations complete.");
