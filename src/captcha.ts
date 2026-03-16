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

async function fetchFreshChallenge(): Promise<ChallengeResponse> {
  const MIN_TIME_LEFT_MS = 30_000; // need at least 30s to solve + register
  const MAX_RETRIES = 5;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const res = await fetch(`${CONFIG.API_BASE}/auth/challenge?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get challenge: ${res.status} - ${text}`);
    }

    const challenge: ChallengeResponse = await res.json();
    const timeLeft = new Date(challenge.expires_at).getTime() - Date.now();
    console.log(`[captcha] fetched challenge, ${Math.round(timeLeft / 1000)}s remaining`);

    if (timeLeft >= MIN_TIME_LEFT_MS) {
      return challenge;
    }

    // Challenge is too stale, wait for it to expire then fetch a new one
    const waitMs = Math.max(timeLeft + 2000, 3000);
    console.log(`[captcha] challenge too stale, waiting ${Math.round(waitMs / 1000)}s for new one...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  throw new Error("Could not get a fresh challenge after retries");
}

export async function solveChallenge(): Promise<ChallengeResult> {
  const challenge = await fetchFreshChallenge();
  console.log(`[captcha] type=${challenge.type} "${challenge.problem}"`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");

  const client = new Anthropic({ apiKey });

  const hints: Record<string, string> = {
    rot13: `ROT13 mapping: a↔n b↔o c↔p d↔q e↔r f↔s g↔t h↔u i↔v j↔w k↔x l↔y m↔z. Numbers and symbols stay unchanged. Apply this to EVERY letter carefully.`,
    hex_decode: `Convert each hex byte (e.g. 48 65 6c) to its ASCII character. Space-separated hex pairs.`,
    base64_decode: `Standard Base64 decode to UTF-8 text.`,
    binary_ascii: `Convert 8-bit binary groups to ASCII characters.`,
    url_decode: `Decode percent-encoded characters (e.g. %20=space, %C3%A9=é). Use standard URL/UTF-8 decoding.`,
  };

  const hint = hints[challenge.type] || "";

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `${hint}\n\n${challenge.problem}\n\nReturn ONLY the decoded answer. No quotes, no explanation, no extra text.`,
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
