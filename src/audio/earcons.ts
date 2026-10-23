import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RATE = 22_050;

/** [frequency Hz (0 = rest), duration s] */
type Note = [number, number];

export const EARCONS = {
  start: [[523.25, 0.08], [783.99, 0.14]],
  success: [[523.25, 0.09], [659.25, 0.09], [783.99, 0.09], [1046.5, 0.22]],
  fail: [[392.0, 0.12], [311.13, 0.12], [261.63, 0.28]],
  hit: [[880, 0.05], [1174.66, 0.09]],
  grow: [[196, 0.1], [207.65, 0.1], [220, 0.22]],
  gate: [[1318.51, 0.06], [0, 0.03], [1318.51, 0.06], [0, 0.03], [1760, 0.2]],
  hack: [[783.99, 0.06], [1046.5, 0.06], [1318.51, 0.06], [1567.98, 0.06], [2093, 0.26]],
  rankup: [[523.25, 0.12], [523.25, 0.06], [523.25, 0.06], [783.99, 0.18], [0, 0.04], [659.25, 0.1], [783.99, 0.36]],
  done: [[659.25, 0.07], [987.77, 0.16]],
} satisfies Record<string, Note[]>;

export type Earcon = keyof typeof EARCONS;

/**
 * Build a 16-bit mono WAV of soft-edged pulse waves with a slight detune, for a
 * small analogue-synth blip rather than a bell.
 */
export function synthesize(notes: Note[]): Buffer {
  const samples: number[] = [];
  for (const [freq, dur] of notes) {
    const n = Math.floor(dur * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const attack = Math.min(1, i / (RATE * 0.005));
      const decay = Math.exp(-3.5 * (t / dur));
      // tanh of a boosted sine is a square with rounded corners: synthy, but not harsh.
      const pulse = (f: number) => Math.tanh(3 * Math.sin(2 * Math.PI * f * t));
      const tone = freq ? 0.6 * pulse(freq) + 0.4 * pulse(freq * 1.006) : 0;
      samples.push(tone * attack * decay * 0.22);
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const dir = path.join(os.tmpdir(), "larper-earcons-v2");

function fileFor(name: Earcon): string {
  const file = path.join(dir, `${name}.wav`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, synthesize(EARCONS[name]));
  }
  return file;
}

function player(file: string): [string, string[]] | null {
  if (process.platform === "win32") {
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`]];
  }
  if (process.platform === "darwin") return ["afplay", [file]];
  return ["aplay", ["-q", file]];
}

let last = 0;

/** Fire-and-forget. Sound failures are never worth interrupting work for. */
export function play(name: Earcon): void {
  // Collapse bursts (e.g. several tool events at once) into one sound.
  const now = Date.now();
  if (now - last < 150) return;
  last = now;
  try {
    const cmd = player(fileFor(name));
    if (!cmd) return;
    const child = spawn(cmd[0], cmd[1], { stdio: "ignore", detached: false, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No audio device or player: stay silent.
  }
}
