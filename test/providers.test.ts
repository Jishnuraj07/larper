import { afterEach, describe, expect, it } from "vitest";
import { Clients, DEEPSEEK_BASE_URL, providerOf } from "../src/providers.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const saved = { key: process.env.DEEPSEEK_API_KEY, url: process.env.DEEPSEEK_BASE_URL };
afterEach(() => {
  for (const [name, value] of [["DEEPSEEK_API_KEY", saved.key], ["DEEPSEEK_BASE_URL", saved.url]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("providers", () => {
  it("routes deepseek-* models to DeepSeek and everything else to Anthropic", () => {
    expect(providerOf("deepseek-flash")).toBe("deepseek");
    expect(providerOf("deepseek-v4-pro")).toBe("deepseek");
    expect(providerOf("claude-opus-5-5")).toBe("anthropic");
  });

  it("builds a DeepSeek client on its own endpoint with its own key, once", () => {
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test";
    delete process.env.DEEPSEEK_BASE_URL;
    const clients = new Clients(DEFAULT_CONFIG);
    const a = clients.for("deepseek-flash");
    expect(a.baseURL).toBe(DEEPSEEK_BASE_URL);
    expect(a.apiKey).toBe("sk-deepseek-test");
    expect(a.authToken).toBeNull();
    expect(clients.for("deepseek-v4-pro")).toBe(a);
  });

  it("takes the endpoint from DEEPSEEK_BASE_URL, then config", () => {
    process.env.DEEPSEEK_API_KEY = "k";
    delete process.env.DEEPSEEK_BASE_URL;
    expect(new Clients({ ...DEFAULT_CONFIG, deepseekBaseUrl: "https://proxy.example/anthropic" }).for("deepseek-flash").baseURL).toBe(
      "https://proxy.example/anthropic",
    );
    process.env.DEEPSEEK_BASE_URL = "https://env.example/anthropic";
    expect(new Clients({ ...DEFAULT_CONFIG, deepseekBaseUrl: "https://proxy.example/anthropic" }).for("deepseek-flash").baseURL).toBe(
      "https://env.example/anthropic",
    );
  });

  it("refuses a DeepSeek model without DEEPSEEK_API_KEY", () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(() => new Clients(DEFAULT_CONFIG).for("deepseek-flash")).toThrow(/DEEPSEEK_API_KEY/);
  });
});
