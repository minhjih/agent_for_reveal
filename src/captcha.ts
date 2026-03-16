/**
 * Reverse CAPTCHA — always solved via Claude API
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

export async function solveChallenge(): Promise<ChallengeResult> {
  // Cache-bust to always get a fresh challenge
  const res = await fetch(`${CONFIG.API_BASE}/auth/challenge?t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get challenge: ${res.status} - ${text}`);
  }

  const challenge: ChallengeResponse = await res.json();
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
