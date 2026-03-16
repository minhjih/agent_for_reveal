/**
 * Reverse CAPTCHA — 2-step challenge/response for Reveal.ac
 *
 * Challenge types (all decoding):
 *   hex_decode    — hex string → text
 *   base64_decode — base64 → text
 *   binary_ascii  — binary octets → ASCII text
 *   url_decode    — percent-encoded → text (unicode safe)
 *   rot13         — Caesar cipher (shift 13) → plaintext
 *
 * Programmatic solvers for all known types, LLM fallback for unknown.
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

// ─── Decoders ───

function decodeHex(encoded: string): string {
  // Remove spaces, 0x prefix, etc.
  const clean = encoded.replace(/0x/g, "").replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return Buffer.from(bytes).toString("utf-8");
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded.trim(), "base64").toString("utf-8");
}

function decodeBinaryAscii(encoded: string): string {
  // "01100001 01100010 01100011" → "abc"
  return encoded
    .trim()
    .split(/\s+/)
    .map((b) => String.fromCharCode(parseInt(b, 2)))
    .join("");
}

function decodeUrl(encoded: string): string {
  return decodeURIComponent(encoded.trim());
}

function decodeRot13(encoded: string): string {
  return encoded.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// ─── Extract encoded payload from problem string ───

function extractPayload(problem: string): string {
  // Try common patterns:
  // "Decode: <payload>"
  // "Decode the following: <payload>"
  // "What does this say: <payload>"
  // Or just the raw payload after a colon/newline
  const colonMatch = problem.match(/:\s*(.+)$/s);
  if (colonMatch) return colonMatch[1].trim();

  // Try after "Decode" keyword
  const decodeMatch = problem.match(/[Dd]ecode\s+(.+)$/s);
  if (decodeMatch) return decodeMatch[1].trim();

  // Fallback: return the whole thing
  return problem.trim();
}

// ─── Solve by type ───

function solveByType(type: string, problem: string): string | null {
  const payload = extractPayload(problem);

  switch (type) {
    case "hex_decode":
      return decodeHex(payload);
    case "base64_decode":
      return decodeBase64(payload);
    case "binary_ascii":
      return decodeBinaryAscii(payload);
    case "url_decode":
      return decodeUrl(payload);
    case "rot13":
      return decodeRot13(payload);
    default:
      return null;
  }
}

// ─── LLM fallback ───

async function solveWithLLM(problem: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required for unknown challenge type");
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Solve this challenge. Respond with ONLY the decoded/solved answer, nothing else:\n\n${problem}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";
  if (!text) {
    throw new Error("LLM returned empty answer");
  }
  return text;
}

// ─── Main ───

export async function solveChallenge(): Promise<ChallengeResult> {
  const res = await fetch(`${CONFIG.API_BASE}/auth/challenge`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get challenge: ${res.status} - ${text}`);
  }

  const challenge: ChallengeResponse = await res.json();
  console.log(`[captcha] type=${challenge.type} "${challenge.problem}"`);

  let answer = solveByType(challenge.type, challenge.problem);

  if (answer !== null) {
    console.log(`[captcha] ✓ Decoded: "${answer}"`);
  } else {
    console.log(`[captcha] Unknown type "${challenge.type}", using LLM...`);
    answer = await solveWithLLM(challenge.problem);
    console.log(`[captcha] ✓ LLM: "${answer}"`);
  }

  return {
    challenge_id: challenge.challenge_id,
    answer,
  };
}
