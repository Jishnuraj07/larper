import { randomUUID } from "node:crypto";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

/**
 * Where a model is served. Every provider here speaks the Anthropic Messages API,
 * so one SDK and one loop drive them all.
 *
 * - `claude-*` and anything unprefixed: Anthropic.
 * - `deepseek-*`: DeepSeek's Anthropic-compatible endpoint.
 * - `opencode/<model>`: OpenCode Zen (pay as you go).
 * - `opencode-go/<model>`: OpenCode Go (subscription).
 */
export type Provider = "anthropic" | "deepseek" | "opencode" | "opencode-go";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";
export const OPENCODE_BASE_URL = "https://opencode.ai/inference/anthropic";
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/inference/go/anthropic";

const PREFIXES: [string, Provider][] = [
  ["opencode-go/", "opencode-go"],
  ["opencode/", "opencode"],
];

export function providerOf(model: string): Provider {
  for (const [prefix, provider] of PREFIXES) if (model.startsWith(prefix)) return provider;
  return model.startsWith("deepseek-") ? "deepseek" : "anthropic";
}

/** The model name the provider expects: gateway prefixes are Larper's routing, not part of the id. */
export function wireModel(model: string): string {
  for (const [prefix] of PREFIXES) if (model.startsWith(prefix)) return model.slice(prefix.length);
  return model;
}

export interface ModelFeatures {
  provider: Provider;
  /** The id sent to the provider. */
  model: string;
  maxTokens: number;
  /** Adaptive thinking and output_config.effort. */
  thinking: boolean;
  /** Asks for summarized thinking (a Claude option; others stream thinking as is). */
  summarize: boolean;
  /** Takes output_config.effort. */
  effort: boolean;
  /** Anthropic's server-side refusal fallbacks (a beta only Anthropic itself serves). */
  fallbacks: boolean;
  /** Top-level cache_control. */
  cache: boolean;
}

/** What to send a model, by family and by who serves it. */
export function featuresOf(model: string): ModelFeatures {
  const provider = providerOf(model);
  const id = wireModel(model);
  const claude5 = /^claude-(opus|sonnet|fable|mythos)-5/.test(id);
  const claude = id.startsWith("claude-");
  if (claude5) {
    // Through a gateway, keep to the stable API: no betas.
    const direct = provider === "anthropic";
    return { provider, model: id, maxTokens: 64_000, thinking: true, summarize: true, effort: true, fallbacks: direct, cache: true };
  }
  if (provider === "deepseek") {
    return { provider, model: id, maxTokens: 64_000, thinking: true, summarize: false, effort: true, fallbacks: false, cache: false };
  }
  // Haiku and older Claude models, and other gateway models (Qwen on Zen): the plain API.
  return { provider, model: id, maxTokens: 16_000, thinking: false, summarize: false, effort: false, fallbacks: false, cache: claude };
}

/** Which environment variable holds each provider's key, for messages. */
export const KEY_VARS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
};

function userAgent(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return `larper/${pkg.version}`;
  } catch {
    return "larper";
  }
}

/** Builds one client per provider, on first use, and hands back the right one for a model. */
export class Clients {
  private cache = new Map<Provider, Anthropic>();
  /** OpenCode Go asks for a stable id per session. */
  readonly sessionId = randomUUID();

  constructor(private config: Config) {}

  for(model: string): Anthropic {
    const provider = providerOf(model);
    let client = this.cache.get(provider);
    if (!client) {
      client = this.build(provider);
      this.cache.set(provider, client);
    }
    return client;
  }

  private build(provider: Provider): Anthropic {
    switch (provider) {
      case "anthropic": {
        // Keys not scoped to a workspace must name one on every request.
        const workspace = process.env.ANTHROPIC_WORKSPACE_ID ?? this.config.workspaceId;
        return new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
      }
      case "deepseek":
        return this.foreign(
          provider,
          process.env.DEEPSEEK_BASE_URL ?? this.config.deepseekBaseUrl ?? DEEPSEEK_BASE_URL,
        );
      case "opencode":
        return this.foreign(provider, process.env.OPENCODE_BASE_URL ?? this.config.opencodeBaseUrl ?? OPENCODE_BASE_URL, {
          // OpenCode documents bearer auth; the SDK also sends x-api-key.
          Authorization: `Bearer ${process.env.OPENCODE_API_KEY ?? ""}`,
        });
      case "opencode-go":
        return this.foreign(
          provider,
          process.env.OPENCODE_GO_BASE_URL ?? this.config.opencodeGoBaseUrl ?? OPENCODE_GO_BASE_URL,
          { Authorization: `Bearer ${process.env.OPENCODE_API_KEY ?? ""}`, "x-opencode-session": this.sessionId },
        );
    }
  }

  /** A client for an Anthropic-compatible endpoint that isn't Anthropic. */
  private foreign(provider: Provider, baseURL: string, headers: Record<string, string> = {}): Anthropic {
    const variable = KEY_VARS[provider];
    const apiKey = process.env[variable];
    if (!apiKey) throw new Error(`No ${provider} key found. Set ${variable} to use ${provider} models.`);
    return new Anthropic({
      apiKey,
      // Never forward an Anthropic bearer token or workspace to another provider.
      authToken: null,
      baseURL,
      defaultHeaders: { "User-Agent": userAgent(), ...headers },
    });
  }
}
