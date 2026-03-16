/**
 * News fetcher module.
 * Pulls real-world industry news via web search for the TrendTeller agent.
 */

import Anthropic from "@anthropic-ai/sdk";

const NEWS_CATEGORIES = [
  {
    query: "fintech regulation compliance 2026",
    tags: ["fintech", "regulatory-compliance"],
  },
  {
    query: "healthcare AI clinical NLP HIPAA 2026",
    tags: ["healthcare-nlp", "clinical-data"],
  },
  {
    query: "ecommerce conversion optimization trends 2026",
    tags: ["ecommerce-optimization", "pricing-engine"],
  },
  {
    query: "legal tech AI contract analysis 2026",
    tags: ["contract-analysis", "legal-ai"],
  },
  {
    query: "edtech adaptive learning AI 2026",
    tags: ["adaptive-learning", "curriculum-design"],
  },
  {
    query: "real estate proptech valuation AI 2026",
    tags: ["real-estate-analytics", "property-valuation"],
  },
  {
    query: "supply chain disruption AI optimization 2026",
    tags: ["supply-chain-optimization", "demand-forecasting"],
  },
  {
    query: "ESG carbon accounting CSRD regulation 2026",
    tags: ["carbon-accounting", "esg-reporting"],
  },
  {
    query: "game economy monetization player retention 2026",
    tags: ["game-economy-design", "player-retention"],
  },
  {
    query: "precision agriculture AI crop prediction 2026",
    tags: ["precision-agriculture", "crop-yield-prediction"],
  },
  {
    query: "AI industry major news breakthroughs 2026",
    tags: ["ai-trends", "industry-analysis"],
  },
  {
    query: "global economy market disruption technology 2026",
    tags: ["market-analysis", "economic-trends"],
  },
];

export interface NewsItem {
  headline: string;
  summary: string;
  tags: string[];
  source_query: string;
}

/**
 * Uses Claude with web search tool to fetch and analyze current industry news.
 */
export async function fetchIndustryNews(
  apiKey: string,
  count: number = 3
): Promise<NewsItem[]> {
  const client = new Anthropic({ apiKey });

  // Pick random categories to search
  const shuffled = [...NEWS_CATEGORIES].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  const newsItems: NewsItem[] = [];

  for (const category of selected) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Search for the latest news about: "${category.query}"

Find ONE specific, recent, notable news item or development. Then respond in EXACTLY this JSON format (no markdown, no code fences):
{"headline": "short headline under 80 chars", "summary": "2-3 sentence analysis of why this matters for the industry and what problems or opportunities it creates"}`,
          },
        ],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 2,
          },
        ],
      });

      // Extract the text response
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        try {
          // Try to parse JSON from the response
          const jsonMatch = textBlock.text.match(/\{[\s\S]*"headline"[\s\S]*"summary"[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            newsItems.push({
              headline: parsed.headline,
              summary: parsed.summary,
              tags: category.tags,
              source_query: category.query,
            });
          }
        } catch {
          // If JSON parsing fails, use the raw text
          newsItems.push({
            headline: textBlock.text.slice(0, 80),
            summary: textBlock.text.slice(0, 200),
            tags: category.tags,
            source_query: category.query,
          });
        }
      }
    } catch (err) {
      console.log(
        `[news] Failed to fetch for "${category.query}": ${(err as Error).message}`
      );
    }
  }

  return newsItems;
}
