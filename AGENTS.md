# AGENTS.md

A reference for coding agents (Claude Code, Codex and others) working on Larper. Read the [README](README.md) first to see what the product does. This file covers how the code fits together and the rules for changing it.

## What it is

Larper is a coding-agent harness written in TypeScript (ESM, Node 20 or later). The real agent is a small crew of models working through one tool loop. A theme layer sits on top of it and turns tests into foes, progress into ranks, and the crew into netrunners, gods and so on. The terminal UI uses Ink and React. The desktop app runs on Electron. Both drive the same `Session`.

## Commands

```sh
npm install
npm test             # vitest; no network, no API key
npm run typecheck    # tsc --noEmit
npm run smoke        # drives the real Ink UI with a scripted model; no API key
npm run smoke:themes # the same, once per theme
npm run check        # typecheck + test + build + smoke, the way CI runs it
npm start            # run from source (tsx)
npm run desktop      # build, then open the Electron app
```

Before you call a change done, run `npm run check`. CI runs on Ubuntu and Windows with Node 20 and 24, so keep paths, shells and line endings portable.

## Layout

| Path | What lives there |
|---|---|
| `src/cli.tsx`, `bin/larper.mjs` | Entry point and flag parsing. `bin` runs `dist/` when it exists, otherwise `src/` through tsx. |
| `src/session.ts` | Everything behind the UI: builds the clients and the crew, approvals, slash commands, the narrator and the sound. |
| `src/providers.ts` | Picks a provider per model (`anthropic` or `deepseek`) and builds one SDK client per provider. |
| `src/config.ts` | `~/.larper/config.json`: models and effort per role, theme, sound, `autoApprove`, `workspaceId`, `deepseekBaseUrl`. Also the Ambrosia migration. |
| `src/agent/loop.ts` | `Agent`: the streaming tool-use loop for one crew member, plus the per-model request parameters. |
| `src/agent/tools.ts` | Tool definitions (zod schemas). `READ_ONLY_TOOLS` never ask for approval. |
| `src/agent/safety.ts` | `confine()` keeps paths inside the project root. `isRisky()` flags dangerous commands. |
| `src/agent/council.ts` | The heist (plan, build, review, one revision round) and the roast. |
| `src/agent/personas.ts` | System prompts, built from the current theme each time they're used. |
| `src/narrator.ts` | Batches events into one-liners, from the narrator model or from theme templates. |
| `src/events.ts` | The typed event bus. Everything talks through it. |
| `src/game/` | The rules: XP, ranks, foes, achievements, the profile. Themes only name things. |
| `src/theme/` | Five themes, plus `theme()` / `setTheme()`. |
| `src/ui/` | The Ink terminal UI. |
| `src/desktop/`, `desktop/` | Electron main process, preload and renderer. |
| `src/testing/demo.ts` | The scripted client used by the smoke tests and `--demo`. |
| `test/` | Vitest suites, one per area. |

## Architecture rules

- **The agent never depends on the game.** The game, the narrator and the sound only listen to the bus. Don't import them from `src/agent/`.
- **Themes change looks, never rules.** Anything that affects scoring belongs in `src/game/`. A new theme is one file in `src/theme/themes/`, registered in `src/theme/index.ts`, plus a palette block in `desktop/renderer/style.css`. `test/theme.test.ts` checks that it's complete.
- **Look up the theme when you use it.** Call `theme()` at the moment you need it instead of caching it, so `/theme` can switch mid-session.
- **Agent history is append-only.** Never edit past messages. That keeps the prompt cache warm and replayed thinking blocks valid. Close every dangling `tool_use` (`closeDanglingToolUse`).
- **Every write and every command goes through `approve()`.** Only read-only tools and the user's `autoApprove` list skip it. File tools must resolve their paths through `confine()`.
- **No network except the model APIs.** No telemetry, analytics or auto-update (see Privacy in the README).

## Model providers

Each role (`builder`, `planner`, `critic`, `narrator`) names its model in config. `providerOf(model)` routes it:

| Prefix | Provider | Endpoint | Key |
|---|---|---|---|
| `deepseek-` | DeepSeek | `https://api.deepseek.com/anthropic`, overridden by `DEEPSEEK_BASE_URL` and then by `deepseekBaseUrl` in config | `DEEPSEEK_API_KEY` |
| anything else | Anthropic | the SDK default | `ANTHROPIC_API_KEY`, `ant auth login`, and so on; `ANTHROPIC_WORKSPACE_ID` / `workspaceId` |

DeepSeek speaks the Anthropic Messages API, so one SDK and one loop serve both providers. The request parameters differ per model family (see `Agent.params()` in `src/agent/loop.ts`):

- **Claude 5 models (Opus, Sonnet, Fable, Mythos):** 64k `max_tokens`, adaptive thinking with summarized display, `output_config.effort`, the server-side fallback beta and `fallbacks: "default"`.
- **DeepSeek (`deepseek-flash`, `deepseek-v4-pro`):** 64k `max_tokens`, adaptive thinking (DeepSeek treats it as enabled), `output_config.effort`. No `betas` and no `fallbacks`. DeepSeek ignores `cache_control` and `is_error` on tool results.
- **Older or smaller Claude models (Haiku):** 16k `max_tokens`, no thinking, no effort.

If a role's provider has no credentials, the session reports it once and the crew stays offline. A request is never sent to the wrong provider. To add a provider, extend `Provider` / `providerOf` / `Clients` in `src/providers.ts`, add a branch in `Agent.params()`, and add tests in `test/providers.test.ts` and `test/loop.test.ts`.

The Anthropic default models live in `DEFAULT_CONFIG` (`src/config.ts`). Use current model IDs and don't add date suffixes.

## Testing

- Tests must not touch the network or the real `~/.larper`. Point `LARPER_HOME` at a temp dir, as `test/config.test.ts` does.
- Fake the SDK client the way `fakeClient()` does in `test/loop.test.ts`: record each request and replay scripted messages.
- UI changes: run `npm run smoke`, and `npm run smoke:desktop` for the Electron app (screenshots go to `shots/`).

## Conventions

- Strict TypeScript, ESM, with `.js` extensions on relative imports.
- Comments explain why, not what. Keep them short.
- Commit subjects are short and in the imperative mood, with no prefix: "Autocomplete slash commands in the terminal and desktop app".
- Releases: bump `package.json`, commit "Release x.y.z", then push a `v*` tag. `.github/workflows/release.yml` takes it from there.
