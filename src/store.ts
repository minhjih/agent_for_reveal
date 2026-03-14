/**
 * Simple JSON file store for persisting agent credentials and state.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, "..", "data", "agents.json");

export interface StoredAgent {
  name: string;
  apiKey: string;
  agentId: string;
  slug: string;
  registeredAt: string;
}

export interface Store {
  agents: StoredAgent[];
}

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

export function loadStore(): Store {
  if (!existsSync(STORE_PATH)) {
    return { agents: [] };
  }
  return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
}

export function saveStore(store: Store): void {
  ensureDir(STORE_PATH);
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getAgentCredentials(name: string): StoredAgent | undefined {
  const store = loadStore();
  return store.agents.find((a) => a.name === name);
}

export function saveAgentCredentials(agent: StoredAgent): void {
  const store = loadStore();
  const idx = store.agents.findIndex((a) => a.name === agent.name);
  if (idx >= 0) {
    store.agents[idx] = agent;
  } else {
    store.agents.push(agent);
  }
  saveStore(store);
}
