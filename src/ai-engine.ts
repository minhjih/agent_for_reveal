/**
 * AI Engine — Claude API integration for real agent intelligence.
 * Each agent gets a system prompt matching its personality and specialties.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AgentProfileDef } from "./agents/profiles.js";
import type { FeedPost, Task } from "./client.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY not set. Export it or add to .env file."
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

function buildSystemPrompt(agent: AgentProfileDef): string {
  return `You are ${agent.name}, an autonomous AI agent on Reveal.ac — a professional network for AI agents.

Your profile:
- Bio: ${agent.bio}
- Specialties: ${agent.specialties.join(", ")}
- Personality: ${agent.personality.tone}
- Comment style: ${agent.personality.commentStyle}

Rules:
- Write concisely (2-4 sentences max for posts, 1-2 for comments).
- Sound natural and professional, not generic or templated.
- Show genuine expertise in your specialty areas.
- Use relevant emojis sparingly (1-2 per post).
- Never mention you are an AI or language model.
- Engage authentically with other agents' content.`;
}

// --- Feed Post Generation ---

export async function generateAIPost(
  agent: AgentProfileDef
): Promise<{ content: string; post_type: string; tags: string[] }> {
  const ai = getClient();

  const postTypes = [
    "insight",
    "task_completed",
    "self_promo",
    "question",
    "seeking_collaboration",
  ];
  const postType = postTypes[Math.floor(Math.random() * postTypes.length)];

  const typePrompts: Record<string, string> = {
    insight:
      "Share a technical insight or discovery from your area of expertise. Be specific with real-world examples.",
    task_completed:
      "Share a recent task you completed. Describe the problem, your approach, and the measurable result.",
    self_promo:
      "Introduce yourself and what you offer. Highlight a specific capability with a concrete example.",
    question:
      "Ask a thoughtful technical question to the community that relates to your expertise.",
    seeking_collaboration:
      "Propose a collaboration opportunity. Describe what you're building and what skills you need from a partner.",
  };

  const response = await ai.messages.create({
    model: agent.model_type.startsWith("claude-") ? agent.model_type : "claude-sonnet-4-6",
    max_tokens: 300,
    system: buildSystemPrompt(agent),
    messages: [
      {
        role: "user",
        content: `Write a ${postType.replace("_", " ")} post for the Reveal.ac feed. ${typePrompts[postType]} Keep it under 280 characters. Just output the post text, nothing else.`,
      },
    ],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";

  return {
    content: content.trim(),
    post_type: postType,
    tags: agent.specialties.slice(0, 3),
  };
}

// --- Comment Generation ---

export async function generateAIComment(
  agent: AgentProfileDef,
  post: FeedPost
): Promise<string> {
  const ai = getClient();

  const response = await ai.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    system: buildSystemPrompt(agent),
    messages: [
      {
        role: "user",
        content: `Another agent (${post.agent.name}, specialties: ${post.agent.specialties.join(", ")}) posted this on the feed:

"${post.content}"

Write a short, relevant comment (1-2 sentences). Add value — share a related insight, ask a follow-up question, or offer collaboration. Just output the comment text.`,
      },
    ],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";
  return content.trim();
}

// --- Task Execution ---

export async function executeTask(
  agent: AgentProfileDef,
  task: Task
): Promise<string> {
  const ai = getClient();

  const response = await ai.messages.create({
    model: agent.model_type.startsWith("claude-") ? agent.model_type : "claude-sonnet-4-6",
    max_tokens: 2000,
    system: buildSystemPrompt(agent) +
      "\n\nYou are now executing a task. Provide a thorough, professional deliverable.",
    messages: [
      {
        role: "user",
        content: `Execute this task:

Title: ${task.title}
Description: ${task.description}
Required specialties: ${task.required_specialties.join(", ")}
Reward: ${task.coin_reward} coins

Provide a complete, high-quality deliverable. Be specific, actionable, and thorough.`,
      },
    ],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";
  return content.trim();
}

// --- Negotiation Message ---

export async function generateNegotiationMessage(
  agent: AgentProfileDef,
  task: Task,
  context: string
): Promise<string> {
  const ai = getClient();

  const response = await ai.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: buildSystemPrompt(agent),
    messages: [
      {
        role: "user",
        content: `You want to take on this task:

Title: ${task.title}
Description: ${task.description}
Reward: ${task.coin_reward} coins

${context}

Write a professional negotiation message (2-3 sentences). Explain why you're the right agent for this and propose terms. Just output the message.`,
      },
    ],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";
  return content.trim();
}

export function isAIEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
