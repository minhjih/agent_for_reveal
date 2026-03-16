#!/usr/bin/env tsx
/**
 * Reveal.ac Agent Swarm — Entry Point
 *
 * All 11 agents are powered by a SINGLE Claude API key.
 * Each agent has its own Reveal.ac identity (API key from registration).
 * Agents fire at staggered times across the 4-hour window.
 *
 * Commands:
 *   register   — Register all 11 agents
 *   run        — Register + run 1 heartbeat per agent (sequential)
 *   continuous — Register + run staggered heartbeats (Ctrl+C to stop)
 *   status     — Show registered agents and schedule
 *   feed       — Show recent feed posts
 */

import { registerAllAgents, loadActiveAgents, runSingleCycle, runContinuous } from "./automation.js";
import { loadStore } from "./store.js";
import { RevealClient } from "./client.js";
import { isAIEnabled } from "./ai-engine.js";
import { AGENT_PROFILES } from "./agents/profiles.js";
import { CONFIG } from "./config.js";

const command = process.argv[2] || "run";

async function main() {
  console.log("🤖 Reveal.ac Agent Swarm (Staggered Heartbeat Mode)");
  console.log(`   Command: ${command}`);
  console.log(`   AI Mode: ${isAIEnabled() ? "✓ Claude API — 1 key powers all agents" : "✗ Template fallback (set ANTHROPIC_API_KEY to enable AI)"}`);
  console.log(`   Agents:  ${AGENT_PROFILES.length} independent personalities`);
  console.log(`   Window:  ${CONFIG.AUTOMATION.HEARTBEAT_INTERVAL_MS / 3_600_000}h heartbeat interval`);
  console.log("");

  switch (command) {
    case "register": {
      const agents = await registerAllAgents();
      console.log(`\n✅ ${agents.length} agents registered.`);
      break;
    }

    case "run": {
      const agents = await registerAllAgents();
      console.log(`\n🫀 Running single heartbeat with ${agents.length} agents (sequential)...`);
      await runSingleCycle(agents);
      console.log("\n✅ Single heartbeat round completed.");
      break;
    }

    case "continuous": {
      const maxCycles = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity;
      const agents = await registerAllAgents();
      console.log(`\n🫀 Starting staggered scheduler with ${agents.length} agents...`);
      console.log(`   Max heartbeats per agent: ${maxCycles === Infinity ? "∞" : maxCycles}`);
      await runContinuous(agents, maxCycles);
      break;
    }

    case "activity": {
      console.log(`\n🔑 Validating API keys...`);
      const active = await loadActiveAgents();
      if (active.length === 0) {
        console.log("❌ No registered agents found in data/agents.json. Run 'register' first.");
        break;
      }
      const maxCyc = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity;
      console.log(`\n🫀 Starting activity with ${active.length} agents (all keys verified)...`);
      await runContinuous(active, maxCyc);
      break;
    }

    case "status": {
      const store = loadStore();
      if (store.agents.length === 0) {
        console.log("No agents registered yet. Run 'register' first.");
      } else {
        console.log(`Registered agents (${store.agents.length}):\n`);

        const intervalMs = CONFIG.AUTOMATION.HEARTBEAT_INTERVAL_MS;
        const gap = Math.floor(intervalMs / store.agents.length);

        for (let i = 0; i < store.agents.length; i++) {
          const a = store.agents[i];
          const offsetMin = Math.round((i * gap) / 60_000);
          const h = Math.floor(offsetMin / 60);
          const m = offsetMin % 60;
          const offsetStr = h > 0 ? `+${h}h${m.toString().padStart(2, "0")}m` : `+${m}m`;

          console.log(`  ${a.name}`);
          console.log(`    ID:       ${a.agentId}`);
          console.log(`    Slug:     ${a.slug}`);
          console.log(`    Offset:   ${offsetStr} in 4h window`);
          console.log(`    Since:    ${a.registeredAt}`);
          console.log("");
        }

        console.log("📅 Stagger pattern:");
        console.log("   Each agent fires ~22 min after the previous one.");
        console.log("   Full rotation: 0:00 → 3:38 → repeat after 4h.");
        console.log("   All agents share 1 Claude API key for intelligence.\n");
      }
      break;
    }

    case "feed": {
      const store = loadStore();
      if (store.agents.length === 0) {
        console.log("No agents registered. Register first to use authenticated feed.");
        const res = await fetch("https://www.reveal.ac/api/feed/posts?sort=new&limit=10");
        const data = await res.json();
        console.log("\nRecent feed posts (unauthenticated):\n");
        for (const p of (data as { posts: Array<{ post_type: string; agent: { name: string }; content: string; upvotes: number; comment_count: number; created_at: string }> }).posts || []) {
          console.log(`  [${p.post_type}] ${p.agent.name}: ${p.content.slice(0, 100)}...`);
          console.log(`    ↑${p.upvotes} | 💬${p.comment_count} | ${p.created_at}`);
          console.log("");
        }
      } else {
        const client = new RevealClient(store.agents[0].apiKey);
        const { posts } = await client.getFeedPosts({ sort: "new", limit: 10 });
        console.log("\nRecent feed posts:\n");
        for (const p of posts) {
          console.log(`  [${p.post_type}] ${p.agent.name}: ${p.content.slice(0, 100)}...`);
          console.log(`    ↑${p.upvotes} | 💬${p.comment_count} | ${p.created_at}`);
          console.log("");
        }
      }
      break;
    }

    default:
      console.log("Unknown command. Available: register, run, continuous, status, feed");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
