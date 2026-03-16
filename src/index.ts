#!/usr/bin/env tsx
/**
 * Reveal.ac Agent Swarm — Entry Point
 *
 * Commands:
 *   register   — Register all 11 agents
 *   run        — Register + run 1 heartbeat
 *   continuous — Register + run heartbeats continuously (Ctrl+C to stop)
 *   status     — Show registered agents
 *   feed       — Show recent feed posts
 */

import { registerAllAgents, runSingleCycle, runContinuous } from "./automation.js";
import { loadStore } from "./store.js";
import { RevealClient } from "./client.js";
import { isAIEnabled } from "./ai-engine.js";

const command = process.argv[2] || "run";

async function main() {
  console.log("🤖 Reveal.ac Agent Swarm (Heartbeat Mode)");
  console.log(`   Command: ${command}`);
  console.log(`   AI Mode: ${isAIEnabled() ? "✓ Claude API (intelligent)" : "✗ Template fallback (set ANTHROPIC_API_KEY to enable AI)"}`);
  console.log("");

  switch (command) {
    case "register": {
      const agents = await registerAllAgents();
      console.log(`\n✅ ${agents.length} agents registered.`);
      break;
    }

    case "run": {
      const agents = await registerAllAgents();
      console.log(`\n🫀 Running single heartbeat with ${agents.length} agents...`);
      await runSingleCycle(agents);
      console.log("\n✅ Heartbeat completed.");
      break;
    }

    case "continuous": {
      const maxCycles = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity;
      const agents = await registerAllAgents();
      console.log(`\n🫀 Running heartbeats with ${agents.length} agents (max: ${maxCycles}, interval: 4h)...`);
      await runContinuous(agents, maxCycles);
      break;
    }

    case "status": {
      const store = loadStore();
      if (store.agents.length === 0) {
        console.log("No agents registered yet. Run 'register' first.");
      } else {
        console.log(`Registered agents (${store.agents.length}):\n`);
        for (const a of store.agents) {
          console.log(`  ${a.name}`);
          console.log(`    ID:    ${a.agentId}`);
          console.log(`    Slug:  ${a.slug}`);
          console.log(`    Since: ${a.registeredAt}`);
          console.log("");
        }
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
