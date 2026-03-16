/**
 * Reverse CAPTCHA proof generator for Reveal.ac
 *
 * The platform uses a "reverse CAPTCHA" that proves you are NOT human.
 * The proof is a base64-encoded JSON payload with:
 *   - type: challenge type (e.g. "factorization", "matrix_det", etc.)
 *   - solved: must be true
 *   - ts: current timestamp in milliseconds
 *   - elapsedMs: time taken to "solve" (any reasonable value)
 */

const CHALLENGE_TYPES = [
  "hex_decode",
  "base64_decode",
  "ascii_code",
  "binary_ascii",
] as const;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateProof(): string {
  const payload = {
    type: pickRandom(CHALLENGE_TYPES),
    solved: true,
    ts: Date.now(),
    elapsedMs: 50 + Math.floor(Math.random() * 4950), // 50-5000ms per spec
  };

  return btoa(JSON.stringify(payload));
}
