import React from "react";
import { render } from "ink";
import { parseArgs } from "node:util";
import path from "node:path";
import { App } from "./ui/App.js";
import { Session } from "./session.js";
import { EARCONS, play, type Earcon } from "./audio/earcons.js";
import { THEMES } from "./theme/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    serious: { type: "boolean", default: false },
    mute: { type: "boolean", default: false },
    yolo: { type: "boolean", default: false },
    cwd: { type: "string" },
    theme: { type: "string" },
    "test-sounds": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`larper: a coding-agent harness that plays dress-up

Usage: larper [task] [options]

  --theme <name>  ${Object.keys(THEMES).join(", ")} (or linkedin, cyberpunk,
                  greek, fantasy, space); the default is the one in config.json
  --serious       no narration, sound or cred; just the agent
  --mute          no sound or speech
  --yolo          never ask for approval; approve every action (careful)
  --cwd <dir>     project root (default: current directory)
  --test-sounds   play every earcon and exit

Needs ANTHROPIC_API_KEY in the environment, or a profile from \`ant auth login\`.
Config and progress live in ~/.larper/ (override with LARPER_HOME).`);
  process.exit(0);
}

if (values["test-sounds"]) {
  const names = Object.keys(EARCONS) as Earcon[];
  for (const [i, name] of names.entries()) {
    setTimeout(() => {
      console.log(`♪ ${name}`);
      play(name);
    }, i * 1200);
  }
  setTimeout(() => process.exit(0), names.length * 1200 + 800);
} else {
  const root = path.resolve(values.cwd ?? process.cwd());
  const session = new Session({ root, serious: values.serious, mute: values.mute, yolo: values.yolo, theme: values.theme });
  const app = render(<App session={session} initialPrompt={positionals.join(" ") || undefined} />, { exitOnCtrlC: true });
  await app.waitUntilExit();
  session.engine.dispose();
  process.exit(0);
}
