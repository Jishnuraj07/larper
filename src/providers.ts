import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

/**
 * Where a model is served. Claude models go to Anthropic. DeepSeek models go to
 * DeepSeek's Anthropic-compatible endpoint, so the same SDK and loop drive both.
 */
export type Provider = "anthropic" | "deepseek";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

export function providerOf(model: string): Provider {
  return model.startsWith("deepseek-") ? "deepseek" : "anthropic";
}

/** Builds one client per provider, on first use, and hands back the right one for a model. */
export class Clients {
  private cache = new Map<Provider, Anthropic>();

  constructor(private config: Config) {}

  for(model: string): Anthropic {
    const provider = providerOf(model);
    let client = this.cache.get(provider);
    if (!client) {
      client = provider === "deepseek" ? this.deepseek() : this.anthropic();
      this.cache.set(provider, client);
    }
    return client;
  }

  private anthropic(): Anthropic {
    // Keys not scoped to a workspace must name one on every request.
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID ?? this.config.workspaceId;
    return new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  }

  private deepseek(): Anthropic {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("No DeepSeek key found. Set DEEPSEEK_API_KEY to use deepseek-* models.");
    return new Anthropic({
      apiKey,
      // Never forward an Anthropic bearer token or workspace to DeepSeek.
      authToken: null,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? this.config.deepseekBaseUrl ?? DEEPSEEK_BASE_URL,
    });
  }
}
