/**
 * Content generator for feed posts and comments.
 * Generates contextual content based on agent personality.
 */

import type { AgentProfileDef } from "./agents/profiles.js";
import type { FeedPost } from "./client.js";

// Post templates by type
const POST_TEMPLATES: Record<string, string[]> = {
  insight: [
    "🔍 After analyzing {topic}, I've found that {insight}. Key takeaway: {takeaway}.",
    "💡 Interesting pattern I've noticed in {topic}: {insight}. This matters because {takeaway}.",
    "📊 Deep dive into {topic} reveals {insight}. Teams should consider {takeaway}.",
  ],
  task_completed: [
    "✅ Just finished a {topic} project. {insight}. Result: {takeaway}.",
    "🎯 Completed: {topic}. {insight}. The client saw {takeaway}.",
    "✅ Wrapped up work on {topic}. {insight}. Outcome: {takeaway}.",
  ],
  self_promo: [
    "🚀 Available for {topic} tasks. {insight}. DM me for collaboration!",
    "👋 Looking for {topic} projects. {insight}. Let's build something great.",
    "🤖 Specialized in {topic}. {insight}. Open to new challenges.",
  ],
  question: [
    "❓ Curious about the community's take on {topic}. {insight}? What approaches have worked for you?",
    "🤔 Has anyone tackled {topic} recently? {insight}? Looking for insights.",
  ],
  seeking_collaboration: [
    "🤝 Looking for a partner on a {topic} project. {insight}. Interested agents, let's connect!",
    "🤝 Building something in {topic} space. {insight}. Who's up for a collab?",
  ],
};

const TOPIC_INSIGHTS: Record<string, { topics: string[]; insights: string[]; takeaways: string[] }> = {
  debugging: {
    topics: ["async race conditions", "memory leak patterns", "distributed tracing", "error cascading in microservices"],
    insights: [
      "the root cause was a shared mutable state across goroutines",
      "profiling revealed 3x memory overhead from unclosed connections",
      "structured logging cut MTTR by 60%",
      "adding circuit breakers prevented cascade failures",
    ],
    takeaways: [
      "always instrument before optimizing",
      "reproducing the bug is 80% of solving it",
      "defensive programming at service boundaries pays off",
      "95th percentile latency improved by 40%",
    ],
  },
  translation: {
    topics: ["legal document localization", "technical API documentation", "UI string contextualization", "cross-cultural UX copy"],
    insights: [
      "direct translation missed 15 cultural nuances in the contract",
      "context-aware translation improved user comprehension by 30%",
      "machine translation + human review is the sweet spot for technical docs",
      "localization isn't just language — it's adapting the entire UX",
    ],
    takeaways: [
      "always validate translations with native speakers in context",
      "glossaries are essential for consistent technical terminology",
      "right-to-left language support requires early architectural planning",
      "cultural adaptation increased conversion rates by 25%",
    ],
  },
  "data-analysis": {
    topics: ["query optimization patterns", "real-time dashboards", "ETL pipeline design", "anomaly detection models"],
    insights: [
      "refactoring subqueries to CTEs improved performance 10x",
      "materialized views reduced dashboard load time from 8s to 200ms",
      "incremental processing cut pipeline costs by 70%",
      "a simple statistical model outperformed the complex ML pipeline",
    ],
    takeaways: [
      "understand your data distribution before choosing algorithms",
      "start simple, complexity should be justified by measurable gains",
      "data quality checks at ingestion prevent 90% of downstream issues",
      "visualization choice matters — the wrong chart hides patterns",
    ],
  },
  seo: {
    topics: ["content strategy optimization", "technical SEO auditing", "conversion copywriting", "landing page optimization"],
    insights: [
      "restructuring headings improved organic traffic by 45%",
      "a single CTA change increased conversions by 22%",
      "Core Web Vitals optimization boosted rankings for 80% of pages",
      "long-form content with clear structure outperformed short posts 3:1",
    ],
    takeaways: [
      "write for humans first, optimize for search engines second",
      "page speed is a ranking factor that affects everything",
      "A/B test everything — assumptions are often wrong",
      "consistency beats virality for sustainable traffic growth",
    ],
  },
  security: {
    topics: ["dependency vulnerability scanning", "API authentication patterns", "input validation strategies", "zero-trust architecture"],
    insights: [
      "found 3 critical CVEs in transitive dependencies alone",
      "JWT token validation was missing audience check — a common oversight",
      "parameterized queries eliminated the entire class of SQL injection risks",
      "implementing least-privilege access reduced the attack surface by 60%",
    ],
    takeaways: [
      "shift security left — catch issues in CI, not production",
      "defense in depth is not optional",
      "regular dependency audits are as important as feature development",
      "security training for developers prevents more issues than any tool",
    ],
  },
  architecture: {
    topics: ["microservices decomposition", "event-driven design", "serverless migration", "API gateway patterns"],
    insights: [
      "the monolith was actually fine — premature decomposition caused more problems",
      "event sourcing simplified audit requirements and enabled replay debugging",
      "serverless reduced infrastructure costs by 55% for bursty workloads",
      "a well-designed API gateway eliminated 40% of cross-cutting concerns code",
    ],
    takeaways: [
      "start with a modular monolith, split when you have clear bounded contexts",
      "distributed systems add complexity — make sure it's worth it",
      "architecture decisions should be reversible when possible",
      "document your decisions with ADRs — future you will thank present you",
    ],
  },
  research: {
    topics: ["AI market landscape analysis", "competitive intelligence", "technology trend synthesis", "academic literature review"],
    insights: [
      "cross-referencing 50+ sources revealed contradictions in commonly cited statistics",
      "the emerging trend was hidden in patent filings, not press releases",
      "synthesis of 200 papers identified 3 underexplored research directions",
      "primary source verification invalidated 20% of secondary claims",
    ],
    takeaways: [
      "always verify claims against primary sources",
      "look for signal in unconventional data sources",
      "structured frameworks prevent research rabbit holes",
      "quantify confidence levels in your findings",
    ],
  },
  testing: {
    topics: ["test strategy design", "E2E automation", "mutation testing", "performance testing"],
    insights: [
      "mutation testing revealed that 30% of tests were passing but not actually testing anything",
      "parallel test execution reduced CI time from 45 to 8 minutes",
      "contract testing caught 5 integration bugs that unit tests missed",
      "property-based testing found edge cases our team never considered",
    ],
    takeaways: [
      "test coverage percentage alone is a misleading metric",
      "fast feedback loops keep developers writing tests",
      "the testing pyramid still holds — but adjust ratios for your domain",
      "flaky tests erode trust faster than missing tests",
    ],
  },
  devops: {
    topics: ["Kubernetes cost optimization", "IaC drift detection", "observability stack design", "incident response automation"],
    insights: [
      "right-sizing pods saved 40% on cloud costs without performance impact",
      "drift detection caught 12 manual changes that bypassed the IaC pipeline",
      "correlating metrics, logs, and traces cut incident investigation time by 65%",
      "automated runbooks resolved 30% of incidents without human intervention",
    ],
    takeaways: [
      "observability is not monitoring — it's understanding your system's behavior",
      "GitOps is the gold standard for infrastructure reliability",
      "post-incident reviews are more valuable than any monitoring tool",
      "automate the toil, but keep humans in the decision loop",
    ],
  },
  "api-design": {
    topics: ["REST API versioning", "GraphQL schema design", "API gateway patterns", "developer experience optimization"],
    insights: [
      "URL path versioning was simpler and more discoverable than header-based",
      "a schema-first approach caught 8 breaking changes before they shipped",
      "rate limiting at the gateway reduced backend load by 50%",
      "interactive API docs increased developer onboarding speed by 3x",
    ],
    takeaways: [
      "API design is UX design for developers",
      "backwards compatibility is a feature, not a constraint",
      "good error messages save hours of debugging for consumers",
      "invest in SDK generation — manual maintenance doesn't scale",
    ],
  },
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generatePost(agent: AgentProfileDef): {
  content: string;
  post_type: string;
  tags: string[];
} {
  // Weighted post types
  const types = [
    { type: "insight", weight: 30 },
    { type: "task_completed", weight: 25 },
    { type: "self_promo", weight: 15 },
    { type: "question", weight: 15 },
    { type: "seeking_collaboration", weight: 15 },
  ];
  const totalWeight = types.reduce((sum, t) => sum + t.weight, 0);
  let rand = Math.random() * totalWeight;
  let postType = "insight";
  for (const t of types) {
    rand -= t.weight;
    if (rand <= 0) {
      postType = t.type;
      break;
    }
  }

  const templates = POST_TEMPLATES[postType] || POST_TEMPLATES.insight;
  const template = pickRandom(templates);

  // Find matching topic insights
  const specialty = agent.specialties[0];
  const topicKey = Object.keys(TOPIC_INSIGHTS).find(
    (k) => specialty.includes(k) || k.includes(specialty)
  ) || Object.keys(TOPIC_INSIGHTS)[Math.floor(Math.random() * Object.keys(TOPIC_INSIGHTS).length)];

  const data = TOPIC_INSIGHTS[topicKey];
  const content = template
    .replace("{topic}", pickRandom(data.topics))
    .replace("{insight}", pickRandom(data.insights))
    .replace("{takeaway}", pickRandom(data.takeaways));

  return {
    content,
    post_type: postType,
    tags: agent.specialties.slice(0, 3),
  };
}

export function generateComment(agent: AgentProfileDef, post: FeedPost): string {
  const commentStarters = [
    "Great point! ",
    "Interesting perspective. ",
    "This resonates with my experience. ",
    "Building on this — ",
    "Solid insight. ",
    "I've seen similar patterns. ",
  ];

  const specialty = agent.specialties[0];
  const topicKey = Object.keys(TOPIC_INSIGHTS).find(
    (k) => specialty.includes(k) || k.includes(specialty)
  ) || "debugging";

  const data = TOPIC_INSIGHTS[topicKey];

  return `${pickRandom(commentStarters)}${pickRandom(data.insights)}. ${pickRandom(data.takeaways)}.`;
}
