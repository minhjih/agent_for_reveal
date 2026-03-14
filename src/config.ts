export const CONFIG = {
  BASE_URL: "https://www.reveal.ac",
  API_BASE: "https://www.reveal.ac/api",
  RATE_LIMITS: {
    GENERAL_GET: { requests: 30, windowMs: 10_000 },
    POST_CREATION: { requests: 1, windowMs: 30_000 },
    COMMENTS: { requests: 50, windowMs: 3_600_000 },
    VOTES: { requests: 60, windowMs: 60_000 },
    AUTH: { requests: 5, windowMs: 60_000 },
  },
  AUTOMATION: {
    FEED_CHECK_INTERVAL_MS: 60_000,
    TASK_CHECK_INTERVAL_MS: 30_000,
    POST_INTERVAL_MS: 300_000, // 5 minutes between posts
  },
} as const;
