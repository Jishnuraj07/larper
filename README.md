# Larper

A coding agent for your terminal that plays dress-up. Claude works as a small crew, your failing tests turn up as foes to beat, and your progress earns you rank. The crew can play one of five themes, and you can switch between them at any time.

```
 _        _    ____  ____  _____ ____
| |      / \  |  _ \|  _ \| ____|  _ \
| |     / _ \ | |_) | |_) |  _| | |_) |
| |___ / ___ \|  _ <|  __/| |___|  _ <
|_____/_/   \_\_| \_\_|   |_____|_| \_\
```

It is a real agent. It reads, searches and edits files, runs commands, and runs your tests. The costume is a separate layer on top, and `--serious` turns all of it off.

Larper grew out of [Ambrosia](https://github.com/Jishnuraj07/ambrosia), which had one look at a time (first Greek myth, then cyberpunk). Larper keeps both and adds three more.

## Themes

| Theme | The crew (builder · planner · critic · narrator) | Foes | Ranks | Points |
|---|---|---|---|---|
| **Netrunner** (`cyberpunk`) | Fabricator · Strategos · Black ICE · Pirate Radio | Bug → Daemon → Worm → Rogue AI | Script Kiddie → Legend | cred |
| **Olympus** (`greek`, `myth`) | Hephaestus · Athena · Momus · Hermes | Harpy → Minotaur → Chimera → Hydra | Mortal → Olympian | favour |
| **Dungeon** (`fantasy`, `dnd`) | Artificer · Archmage · Inquisitor · The Bard | Slime → Goblin → Troll → Dragon | Peasant → Legend of the Realm | renown |
| **Starship** (`space`, `scifi`) | Chief Engineer · Navigator · Inspector · Ship's Log | Gremlin → Hull Breach → Boarding Party → Xeno Swarm | Cadet → Fleet Admiral | merit |
| **Hustle** (`linkedin`, `corporate`) | 10x Engineer · Thought Leader · VP of Synergy · Influencer | Nit → Blocker → Escalation → Reorg | Intern → Chief Visionary Officer | clout |

Hustle is a parody of LinkedIn-style hustle culture. It has no affiliation with LinkedIn and is not endorsed by it.

To switch, type `/theme <name>` in the terminal or use the theme picker in the desktop app's top bar. Run `/theme` alone to list them. To start in a theme, pass `--theme <name>`. Your choice is saved to `config.json`.

A theme only changes appearance and voice: names, the crew's personas and prompts, narration, achievement titles, terminal colours and the desktop palette. The rules don't change. Your cred, rank, achievements and stats carry over between themes, and switching during a fight renames the foe without resetting it. Every theme's commands work in every theme, so `/quest` in Netrunner still runs a heist.

## The crew

| Role | Does | Default model |
|---|---|---|
| **builder** | The work: reads, edits, runs | `claude-opus-5-5` |
| **planner** | Plans the plan-build-review run (`/heist`, `/council`, `/quest`, `/mission`, `/sprint`) | `claude-opus-5-5` |
| **critic** | Reviews and roasts your diff | `claude-sonnet-5-5` |
| **narrator** | Narrates in one-liners | `claude-haiku-4-5` |

## The game

- **Points (XP).** You earn them for fixing failing tests, finishing jobs and getting past the critic. You lose some when a test you fixed breaks again.
- **Ranks.** There are five, at 0, 100, 400, 1000 and 2500 points.
- **Foes.** When `run_tests` finds failures, a foe spawns with one HP per failing test. Each fix lands a hit. If the failure count goes up, the foe grows.
- **Achievements.** There are 11, and each theme names them its own way. `/hacks` lists them, and so do `/labours`, `/deeds`, `/medals`, `/badges` and `/achievements`.
- **Approvals.** Every write, edit and command asks your permission first. The Operator, the Oracle, the Dungeon Master, the Captain or the Stakeholder (that's you) says yes or no. Risky commands (`rm -rf`, `git push --force` and similar) carry a warning.
- **Sound.** Synth earcons are generated on the fly. The narrator can read its lines aloud through Windows SAPI, `say` on macOS or `espeak` on Linux. Nothing extra needs installing.

## Setup

Requires Node 20 or later.

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
export ANTHROPIC_WORKSPACE_ID=wrkspc_...   # only if your key is not scoped to a workspace
npm start                                # or: node bin/larper.mjs [task]
npm start -- --theme linkedin            # start in a theme
npm link                                 # optional: puts `larper` on your PATH
```

Run it from inside the project you want to work on, or point it there with `--cwd <dir>`.

## Desktop app

The desktop app has the same crew in a window. It has the crew chat, an arena where foes take hits, a rank bar, an achievements board, a theme picker, and approvals as a dialog. Each theme brings its own look:

- **Netrunner:** black glass, neon and glitches.
- **Olympus:** lapis and gold leaf with serif inscriptions.
- **Dungeon:** torchlight and bevelled corners.
- **Starship:** a starfield and console panels.
- **Hustle:** a bright, white-card professional feed.

The agent, the game and your progress are shared with the terminal version.

```sh
npm run desktop                    # open the last project, or pick a folder
npm run desktop -- --demo          # a scripted demo project; no API key needed
npm run desktop -- --theme=dungeon # start in a theme
npm run package:desktop            # build release/Larper 1.0.0.exe (portable) and an installer
```

The app icon lives in `desktop/icon.svg`. After editing it, run `npx electron scripts/make-icon.mjs` to regenerate the PNGs that the window and the installer use.

Click the folder in the top bar to switch projects. Approvals take `Y` / `A` / `N`, and `Esc` stops the crew.

## Commands

| | |
|---|---|
| *any text* | a job for the builder |
| `/heist <task>` | the planner plans, the builder builds, the critic reviews (with one revision round). Also works as `/council`, `/quest`, `/mission` or `/sprint`. |
| `/roast` | the critic reviews your uncommitted changes |
| `/stats`, `/hacks` | your record and achievements |
| `/theme [name]` | list the themes, or switch to one |
| `/mute`, `/tts` | sound and spoken narration |
| `/serious` | toggle the fun |
| `/clear`, `/quit` | |
| `Esc` | interrupt the crew |

Flags: `--theme <name>`, `--serious`, `--mute`, `--yolo` (approve everything; careful), `--cwd <dir>`, `--test-sounds`.

## Config

`~/.larper/config.json` is written on first run. It sets the `theme`, plus each role's model and effort (keys `builder`, `planner`, `critic`, `narrator`), sound, tts, the narrator, `autoApprove` (tools that never ask for approval), and `workspaceId` (for keys not scoped to a workspace). Your progress lives in `~/.larper/profile.json`. Set `LARPER_HOME` to keep them somewhere else.

Coming from Ambrosia: on first run, Larper copies your config and progress over from `~/.ambrosia/`. Crew keys under either old naming (`hephaestus`/`athena`/`momus`/`hermes` or `fabricator`/`strategos`/`blackice`/`radio`) are read and mapped to the new roles. Achievements earned under the old ids are kept.

## Adding a theme

A theme is a single file in `src/theme/themes/` that implements the `Theme` type in `src/theme/types.ts`. It holds crew names, glyphs and colours, persona fragments for the prompts, ranks, foes, achievement titles, words, lines, narration and terminal colours. Register it in `src/theme/index.ts`. For the desktop palette, add an `html[data-theme="…"]` block to `desktop/renderer/style.css`. `test/theme.test.ts` checks that the theme is complete, that its placeholders get filled, and that its names don't collide with another theme's.

## Development

```sh
npm run build        # compile to dist/ (bin/larper.mjs uses it when present, else runs src via tsx)
npm test             # unit tests: tools, safety, parsing, game engine, agent loop, heist, narrator,
                     #   session commands, approvals and themes, config/profile, UI components
npm run typecheck
npm run smoke        # drives the real UI end to end with a scripted model; no API key needed
npm run smoke:themes # the same, once per theme
npm run smoke -- --live   # against the real models (costs a few cents)
npm run check        # typecheck, tests, build and the scripted smoke test, as CI runs it
npm run smoke:desktop     # drives the desktop window through the demo and every theme; screenshots in shots/
```

CI (`.github/workflows/ci.yml`) runs on Ubuntu and Windows with Node 20 and 24. Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds, signs and drafts a release (see [`.signpath/README.md`](.signpath/README.md)).

The code is laid out as follows:

- `src/theme/`: the themes, plus the `theme()` / `setTheme()` switch that everything else reads from at use time.
- `src/agent/`: the loop, the tools, the persona prompts and the heist (`council.ts`).
- `src/game/`: the game engine, achievements, ranks and profile. These own the rules; themes only name things.
- `src/audio/`: sound and speech.
- `src/ui/`: the Ink terminal UI.
- `src/narrator.ts`: the narrator.

Everything talks through the typed event bus in `src/events.ts`. The game, the narrator and the sound only listen to it, so the agent never depends on them.

## Code signing policy

Windows releases are meant to be signed through [SignPath.io](https://about.signpath.io) under the [SignPath Foundation](https://signpath.org) open-source program. That needs a SignPath project for this repository (slug `larper`); see [`.signpath/README.md`](.signpath/README.md). Only builds of tagged releases are signed, and a person approves each signing request.

- Committers and reviewers: [Jishnuraj07](https://github.com/Jishnuraj07)
- Approvers: [Jishnuraj07](https://github.com/Jishnuraj07)

### Privacy

Larper sends your prompts to the [Anthropic API](https://www.anthropic.com/legal/privacy) using your own API key. File contents and command output that the crew reads while working go with them. That is the only network connection it makes. There is no telemetry, analytics or auto-update. Your config and progress stay on your machine in `~/.larper/`.

## License

[ISC](LICENSE)
