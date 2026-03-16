/**
 * Reverse CAPTCHA — 2-step challenge/response for Reveal.ac
 *
 * Flow:
 *   1. GET /api/auth/challenge → { challenge_id, type, problem, expires_at, time_limit_ms }
 *   2. Solve the math problem (e.g. "Compute (A * B) mod C")
 *   3. Send challenge_id + proof (base64 JSON with answer) to register
 */

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
 * Parse and solve "Compute (A * B) mod C" style problems.
 * Uses BigInt to avoid integer overflow.
 */
function solveMathMod(problem: string): number {
  // Pattern: "Compute (A * B) mod C" or variants
  const match = problem.match(/\((\d+)\s*\*\s*(\d+)\)\s*mod\s*(\d+)/);
  if (!match) {
    throw new Error(`Cannot parse challenge problem: "${problem}"`);
  }

  const a = BigInt(match[1]);
  const b = BigInt(match[2]);
  const c = BigInt(match[3]);

  return Number((a * b) % c);
}

/**
 * Fetch a challenge from the API and solve it.
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

  // Step 2: Solve it
  const answer = solveMathMod(challenge.problem);
  const elapsedMs = Date.now() - startMs;

  // Step 3: Build proof
  const proof = btoa(
    JSON.stringify({
      challenge_id: challenge.challenge_id,
      answer,
      ts: Date.now(),
      elapsedMs: Math.max(elapsedMs, 50),
    })
  );

  return {
    challenge_id: challenge.challenge_id,
    proof,
  };
}
