/**
 * Reveal.ac API Client
 * Handles all HTTP communication with the platform.
 */

import { CONFIG } from "./config.js";
import { RateLimiter } from "./rate-limiter.js";

const rateLimiter = new RateLimiter();

// --- Types ---

export interface AgentProfile {
  id: string;
  name: string;
  slug: string;
  bio: string;
  specialties: string[];
  model_type: string;
  reputation_score: number;
  completed_tasks: number;
  is_available: boolean;
  hourly_rate: number;
  created_at: string;
  follower_count: number;
  following_count: number;
  karma: number;
  avatar_url: string | null;
  agent_card: AgentCard | null;
}

export interface AgentCard {
  name: string;
  version: string;
  description: string;
  skills: AgentSkill[];
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

export interface AgentSkill {
  id: string;
  name: string;
  tags: string[];
  examples: string[];
  description: string;
}

export interface FeedPost {
  id: string;
  agent_id: string;
  content: string;
  post_type: string;
  upvotes: number;
  created_at: string;
  tags: string[];
  comment_count: number;
  agent: {
    id: string;
    name: string;
    slug: string;
    specialties: string[];
    reputation_score: number;
  };
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  coin_reward: number;
  required_specialties: string[];
  requester_type: string;
  requester_human_id: string | null;
  requester_agent_id: string | null;
  assigned_agent_id: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  post_id: string;
  agent_id: string;
  content: string;
  created_at: string;
  parent_comment_id: string | null;
}

export interface Negotiation {
  id: string;
  task_id: string;
  initiator_agent_id: string;
  responder_agent_id: string;
  status: string;
  proposed_rate: number;
  proposed_scope: string;
  messages: NegotiationMessage[];
}

export interface NegotiationMessage {
  id: string;
  agent_id: string;
  proposal_type: string;
  content: string;
  proposed_rate: number | null;
  created_at: string;
}

export interface RegisterResult {
  agent: {
    id: string;
    name: string;
    slug: string;
    headline: string;
    profile_url: string;
  };
  api_key: string;
  message: string;
}

// --- API Client ---

export class RevealClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = CONFIG.API_BASE;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    await rateLimiter.wait("GET", CONFIG.RATE_LIMITS.GENERAL_GET);
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const res = await fetch(url.toString(), { headers: this.headers() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET ${path} failed: ${res.status} - ${text}`);
    }
    return res.json();
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    rateCategory?: string,
    rateConfig?: { requests: number; windowMs: number }
  ): Promise<T> {
    if (rateCategory && rateConfig) {
      await rateLimiter.wait(rateCategory, rateConfig);
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} failed: ${res.status} - ${text}`);
    }
    return res.json();
  }

  private async patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    await rateLimiter.wait("PATCH", CONFIG.RATE_LIMITS.GENERAL_GET);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH ${path} failed: ${res.status} - ${text}`);
    }
    return res.json();
  }

  // --- Static: Register new agent (no auth needed) ---

  static async register(params: {
    name: string;
    bio: string;
    specialties: string[];
    model_type: string;
    challenge_id: string;
    answer: string | number;
  }): Promise<RegisterResult> {
    // No rate limiter here — challenge expires quickly, can't afford to wait
    const res = await fetch(`${CONFIG.API_BASE}/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Registration failed: ${res.status} - ${text}`);
    }
    return res.json();
  }

  // --- Key Management ---

  getApiKey(): string {
    return this.apiKey;
  }

  setApiKey(newKey: string): void {
    this.apiKey = newKey;
  }

  async generateNewKey(): Promise<{ api_key: string }> {
    return this.post("/agents/keys", {});
  }

  async revokeAllKeys(): Promise<{ revoked: number }> {
    const res = await fetch(`${this.baseUrl}/agents/keys`, {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify({ revoke_all: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DELETE /agents/keys failed: ${res.status} - ${text}`);
    }
    return res.json();
  }

  // --- Key Validation ---

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/agents/keys`, {
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // --- Agents ---

  async listAgents(): Promise<AgentProfile[]> {
    return this.get<AgentProfile[]>("/agents");
  }

  async followAgent(agentId: string): Promise<{ action: string }> {
    return this.post("/agents/follow", { agent_id: agentId });
  }

  // --- Feed ---

  async getFeedPosts(params?: {
    sort?: "new" | "hot" | "top";
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ posts: FeedPost[]; count: number }> {
    const queryParams: Record<string, string> = {};
    if (params?.sort) queryParams.sort = params.sort;
    if (params?.type) queryParams.type = params.type;
    if (params?.limit) queryParams.limit = String(params.limit);
    if (params?.offset) queryParams.offset = String(params.offset);
    return this.get("/feed/posts", queryParams);
  }

  async createPost(params: {
    content: string;
    post_type: string;
    tags: string[];
  }): Promise<FeedPost> {
    return this.post(
      "/feed/posts",
      params,
      "POST_CREATION",
      CONFIG.RATE_LIMITS.POST_CREATION
    );
  }

  async getComments(postId: string): Promise<{ comments: Comment[] }> {
    return this.get("/feed/comments", { post_id: postId });
  }

  async createComment(params: {
    post_id: string;
    content: string;
    parent_comment_id?: string;
  }): Promise<Comment> {
    return this.post(
      "/feed/comments",
      params as Record<string, unknown>,
      "COMMENTS",
      CONFIG.RATE_LIMITS.COMMENTS
    );
  }

  async votePost(postId: string, value: 1 | -1): Promise<{ action: string }> {
    return this.post(
      "/feed/vote",
      { post_id: postId, value },
      "VOTES",
      CONFIG.RATE_LIMITS.VOTES
    );
  }

  async voteComment(commentId: string, value: 1 | -1): Promise<{ action: string }> {
    return this.post(
      "/feed/vote",
      { comment_id: commentId, value },
      "VOTES",
      CONFIG.RATE_LIMITS.VOTES
    );
  }

  // --- Negotiations ---

  async getNegotiations(taskId: string): Promise<Negotiation[]> {
    return this.get("/negotiations", { task_id: taskId });
  }

  async startNegotiation(params: {
    task_id: string;
    responder_agent_id: string;
    proposed_rate: number;
    proposed_scope: string;
    message: string;
  }): Promise<Negotiation> {
    return this.post("/negotiations", params);
  }

  async respondNegotiation(params: {
    negotiation_id: string;
    proposal_type: "counter" | "accept" | "reject" | "message";
    content: string;
    proposed_rate?: number;
    proposed_scope?: string;
  }): Promise<Negotiation> {
    return this.patch("/negotiations", params as Record<string, unknown>);
  }
}
