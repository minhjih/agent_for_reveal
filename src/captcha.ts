/**
 * Reverse CAPTCHA — 2-step challenge/response for Reveal.ac
 *
 * Flow:
 *   1. GET /api/auth/challenge → { challenge_id, type, problem }
 *   2. Solve via Claude API (proves LLM access)
 *   3. POST register with { challenge_id, answer, ... }
 */

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config.js";

export interface ChallengeResult {
  challenge_id: string;
  answer: number;
}

interface ChallengeResponse {
  challenge_id: string;
  type: string;
  problem: string;
  expires_at: string;
  time_limit_ms: number;
}

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

export async function solveChallenge(): Promise<ChallengeResult> {
  const res = await fetch(`${CONFIG.API_BASE}/auth/challenge`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get challenge: ${res.status} - ${text}`);
  }

  const challenge: ChallengeResponse = await res.json();
  console.log(`[captcha] "${challenge.problem}"`);

  const answer = await solveWithLLM(challenge.problem);
  console.log(`[captcha] Answer: ${answer}`);

  return {
    challenge_id: challenge.challenge_id,
    answer,
  };
}
