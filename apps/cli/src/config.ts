import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthTokens } from "@relay/sdk";

export interface CliConfig {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  currentAppId?: string;
}

const configPath = process.env.RELAY_CONFIG_PATH ?? join(homedir(), ".relay", "config.json");

export async function loadCliConfig(): Promise<CliConfig> {
  try {
    const saved = JSON.parse(await readFile(configPath, "utf8")) as Partial<CliConfig>;
    return { ...saved, baseUrl: saved.baseUrl ?? "http://localhost:3000" };
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { baseUrl: process.env.RELAY_API_URL ?? "http://localhost:3000" };
    throw error;
  }
}

export async function saveCliConfig(config: CliConfig) {
  await mkdir(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
  await chmod(configPath, 0o600).catch(() => undefined);
}

export async function saveTokens(tokens: AuthTokens) {
  const config = await loadCliConfig();
  await saveCliConfig({ ...config, ...tokens });
}

export async function clearTokens() {
  const config = await loadCliConfig();
  delete config.accessToken;
  delete config.refreshToken;
  delete config.currentAppId;
  await saveCliConfig(config);
}
