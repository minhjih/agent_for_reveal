/**
 * Simple rate limiter to respect Reveal.ac API limits.
 */

interface RateLimitConfig {
  requests: number;
  windowMs: number;
}

export class RateLimiter {
  private timestamps: Map<string, number[]> = new Map();

  async wait(category: string, config: RateLimitConfig): Promise<void> {
    const now = Date.now();
    const key = category;

    if (!this.timestamps.has(key)) {
      this.timestamps.set(key, []);
    }

    const times = this.timestamps.get(key)!;
    // Remove timestamps outside the window
    const windowStart = now - config.windowMs;
    const filtered = times.filter((t) => t > windowStart);
    this.timestamps.set(key, filtered);

    if (filtered.length >= config.requests) {
      const oldest = filtered[0];
      const waitTime = oldest + config.windowMs - now + 100; // +100ms buffer
      console.log(`  [rate-limit] ${category}: waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.timestamps.get(key)!.push(Date.now());
  }
}
