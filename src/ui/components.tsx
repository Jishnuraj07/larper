import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { CrewName } from "../config.js";
import type { Boss, Hack } from "../events.js";
import type { ApprovalRequest } from "../agent/tools.js";
import { persona, workingLine } from "../agent/personas.js";
import { progress } from "../game/ranks.js";
import { fill, theme } from "../theme/index.js";

const DIM = "gray";

export const BANNER = [
  " _        _    ____  ____  _____ ____  ",
  "| |      / \  |  _ \|  _ \| ____|  _ \ ",
  "| |     / _ \ | |_) | |_) |  _| | |_) |",
  "| |___ / ___ \|  _ <|  __/| |___|  _ < ",
  "|_____/_/   \_\_| \_\_|   |_____|_| \_\\",
];

export function Banner({ serious }: { serious: boolean }) {
  const t = theme();
  return (
    <Box flexDirection="column" marginBottom={1}>
      {BANNER.map((line, i) => (
        <Text key={i} color={t.colors.banner[i]}>
          {line}
        </Text>
      ))}
      <Text color={DIM}>
        {serious ? "  serious mode · type a task, /help for commands" : `  ${t.name} · ${t.lines.welcome}`}
      </Text>
    </Box>
  );
}

export function CrewLabel({ crew }: { crew: CrewName }) {
  const p = persona(crew);
  return (
    <Text color={p.color} bold>
      {p.glyph} {p.title}
    </Text>
  );
}

export function CrewBubble({ crew, text }: { crew: CrewName; text: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={persona(crew).color} paddingX={1} marginTop={1}>
      <CrewLabel crew={crew} />
      <Text>{text.trim()}</Text>
    </Box>
  );
}

export function Working({ crew, tick, thinking }: { crew: CrewName; tick: number; thinking: string }) {
  const snippet = thinking.replace(/\s+/g, " ").trim().slice(-90);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={persona(crew).color}>
          <Spinner type={theme().spinner} />{" "}
        </Text>
        <CrewLabel crew={crew} />
        <Text color={DIM}> is {workingLine(crew, tick)}… (Esc to interrupt)</Text>
      </Text>
      {snippet ? (
        <Text color={DIM} italic wrap="truncate-end">
          {"  ⌁ "}
          {snippet}
        </Text>
      ) : null}
    </Box>
  );
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "📄",
  write_file: "💾",
  edit_file: "⌨",
  glob: "🗂",
  grep: "🔎",
  shell: "⚡",
  run_tests: "🧪",
};

export function ToolLine({ name, summary, ok, result }: { name: string; summary: string; ok?: boolean; result?: string }) {
  const status = ok === undefined ? <Spinner type="squareCorners" /> : ok ? <Text color="green">✓</Text> : <Text color="red">✗</Text>;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {"  "}
        {status} {TOOL_ICONS[name] ?? "•"} <Text bold>{name}</Text> <Text color={DIM}>{summary}</Text>
      </Text>
      {result && ok === false ? (
        <Text color="red" wrap="truncate-end">
          {"     "}
          {result}
        </Text>
      ) : null}
    </Box>
  );
}

export function BossBar({ boss }: { boss: Boss }) {
  const t = theme();
  const width = Math.min(boss.maxHp, 20);
  const filled = Math.round((boss.hp / boss.maxHp) * width);
  return (
    <Text>
      <Text color={t.colors.danger} bold>
        {t.icons.foe} {boss.name}{" "}
      </Text>
      <Text color={t.colors.danger}>{"█".repeat(filled)}</Text>
      <Text color={DIM}>{"░".repeat(width - filled)}</Text>
      <Text color={DIM}>
        {" "}
        {boss.hp}/{boss.maxHp} failing
      </Text>
    </Text>
  );
}

export function StatusBar({ xp, serious, sound, tts }: { xp: number; serious: boolean; sound: boolean; tts: boolean }) {
  if (serious) return <Text color={DIM}>serious mode · /serious to bring back the fun</Text>;
  const t = theme();
  const { rank, next, fraction } = progress(xp);
  const width = 16;
  const filled = Math.round(fraction * width);
  return (
    <Text>
      <Text color={t.colors.accent} bold>
        {rank.glyph} {rank.name}
      </Text>{" "}
      <Text color={t.colors.signal}>{"▰".repeat(filled)}</Text>
      <Text color={DIM}>{"▱".repeat(width - filled)}</Text>{" "}
      <Text color={t.colors.signal}>
        {t.icons.xp} {xp}
      </Text>
      <Text color={DIM}>
        {next ? ` / ${next.min} to ${next.name}` : ` · ${t.lines.topRank}`}
        {" · "}
        {t.name}
        {" · "}
        {sound ? (tts ? "🔊 voice" : "🔉") : "🔇"}
      </Text>
    </Text>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function HackCard({ hack }: { hack: Hack }) {
  const t = theme();
  return (
    <Box borderStyle="double" borderColor={t.colors.signal} paddingX={1} marginTop={1} flexDirection="column">
      <Text color={t.colors.signal} bold>
        {t.icons.unlock} {cap(t.words.achievement)} unlocked: {hack.title}
      </Text>
      <Text>
        {hack.description}{" "}
        <Text color={t.colors.signal}>
          +{hack.reward} {t.words.xp}
        </Text>
      </Text>
    </Box>
  );
}

export function RankUp({ rank }: { rank: string }) {
  const t = theme();
  return (
    <Box borderStyle="bold" borderColor={t.colors.accent} paddingX={2} marginTop={1} justifyContent="center">
      <Text color={t.colors.accent} bold>
        {fill(t.lines.rankUp, { rank })}
      </Text>
    </Box>
  );
}

export function GatePrompt({ req }: { req: ApprovalRequest }) {
  const t = theme();
  const verb =
    req.tool === "shell" ? "run a command" : req.tool === "run_tests" ? "run the tests" : req.tool === "write_file" ? "write a file" : "edit a file";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={req.risky ? "red" : t.colors.signal} paddingX={1} marginTop={1}>
      <Text color={t.colors.signal} bold>
        {t.icons.gate} {t.words.gate}: may {persona(req.crew).title} {verb}?
      </Text>
      {req.risky ? (
        <Text color="red" bold>
          ⚠ {t.lines.risky}
        </Text>
      ) : null}
      <Text>{req.detail}</Text>
      <Text color={DIM}>
        [y] yes · [a] always allow {req.tool} this session · [n] no
      </Text>
    </Box>
  );
}
