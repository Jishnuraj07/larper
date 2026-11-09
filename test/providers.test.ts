import { afterEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { Clients, DEEPSEEK_BASE_URL, OPENCODE_BASE_URL, OPENCODE_GO_BASE_URL, featuresOf, providerOf, wireModel } from "../src/providers.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const VARS = ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "OPENCODE_API_KEY", "OPENCODE_BASE_URL", "OPENCODE_GO_BASE_URL"] as const;
const saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

/** The URL and headers the SDK would send, without sending anything. */
async function request(client: Anthropic) {
  const r = await (client as any).buildRequest({ method: "post", path: "/v1/messages", body: {} });
  return { url: r.url as string, headers: Object.fromEntries(new Headers(r.req.headers)) };
}

describe("providers", () => {
  it("routes by model name and strips gateway prefixes", () => {
    expect(providerOf("deepseek-flash")).toBe("deepseek");
    expect(providerOf("deepseek-v4-pro")).toBe("deepseek");
    expect(providerOf("claude-opus-5-5")).toBe("anthropic");
    expect(providerOf("opencode/claude-opus-5-5")).toBe("opencode");
    expect(providerOf("opencode-go/qwen3.8-flash")).toBe("opencode-go");
    expect(wireModel("opencode/claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(wireModel("opencode-go/qwen3.8-flash")).toBe("qwen3.8-flash");
    expect(wireModel("deepseek-flash")).toBe("deepseek-flash");
  });

  it("sends Anthropic-only betas to Anthropic alone, and thinking only to models that take it", () => {
    expect(featuresOf("claude-opus-5-5")).toMatchObject({ thinking: true, fallbacks: true, cache: true });
    expect(featuresOf("opencode/claude-opus-5-5")).toMatchObject({ model: "claude-opus-5-5", thinking: true, fallbacks: false, cache: true });
    expect(featuresOf("deepseek-v4-pro")).toMatchObject({ thinking: true, summarize: false, fallbacks: false, cache: false });
    expect(featuresOf("opencode-go/qwen3.8-flash")).toMatchObject({ thinking: false, effort: false, fallbacks: false, cache: false });
    expect(featuresOf("claude-haiku-4-5")).toMatchObject({ thinking: false, effort: false, cache: true });
  });

  it("builds a DeepSeek client on its own endpoint with its own key, once", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test";
    delete process.env.DEEPSEEK_BASE_URL;
    const clients = new Clients(DEFAULT_CONFIG);
    const a = clients.for("deepseek-flash");
    expect(a.baseURL).toBe(DEEPSEEK_BASE_URL);
    expect(a.authToken).toBeNull();
    expect((await request(a)).headers["x-api-key"]).toBe("sk-deepseek-test");
    expect(clients.for("deepseek-v4-pro")).toBe(a);
  });

  it("takes the endpoint from the environment, then config", () => {
    process.env.DEEPSEEK_API_KEY = "k";
    delete process.env.DEEPSEEK_BASE_URL;
    const config = { ...DEFAULT_CONFIG, deepseekBaseUrl: "https://proxy.example/anthropic" };
    expect(new Clients(config).for("deepseek-flash").baseURL).toBe("https://proxy.example/anthropic");
    process.env.DEEPSEEK_BASE_URL = "https://env.example/anthropic";
    expect(new Clients(config).for("deepseek-flash").baseURL).toBe("https://env.example/anthropic");
  });

  it("calls OpenCode Zen with the OpenCode key and Larper's own user agent", async () => {
    process.env.OPENCODE_API_KEY = "oc-test";
    delete process.env.OPENCODE_BASE_URL;
    const { url, headers } = await request(new Clients(DEFAULT_CONFIG).for("opencode/claude-sonnet-5-5"));
    expect(url).toBe(`${OPENCODE_BASE_URL}/v1/messages`);
    expect(headers["x-api-key"]).toBe("oc-test");
    expect(headers.authorization).toBe("Bearer oc-test");
    expect(headers["user-agent"]).toMatch(/^larper\//);
    expect(headers["x-opencode-session"]).toBeUndefined();
  });

  it("calls OpenCode Go with one stable session id per session", async () => {
    process.env.OPENCODE_API_KEY = "oc-test";
    delete process.env.OPENCODE_GO_BASE_URL;
    const clients = new Clients(DEFAULT_CONFIG);
    const { url, headers } = await request(clients.for("opencode-go/qwen3.8-flash"));
    expect(url).toBe(`${OPENCODE_GO_BASE_URL}/v1/messages`);
    expect(headers["x-opencode-session"]).toBe(clients.sessionId);
    expect(clients.for("opencode-go/claude-haiku-5-5")).toBe(clients.for("opencode-go/qwen3.8-flash"));
    expect(new Clients(DEFAULT_CONFIG).sessionId).not.toBe(clients.sessionId);
  });

  it("refuses a model whose provider has no key", () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    expect(() => new Clients(DEFAULT_CONFIG).for("deepseek-flash")).toThrow(/DEEPSEEK_API_KEY/);
    expect(() => new Clients(DEFAULT_CONFIG).for("opencode/claude-opus-5-5")).toThrow(/OPENCODE_API_KEY/);
  });
});
