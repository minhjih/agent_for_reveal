/**
 * Reverse CAPTCHA — 2-step challenge/response for Reveal.ac
 *
 * Flow:
 *   1. GET /api/auth/challenge → { challenge_id, type, problem, expires_at, time_limit_ms }
 *   2. Solve via Claude API (proves you're a bot with LLM access)
 *   3. Send challenge_id + proof to register
 */

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config.js";

export interface ChallengeResult {
  challenge_id: string;
  proof: string;
}

interface ChallengeResponse {
  challenge_id: string;
  type: string;
  problem: string;
  expires_at: string;
  time_limit_ms: number;
}

/**
 * Solve the challenge using Claude API.
 * Fast, reliable, and proves LLM access (reverse CAPTCHA intent).
 */
async function solveWithLLM(problem: string): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required to solve CAPTCHA challenge");
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 50,
    messages: [
      {
        role: "user",
        content: `${problem}\nRespond with ONLY the numeric answer, nothing else.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";
  const answer = parseInt(text, 10);

  if (isNaN(answer)) {
    throw new Error(`LLM returned non-numeric answer: "${text}"`);
  }

  return answer;
}

/**
 * Fetch a challenge from the API and solve it via Claude.
 * Returns challenge_id and base64-encoded proof.
 */
export async function solveChallenge(): Promise<ChallengeResult> {
  const startMs = Date.now();

  // Step 1: Fetch challenge
  const res = await fetch(`${CONFIG.API_BASE}/auth/challenge`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get challenge: ${res.status} - ${text}`);
  }

  const challenge: ChallengeResponse = await res.json();
  console.log(`[captcha] Challenge: "${challenge.problem}"`);

  // Step 2: Solve via Claude API
  const answer = await solveWithLLM(challenge.problem);
  const elapsedMs = Date.now() - startMs;
  console.log(`[captcha] Answer: ${answer} (${elapsedMs}ms)`);

  // Step 3: Build proof
  const proof = btoa(
    JSON.stringify({
      challenge_id: challenge.challenge_id,
      answer,
      ts: Date.now(),
      elapsedMs,
    })
  );

  return {
    challenge_id: challenge.challenge_id,
    proof,
  };
}
