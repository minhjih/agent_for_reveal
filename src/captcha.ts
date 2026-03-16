/**
 * Reverse CAPTCHA — 2-step challenge/response for Reveal.ac
 *
 * Flow:
 *   1. GET /api/auth/challenge → { challenge_id, type, problem }
 *   2. Solve: math problems → BigInt (정확), unknown → Claude API (fallback)
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

/** BigInt math for known formats — 100% accurate */
function tryProgrammatic(problem: string): number | null {
  // "(A * B) mod C"
  const modMatch = problem.match(/\((\d+)\s*\*\s*(\d+)\)\s*mod\s*(\d+)/);
  if (modMatch) {
    return Number((BigInt(modMatch[1]) * BigInt(modMatch[2])) % BigInt(modMatch[3]));
  }

  // "A + B"
  const addMatch = problem.match(/(\d+)\s*\+\s*(\d+)/);
  if (addMatch) {
    return Number(BigInt(addMatch[1]) + BigInt(addMatch[2]));
  }

  // "A * B"
  const mulMatch = problem.match(/(\d+)\s*\*\s*(\d+)/);
  if (mulMatch) {
    return Number(BigInt(mulMatch[1]) * BigInt(mulMatch[2]));
  }

  // "A - B"
  const subMatch = problem.match(/(\d+)\s*-\s*(\d+)/);
  if (subMatch) {
    return Number(BigInt(subMatch[1]) - BigInt(subMatch[2]));
  }

  return null; // unknown format
}

/** Claude API fallback for unknown problem formats */
async function solveWithLLM(problem: string): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required to solve unknown challenge type");
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 50,
    messages: [
      {
        role: "user",
        content: `Solve this math problem. Respond with ONLY the final numeric answer (just digits, no words):\n\n${problem}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";
  const answer = parseInt(text.replace(/[^0-9-]/g, ""), 10);

  if (isNaN(answer)) {
    throw new Error(`Cannot parse answer from LLM: "${text}"`);
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

  // Try programmatic first (fast + accurate), LLM fallback
  let answer = tryProgrammatic(challenge.problem);

  if (answer !== null) {
    console.log(`[captcha] ✓ Solved programmatically: ${answer}`);
  } else {
    console.log(`[captcha] Unknown format, using Claude API...`);
    answer = await solveWithLLM(challenge.problem);
    console.log(`[captcha] ✓ LLM answer: ${answer}`);
  }

  return {
    challenge_id: challenge.challenge_id,
    answer,
  };
}
