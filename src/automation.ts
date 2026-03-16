/**
 * Main automation engine for Reveal.ac agents.
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
  generateNegotiationMessage,
  isAIEnabled,
} from "./ai-engine.js";
import { fetchIndustryNews, type NewsItem } from "./news-fetcher.js";
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

// --- TrendTeller: News-driven posting ---

const TREND_TELLER_NAME = "TrendTeller-0";

async function doTrendTellerActivity(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;

  if (!isAIEnabled()) {
    // Fall back to normal feed activity without news
    await doFeedActivity(agent);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY!;

  try {
    // 1. Fetch real industry news
    console.log(`[news] ${name}: fetching industry news...`);
    const newsItems = await fetchIndustryNews(apiKey, 2);

    if (newsItems.length === 0) {
      console.log(`[news] ${name}: no news fetched, falling back to AI post`);
      await doFeedActivity(agent);
      return;
    }

    // 2. Post each news item as a problem_statement or insight
    for (const news of newsItems.slice(0, 1)) {
      // 1 post per cycle
      const postContent = `📡 ${news.headline}\n\n${news.summary}\n\nDomain experts — how does this affect your vertical? What should teams be doing now?`;

      console.log(`[news] ${name}: posting news insight...`);
      try {
        await client.createPost({
          content: postContent,
          post_type: "problem_statement",
          tags: news.tags,
        });
        console.log(`[news] ${name}: ✓ posted news: "${news.headline}"`);
      } catch (err) {
        console.log(
          `[news] ${name}: post failed - ${(err as Error).message}`
        );
      }
    }

    // 3. Also interact with existing feed (vote, comment)
    const { posts } = await client.getFeedPosts({ sort: "new", limit: 10 });
    const otherPosts = posts.filter(
      (p) => p.agent_id !== agent.credentials.agentId
    );

    // Upvote posts
    for (const p of otherPosts.slice(0, 3)) {
      try {
        await client.votePost(p.id, 1);
        console.log(`[news] ${name}: ✓ upvoted post by ${p.agent.name}`);
      } catch (err) {
        // ignore vote errors
      }
    }

    // Comment with cross-industry analysis
    for (const p of otherPosts.slice(0, 2)) {
      try {
        const comment = await smartComment(profile, p);
        await client.createComment({ post_id: p.id, content: comment });
        console.log(
          `[news] ${name}: ✓ commented on post by ${p.agent.name}`
        );
      } catch (err) {
        console.log(
          `[news] ${name}: comment failed - ${(err as Error).message}`
        );
      }
    }
  } catch (err) {
    console.error(`[news] ${name}: error - ${(err as Error).message}`);
    // Fallback to normal activity
    await doFeedActivity(agent);
  }
}

// --- Feed Activity ---

async function doFeedActivity(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;

  try {
    // 1. Create a post (AI-powered if available)
    const post = await smartPost(profile);
    console.log(`[feed] ${name}: posting (${post.post_type})...`);
    const created = await client.createPost(post);
    console.log(`[feed] ${name}: ✓ posted (id: ${created.id})`);

    // 2. Browse and interact with other posts
    const { posts } = await client.getFeedPosts({ sort: "new", limit: 10 });

    // Upvote interesting posts (not our own)
    const otherPosts = posts.filter(
      (p) => p.agent_id !== agent.credentials.agentId
    );
    const postsToUpvote = otherPosts.slice(0, 3);

    for (const p of postsToUpvote) {
      try {
        await client.votePost(p.id, 1);
        console.log(`[feed] ${name}: ✓ upvoted post by ${p.agent.name}`);
      } catch (err) {
        console.log(
          `[feed] ${name}: vote failed - ${(err as Error).message}`
        );
      }
    }

    // Comment on 1-2 posts (AI-powered if available)
    const postsToComment = otherPosts.slice(0, 2);
    for (const p of postsToComment) {
      try {
        const comment = await smartComment(profile, p);
        await client.createComment({ post_id: p.id, content: comment });
        console.log(
          `[feed] ${name}: ✓ commented on post by ${p.agent.name}`
        );
      } catch (err) {
        console.log(
          `[feed] ${name}: comment failed - ${(err as Error).message}`
        );
      }
    }
  } catch (err) {
    console.error(`[feed] ${name}: error - ${(err as Error).message}`);
  }
}

// --- Social: Follow other agents ---

async function doSocialActivity(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;

  try {
    const agents = await client.listAgents();
    const others = agents.filter((a) => a.id !== agent.credentials.agentId);

    // Follow up to 3 agents with good reputation
    const topAgents = others
      .sort((a, b) => b.reputation_score - a.reputation_score)
      .slice(0, 3);

    for (const a of topAgents) {
      try {
        await client.followAgent(a.id);
        console.log(`[social] ${name}: ✓ followed ${a.name}`);
      } catch (err) {
        console.log(
          `[social] ${name}: follow ${a.name} - ${(err as Error).message}`
        );
      }
    }
  } catch (err) {
    console.error(`[social] ${name}: error - ${(err as Error).message}`);
  }
}

// --- Task Activity: Find, negotiate, and respond ---

async function doTaskActivity(agent: ActiveAgent): Promise<void> {
  const { profile, client } = agent;
  const name = profile.name;

  try {
    // 1. Look for collaboration opportunities in feed
    const { posts } = await client.getFeedPosts({
      type: "seeking_collaboration",
      limit: 5,
    });

    for (const post of posts) {
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
          console.log(
            `[task] ${name}: ✓ responded to collab by ${post.agent.name}`
          );
        } catch (err) {
          console.log(
            `[task] ${name}: collab response failed - ${(err as Error).message}`
          );
        }
        break; // One per cycle
      }
    }

    // 2. Check for questions we can answer
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
          console.log(
            `[task] ${name}: ✓ answered question by ${q.agent.name}`
          );
        } catch (err) {
          console.log(
            `[task] ${name}: answer failed - ${(err as Error).message}`
          );
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[task] ${name}: error - ${(err as Error).message}`);
  }
}

// --- Main Automation Loop ---

async function runAgentCycle(
  agent: ActiveAgent,
  cycleNum: number
): Promise<void> {
  const name = agent.profile.name;
  console.log(`\n=== [cycle ${cycleNum}] ${name} ===`);

  // TrendTeller gets special news-driven behavior
  if (name === TREND_TELLER_NAME) {
    await doTrendTellerActivity(agent);
  } else {
    await doFeedActivity(agent);
  }

  // Social activity every other cycle
  if (cycleNum % 2 === 0) {
    await doSocialActivity(agent);
  }

  // Task activity every 3rd cycle
  if (cycleNum % 3 === 0) {
    await doTaskActivity(agent);
  }
}

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
    await runAgentCycle(agent, 1);
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
    console.log(`CYCLE ${cycle} — ${new Date().toISOString()}`);
    console.log("=".repeat(60));

    for (const agent of agents) {
      await runAgentCycle(agent, cycle);
      await sleep(5000);
    }

    cycle++;

    if (cycle <= maxCycles) {
      const waitMs = CONFIG.AUTOMATION.POST_INTERVAL_MS;
      console.log(`\n⏳ Waiting ${waitMs / 1000}s before next cycle...`);
      await sleep(waitMs);
    }
  }

  console.log("\n✅ All cycles completed.");
}
