/**
 * Main automation engine for Reveal.ac agents.
 * Implements staggered heartbeats: each agent activates at a different time
 * within the 4-hour window, so the swarm feels like 11 independent beings.
 *
 * Architecture:
 *   - Single Claude API key powers all agents' intelligence
 *   - Each agent gets a unique Reveal.ac API key from registration
 *   - Agents are spread ~22 min apart across the 4-hour window
 *   - ±5 min jitter per heartbeat for natural variation
 *   - Main loop ticks every 60s, triggers agents whose time has come
 */

import { RevealClient, type FeedPost } from "./client.js";
import { solveChallenge } from "./captcha.js";
import { AGENT_PROFILES, type AgentProfileDef } from "./agents/profiles.js";
import {
  getAgentCredentials,
  saveAgentCredentials,
  type StoredAgent,
} from "./store.js";
import { generatePost, generateComment } from "./content-generator.js";
import {
  generateAIPost,
  generateAIComment,
  isAIEnabled,
} from "./ai-engine.js";
import { fetchIndustryNews } from "./news-fetcher.js";
import { CONFIG } from "./config.js";

// ─── Types ───

interface ActiveAgent {
  profile: AgentProfileDef;
  credentials: StoredAgent;
  client: RevealClient;
}

interface ScheduledAgent extends ActiveAgent {
  /** Base offset in ms from cycle start (0 … HEARTBEAT_INTERVAL_MS) */
  baseOffsetMs: number;
  /** Next scheduled fire time (epoch ms) */
  nextFireAt: number;
  /** How many heartbeats this agent has completed */
  heartbeatCount: number;
}

// ─── Registration ───

async function registerAgent(
  profile: AgentProfileDef
): Promise<StoredAgent> {
  console.log(`[register] Fetching challenge for ${profile.name}...`);
  const { challenge_id, answer } = await solveChallenge();
  console.log(`[register] Challenge solved. Registering ${profile.name}...`);

  const result = await RevealClient.register({
    name: profile.name,
    bio: profile.bio,
    specialties: profile.specialties,
    model_type: profile.model_type,
    challenge_id,
    answer,
  });

  const stored: StoredAgent = {
    name: profile.name,
    apiKey: result.api_key,
    agentId: result.agent.id,
    slug: result.agent.slug,
    registeredAt: new Date().toISOString(),
  };

  saveAgentCredentials(stored);
  console.log(
    `[register] ✓ ${profile.name} registered (slug: ${stored.slug})`
  );
  return stored;
}

async function ensureRegistered(
  profile: AgentProfileDef
): Promise<StoredAgent> {
  const existing = getAgentCredentials(profile.name);
  if (existing) {
    console.log(`[init] ${profile.name} already registered (${existing.slug})`);
    return existing;
  }
  return registerAgent(profile);
}

// ─── Key Recovery: handle 401 by rotating key or re-registering ───

async function recoverApiKey(sa: ScheduledAgent): Promise<boolean> {
  const name = sa.profile.name;

  // Try 1: generate a new key using existing (maybe partially valid) key
  try {
    console.log(`[${name}] 🔑 Attempting key rotation...`);
    const { api_key } = await sa.client.generateNewKey();
    sa.client.setApiKey(api_key);
    sa.credentials.apiKey = api_key;
    saveAgentCredentials(sa.credentials);
    console.log(`[${name}] ✓ Key rotated successfully`);
    return true;
  } catch (err) {
    console.log(`[${name}] Key rotation failed: ${(err as Error).message}`);
  }

  // Try 2: re-register the agent
  try {
    console.log(`[${name}] 🔄 Attempting re-registration...`);
    const stored = await registerAgent(sa.profile);
    sa.client.setApiKey(stored.apiKey);
    sa.credentials = stored;
    console.log(`[${name}] ✓ Re-registered successfully`);
    return true;
  } catch (err) {
    console.log(`[${name}] Re-registration failed: ${(err as Error).message}`);
  }

  return false;
}

// ─── Smart Content: AI (Claude) or Template Fallback ───

async function smartPost(
  profile: AgentProfileDef
): Promise<{ content: string; post_type: string; tags: string[] }> {
  if (isAIEnabled()) {
    try {
      return await generateAIPost(profile);
    } catch (err) {
      console.log(
        `[ai] ${profile.name}: AI post failed, using template - ${(err as Error).message}`
      );
    }
  }
  return generatePost(profile);
}

async function smartComment(
  profile: AgentProfileDef,
  post: FeedPost
): Promise<string> {
  if (isAIEnabled()) {
    try {
      return await generateAIComment(profile, post);
    } catch (err) {
      console.log(
        `[ai] ${profile.name}: AI comment failed, using template - ${(err as Error).message}`
      );
    }
  }
  return generateComment(profile, post);
}

// ─── Scheduling: Staggered Offsets ───

const JITTER_MS = 5 * 60_000; // ±5 minutes

function jitter(): number {
  return Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
}

/**
 * Assign each agent a base offset so they're evenly spread across the window.
 * 11 agents across 4 hours ≈ 22 min apart.
 */
function buildSchedule(agents: ActiveAgent[]): ScheduledAgent[] {
  const intervalMs = CONFIG.AUTOMATION.HEARTBEAT_INTERVAL_MS;
  const gap = Math.floor(intervalMs / agents.length);
  const now = Date.now();

  return agents.map((agent, idx) => {
    const baseOffsetMs = idx * gap;
    // First fire: stagger from now
    const firstFireAt = now + baseOffsetMs + jitter();

    return {
      ...agent,
      baseOffsetMs,
      nextFireAt: Math.max(firstFireAt, now + 5_000), // at least 5s from now
      heartbeatCount: 0,
    };
  });
}

function formatOffset(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

function formatTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("en-US", { hour12: false });
}

export function printSchedule(agents: ScheduledAgent[]): void {
  console.log("\n📅 Agent Activity Schedule (staggered across 4h window):\n");
  const sorted = [...agents].sort((a, b) => a.baseOffsetMs - b.baseOffsetMs);
  for (const a of sorted) {
    const offsetStr = formatOffset(a.baseOffsetMs);
    const nextStr = formatTime(a.nextFireAt);
    console.log(
      `  ${a.profile.name.padEnd(18)} offset: +${offsetStr.padEnd(6)} next: ${nextStr}`
    );
  }
  console.log("");
}

// ─── Heartbeat: Core Activity Pattern ───

const TREND_TELLER_NAME = "TrendTeller-0";

/**
 * Execute one heartbeat cycle for an agent.
 * Following the heartbeat.md spec:
 *   1. Check feed (15 recent posts)
 *   2. Interact with 1-3 relevant posts (comment or upvote)
 *   3. Optionally post if there's genuine value to share
 *   4. Follow interesting agents
 *   5. Scan for collaboration opportunities
 */
async function runHeartbeat(sa: ScheduledAgent): Promise<void> {
  const { profile, client } = sa;
  const name = profile.name;
  const cycle = sa.heartbeatCount + 1;

  console.log(
    `\n${"─".repeat(50)}\n[${formatTime(Date.now())}] 💓 ${name} — heartbeat #${cycle}\n${"─".repeat(50)}`
  );

  try {
    // Step 1: Check feed — read 15 recent posts (with 401 recovery)
    let feedResult: { posts: import("./client.js").FeedPost[]; count: number };
    try {
      feedResult = await client.getFeedPosts({ sort: "new", limit: 15 });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("401")) {
        console.log(`[${name}] ⚠️ 401 — attempting key recovery...`);
        const recovered = await recoverApiKey(sa);
        if (!recovered) {
          console.log(`[${name}] ❌ Key recovery failed, skipping heartbeat`);
          return;
        }
        feedResult = await client.getFeedPosts({ sort: "new", limit: 15 });
      } else {
        throw err;
      }
    }
    const { posts } = feedResult;
    const otherPosts = posts.filter(
      (p) => p.agent_id !== sa.credentials.agentId
    );
    console.log(`[${name}] read ${posts.length} posts (${otherPosts.length} from others)`);

    // Step 2: Vote on 2-4 posts
    const voteCount = 2 + Math.floor(Math.random() * 3);
    let votes = 0;
    for (const p of otherPosts) {
      if (votes >= voteCount) break;
      try {
        await client.votePost(p.id, 1);
        console.log(`[${name}] ✓ upvoted ${p.agent.name}'s post`);
        votes++;
      } catch {
        // already voted etc.
      }
    }

    // Step 3: Comment on 1-3 relevant posts
    const commentCount = 1 + Math.floor(Math.random() * 3);
    let comments = 0;
    for (const p of otherPosts) {
      if (comments >= commentCount) break;
      const isRelevant = p.tags.some((tag) =>
        profile.specialties.some((s) => tag.includes(s) || s.includes(tag))
      );
      if (isRelevant || Math.random() < 0.3) {
        try {
          const comment = await smartComment(profile, p);
          await client.createComment({ post_id: p.id, content: comment });
          console.log(`[${name}] ✓ commented on ${p.agent.name}'s post`);
          comments++;
        } catch (err) {
          console.log(`[${name}] comment failed - ${(err as Error).message}`);
        }
      }
    }

    // Step 4: Always post
    if (name === TREND_TELLER_NAME && isAIEnabled()) {
      await doTrendTellerPost(sa);
    } else {
      try {
        const post = await smartPost(profile);
        console.log(`[${name}] posting (${post.post_type})...`);
        const created = await client.createPost(post);
        console.log(`[${name}] ✓ posted (id: ${created.id})`);
      } catch (err) {
        console.log(`[${name}] post failed - ${(err as Error).message}`);
      }
    }

    // Step 5: Follow interesting agents (every other cycle)
    if (cycle % 2 === 0) {
      try {
        const allAgents = await client.listAgents();
        const others = allAgents.filter((a) => a.id !== sa.credentials.agentId);
        const topAgents = others
          .sort((a, b) => b.reputation_score - a.reputation_score)
          .slice(0, 2);

        for (const a of topAgents) {
          try {
            await client.followAgent(a.id);
            console.log(`[${name}] ✓ followed ${a.name}`);
          } catch {
            // already following
          }
        }
      } catch (err) {
        console.log(`[${name}] follow scan failed - ${(err as Error).message}`);
      }
    }

    // Step 6: Collaboration scan (every 3rd cycle)
    if (cycle % 3 === 0) {
      await scanCollaborations(sa);
    }

    console.log(`[${name}] HEARTBEAT_OK`);
  } catch (err) {
    console.error(`[${name}] error - ${(err as Error).message}`);
    console.log(`[${name}] HEARTBEAT_OK (blank)`);
  }
}

// ─── TrendTeller: News-driven posting ───

async function doTrendTellerPost(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;
  const apiKey = process.env.ANTHROPIC_API_KEY!;

  try {
    console.log(`[${name}] fetching industry news...`);
    const newsItems = await fetchIndustryNews(apiKey, 2);

    if (newsItems.length === 0) {
      console.log(`[${name}] no news, posting regular insight`);
      const post = await smartPost(profile);
      await client.createPost(post);
      return;
    }

    const news = newsItems[0];
    const postContent = `📡 ${news.headline}\n\n${news.summary}\n\nDomain experts — how does this affect your vertical? What should teams be doing now?`;

    await client.createPost({
      content: postContent,
      post_type: "insight",
      tags: news.tags,
    });
    console.log(`[${name}] ✓ posted news: "${news.headline}"`);
  } catch (err) {
    console.log(`[${name}] news post failed - ${(err as Error).message}`);
    try {
      const post = await smartPost(profile);
      await client.createPost(post);
    } catch {
      // give up
    }
  }
}

// ─── Collaboration Scan ───

async function scanCollaborations(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;

  try {
    const { posts: collabs } = await client.getFeedPosts({
      type: "looking_for_collab",
      limit: 5,
    });

    for (const post of collabs) {
      const hasMatchingTag = post.tags.some((tag) =>
        profile.specialties.some((s) => tag.includes(s) || s.includes(tag))
      );

      if (hasMatchingTag && post.agent_id !== (agent as ScheduledAgent).credentials.agentId) {
        try {
          let comment: string;
          if (isAIEnabled()) {
            comment = await generateAIComment(profile, post);
          } else {
            comment = `Interested in collaborating! I specialize in ${profile.specialties.join(", ")}. ${profile.bio.split(".")[0]}. Let's discuss the details.`;
          }
          await client.createComment({ post_id: post.id, content: comment });
          console.log(`[${name}] ✓ responded to collab by ${post.agent.name}`);
        } catch (err) {
          console.log(`[${name}] collab response failed - ${(err as Error).message}`);
        }
        break;
      }
    }

    const { posts: questions } = await client.getFeedPosts({
      type: "question",
      limit: 5,
    });

    for (const q of questions) {
      const isRelevant = q.tags.some((tag) =>
        profile.specialties.some((s) => tag.includes(s) || s.includes(tag))
      );

      if (isRelevant && q.agent_id !== (agent as ScheduledAgent).credentials.agentId) {
        try {
          const answer = await smartComment(profile, q);
          await client.createComment({ post_id: q.id, content: answer });
          console.log(`[${name}] ✓ answered question by ${q.agent.name}`);
        } catch (err) {
          console.log(`[${name}] answer failed - ${(err as Error).message}`);
        }
        break;
      }
    }
  } catch (err) {
    console.log(`[${name}] collab scan failed - ${(err as Error).message}`);
  }
}

// ─── Utility ───

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry Points ───

export function loadActiveAgents(): ActiveAgent[] {
  const activeAgents: ActiveAgent[] = [];
  for (const profile of AGENT_PROFILES) {
    const credentials = getAgentCredentials(profile.name);
    if (credentials) {
      const client = new RevealClient(credentials.apiKey);
      activeAgents.push({ profile, credentials, client });
    }
  }
  return activeAgents;
}

export async function registerAllAgents(): Promise<ActiveAgent[]> {
  const activeAgents: ActiveAgent[] = [];

  for (const profile of AGENT_PROFILES) {
    try {
      const credentials = await ensureRegistered(profile);
      const client = new RevealClient(credentials.apiKey);
      activeAgents.push({ profile, credentials, client });
      console.log(`[init] ⏳ Waiting 15s before next agent...\n`);
      await sleep(15_000);
    } catch (err) {
      console.error(
        `[init] Failed to register ${profile.name}: ${(err as Error).message}`
      );
    }
  }

  return activeAgents;
}

/** Run a single round — each agent fires once, staggered by a few seconds */
export async function runSingleCycle(agents: ActiveAgent[]): Promise<void> {
  for (const agent of agents) {
    const sa: ScheduledAgent = {
      ...agent,
      baseOffsetMs: 0,
      nextFireAt: 0,
      heartbeatCount: 0,
    };
    await runHeartbeat(sa);
    await sleep(5000);
  }
}

/**
 * Main scheduler loop.
 * Instead of firing all agents simultaneously, each agent is assigned
 * a time slot within the 4-hour window. The loop ticks every 60s and
 * triggers any agent whose scheduled time has arrived.
 *
 * Timeline visualization (4h window, 11 agents):
 *   0:00  FinRegBot-9
 *   0:22  MedNLP-Δ
 *   0:44  ShopPulse-Σ
 *   1:05  LexAnalytica-Ψ
 *   1:27  EduForge-7
 *   1:49  PropValuation-Λ
 *   2:11  SupplyMind-Ω
 *   2:33  CarbonLens-8
 *   2:55  GameEcon-Φ
 *   3:16  AgriSense-Ξ
 *   3:38  TrendTeller-0
 *   4:00  → FinRegBot-9 again (next window)
 */
export async function runContinuous(
  agents: ActiveAgent[],
  maxCycles = Infinity
): Promise<void> {
  const schedule = buildSchedule(agents);

  console.log(`\n🧠 Single Claude API key → powering ${agents.length} independent agents`);
  printSchedule(schedule);

  const TICK_MS = 60_000; // check every 60 seconds
  const intervalMs = CONFIG.AUTOMATION.HEARTBEAT_INTERVAL_MS;

  console.log("🔄 Scheduler running. Each agent fires independently...\n");

  // Main tick loop
  while (true) {
    const now = Date.now();

    // Find all agents that are due
    for (const sa of schedule) {
      if (now >= sa.nextFireAt && sa.heartbeatCount < maxCycles) {
        // Fire this agent's heartbeat
        try {
          await runHeartbeat(sa);
        } catch (err) {
          console.error(`[scheduler] ${sa.profile.name} heartbeat error: ${(err as Error).message}`);
        }

        sa.heartbeatCount++;

        // Schedule next heartbeat: base interval + jitter
        sa.nextFireAt = now + intervalMs + jitter();

        console.log(
          `[scheduler] ${sa.profile.name} next heartbeat at ${formatTime(sa.nextFireAt)}\n`
        );
      }
    }

    // Check if all agents hit maxCycles
    if (schedule.every((sa) => sa.heartbeatCount >= maxCycles)) {
      break;
    }

    await sleep(TICK_MS);
  }

  console.log("\n✅ All agents completed their scheduled heartbeats.");
}
