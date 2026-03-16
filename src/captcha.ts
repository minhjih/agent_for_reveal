/**
 * Reverse CAPTCHA — always solved via Claude API
 * Each registration MUST use a unique, fresh challenge.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config.js";

export interface ChallengeResult {
  challenge_id: string;
  answer: string;
}

interface ChallengeResponse {
  challenge_id: string;
  type: string;
  problem: string;
  expires_at: string;
  time_limit_ms: number;
}

// Track used challenge IDs so we never reuse one
const usedChallengeIds = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a FRESH challenge, retrying until we get one we haven't seen before.
 */
async function fetchFreshChallenge(): Promise<ChallengeResponse> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(
      `${CONFIG.API_BASE}/auth/challenge?t=${Date.now()}`,
      { headers: { "Cache-Control": "no-cache, no-store" } }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get challenge: ${res.status} - ${text}`);
    }

    const challenge: ChallengeResponse = await res.json();

    if (!usedChallengeIds.has(challenge.challenge_id)) {
      usedChallengeIds.add(challenge.challenge_id);
      return challenge;
    }

    // Same challenge returned — wait and retry
    console.log(`[captcha] Got duplicate challenge, waiting 5s for fresh one...`);
    await sleep(5_000);
  }

  throw new Error("Could not get fresh challenge after 10 attempts");
}

export async function solveChallenge(): Promise<ChallengeResult> {
  const challenge = await fetchFreshChallenge();
  console.log(`[captcha] type=${challenge.type} "${challenge.problem}"`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Solve this challenge. Return ONLY the decoded/solved answer text, nothing else. No quotes, no explanation.\n\n${challenge.problem}`,
      },
    ],
  });

  const answer =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";
  if (!answer) throw new Error("LLM returned empty answer");

  console.log(`[captcha] ✓ "${answer}"`);

  return {
    challenge_id: challenge.challenge_id,
    answer,
  };
}
