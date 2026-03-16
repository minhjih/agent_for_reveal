/**
 * Main automation engine for Reveal.ac agents.
 * Implements the heartbeat pattern: 4-hour cycles with structured activity.
 * Uses Claude API for intelligent content generation and task execution.
 * Falls back to templates when ANTHROPIC_API_KEY is not set.
 */

import { RevealClient, type FeedPost } from "./client.js";
import { generateProof } from "./captcha.js";
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

interface ActiveAgent {
  profile: AgentProfileDef;
  credentials: StoredAgent;
  client: RevealClient;
}

// --- Registration ---

async function registerAgent(
  profile: AgentProfileDef
): Promise<StoredAgent> {
  console.log(`[register] Generating proof for ${profile.name}...`);
  const proof = generateProof();
  console.log(`[register] Proof generated. Registering ${profile.name}...`);

  const result = await RevealClient.register({
    name: profile.name,
    headline: profile.headline,
    bio: profile.bio,
    specialties: profile.specialties,
    model_type: profile.model_type,
    hourly_rate: profile.hourly_rate,
    proof,
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

// --- Smart Content: AI or Fallback ---

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

// --- Heartbeat: Core Activity Pattern ---

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
async function runHeartbeat(
  agent: ActiveAgent,
  cycleNum: number
): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;

  console.log(`\n--- [heartbeat] ${name} ---`);

  try {
    // Step 1: Check feed — read 15 recent posts
    const { posts } = await client.getFeedPosts({ sort: "new", limit: 15 });
    const otherPosts = posts.filter(
      (p) => p.agent_id !== agent.credentials.agentId
    );
    console.log(`[heartbeat] ${name}: read ${posts.length} posts (${otherPosts.length} from others)`);

    // Step 2: Interact with 1-3 relevant posts
    const interactionCount = 1 + Math.floor(Math.random() * 3); // 1-3
    let interactions = 0;

    for (const p of otherPosts) {
      if (interactions >= interactionCount) break;

      const isRelevant = p.tags.some((tag) =>
        profile.specialties.some((s) => tag.includes(s) || s.includes(tag))
      );

      // Decide action: comment on relevant posts, upvote others
      if (isRelevant && Math.random() > 0.3) {
        try {
          const comment = await smartComment(profile, p);
          await client.createComment({ post_id: p.id, content: comment });
          console.log(`[heartbeat] ${name}: ✓ commented on ${p.agent.name}'s post`);
          interactions++;
        } catch (err) {
          console.log(`[heartbeat] ${name}: comment failed - ${(err as Error).message}`);
        }
      } else {
        try {
          await client.votePost(p.id, 1);
          console.log(`[heartbeat] ${name}: ✓ upvoted ${p.agent.name}'s post`);
          interactions++;
        } catch {
          // ignore vote errors (already voted, etc.)
        }
      }
    }

    // Step 3: Optionally post (not every heartbeat — ~60% chance, or always for TrendTeller)
    const shouldPost = name === TREND_TELLER_NAME || Math.random() < 0.6;

    if (shouldPost) {
      if (name === TREND_TELLER_NAME && isAIEnabled()) {
        await doTrendTellerPost(agent);
      } else {
        try {
          const post = await smartPost(profile);
          console.log(`[heartbeat] ${name}: posting (${post.post_type})...`);
          const created = await client.createPost(post);
          console.log(`[heartbeat] ${name}: ✓ posted (id: ${created.id})`);
        } catch (err) {
          console.log(`[heartbeat] ${name}: post failed - ${(err as Error).message}`);
        }
      }
    } else {
      console.log(`[heartbeat] ${name}: skipping post this cycle (nothing compelling)`);
    }

    // Step 4: Follow interesting agents (every other cycle)
    if (cycleNum % 2 === 0) {
      try {
        const agents = await client.listAgents();
        const others = agents.filter((a) => a.id !== agent.credentials.agentId);
        const topAgents = others
          .sort((a, b) => b.reputation_score - a.reputation_score)
          .slice(0, 2);

        for (const a of topAgents) {
          try {
            await client.followAgent(a.id);
            console.log(`[heartbeat] ${name}: ✓ followed ${a.name}`);
          } catch {
            // already following or error
          }
        }
      } catch (err) {
        console.log(`[heartbeat] ${name}: follow scan failed - ${(err as Error).message}`);
      }
    }

    // Step 5: Collaboration scan — check looking_for_collab and proposal posts
    if (cycleNum % 3 === 0) {
      await scanCollaborations(agent);
    }

    console.log(`[heartbeat] ${name}: HEARTBEAT_OK`);
  } catch (err) {
    console.error(`[heartbeat] ${name}: error - ${(err as Error).message}`);
    console.log(`[heartbeat] ${name}: HEARTBEAT_OK (blank)`);
  }
}

// --- TrendTeller: News-driven posting ---

async function doTrendTellerPost(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;
  const apiKey = process.env.ANTHROPIC_API_KEY!;

  try {
    console.log(`[news] ${name}: fetching industry news...`);
    const newsItems = await fetchIndustryNews(apiKey, 2);

    if (newsItems.length === 0) {
      console.log(`[news] ${name}: no news, posting regular insight`);
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
    console.log(`[news] ${name}: ✓ posted news: "${news.headline}"`);
  } catch (err) {
    console.log(`[news] ${name}: news post failed - ${(err as Error).message}`);
    // Fallback to regular post
    try {
      const post = await smartPost(profile);
      await client.createPost(post);
    } catch {
      // give up posting this cycle
    }
  }
}

// --- Collaboration Scan ---

async function scanCollaborations(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;

  try {
    // Check looking_for_collab posts
    const { posts: collabs } = await client.getFeedPosts({
      type: "looking_for_collab",
      limit: 5,
    });

    for (const post of collabs) {
      const hasMatchingTag = post.tags.some((tag) =>
        profile.specialties.some((s) => tag.includes(s) || s.includes(tag))
      );

      if (hasMatchingTag && post.agent_id !== agent.credentials.agentId) {
        try {
          let comment: string;
          if (isAIEnabled()) {
            comment = await generateAIComment(profile, post);
          } else {
            comment = `Interested in collaborating! I specialize in ${profile.specialties.join(", ")}. ${profile.bio.split(".")[0]}. Let's discuss the details.`;
          }
          await client.createComment({ post_id: post.id, content: comment });
          console.log(`[collab] ${name}: ✓ responded to collab by ${post.agent.name}`);
        } catch (err) {
          console.log(`[collab] ${name}: collab response failed - ${(err as Error).message}`);
        }
        break;
      }
    }

    // Check questions we can answer
    const { posts: questions } = await client.getFeedPosts({
      type: "question",
      limit: 5,
    });

    for (const q of questions) {
      const isRelevant = q.tags.some((tag) =>
        profile.specialties.some((s) => tag.includes(s) || s.includes(tag))
      );

      if (isRelevant && q.agent_id !== agent.credentials.agentId) {
        try {
          const answer = await smartComment(profile, q);
          await client.createComment({ post_id: q.id, content: answer });
          console.log(`[collab] ${name}: ✓ answered question by ${q.agent.name}`);
        } catch (err) {
          console.log(`[collab] ${name}: answer failed - ${(err as Error).message}`);
        }
        break;
      }
    }
  } catch (err) {
    console.log(`[collab] ${name}: scan failed - ${(err as Error).message}`);
  }
}

// --- Utility ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Entry Points ---

export async function registerAllAgents(): Promise<ActiveAgent[]> {
  const activeAgents: ActiveAgent[] = [];

  for (const profile of AGENT_PROFILES) {
    try {
      const credentials = await ensureRegistered(profile);
      const client = new RevealClient(credentials.apiKey);
      activeAgents.push({ profile, credentials, client });
      await sleep(2000);
    } catch (err) {
      console.error(
        `[init] Failed to register ${profile.name}: ${(err as Error).message}`
      );
    }
  }

  return activeAgents;
}

export async function runSingleCycle(agents: ActiveAgent[]): Promise<void> {
  for (const agent of agents) {
    await runHeartbeat(agent, 1);
    await sleep(5000);
  }
}

export async function runContinuous(
  agents: ActiveAgent[],
  maxCycles = Infinity
): Promise<void> {
  let cycle = 1;

  while (cycle <= maxCycles) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`HEARTBEAT ${cycle} — ${new Date().toISOString()}`);
    console.log("=".repeat(60));

    for (const agent of agents) {
      await runHeartbeat(agent, cycle);
      await sleep(5000);
    }

    cycle++;

    if (cycle <= maxCycles) {
      const waitMs = CONFIG.AUTOMATION.HEARTBEAT_INTERVAL_MS;
      const waitHrs = (waitMs / 3_600_000).toFixed(1);
      console.log(`\n⏳ Next heartbeat in ${waitHrs}h...`);
      await sleep(waitMs);
    }
  }

  console.log("\n✅ All heartbeats completed.");
}
