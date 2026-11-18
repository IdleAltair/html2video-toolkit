// 管线公共工具：ffmpeg 解析 + 时长探测（Windows / WSL 通用）
// 时长用 ffmpeg -i 的 Duration 行：单工具、双平台（WSL 下 Windows .exe 看不懂 /mnt 路径，
// 而 bin/ffmpeg-linux 是原生 ELF；ffmpeg -i 在两边都只依赖一个二进制）。
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WIN_FFMPEG = "$HOME/AppData/Local/Temp/opencode/ffmpeg8/ffmpeg-8.0-full_build/bin/ffmpeg.exe";
const WSL_FFMPEG = "/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg";

function candidates() {
  const env = process.env.FFMPEG;
  const hfEnv = process.env.HYPERFRAMES_FFMPEG_PATH;
  const bin = path.join(ROOT, "bin");
  const exe = path.join(bin, "ffmpeg.exe");
  const elf = path.join(bin, "ffmpeg-linux");
  const isWin = process.platform === "win32";
  const binOrder = isWin ? [exe, elf] : [elf, exe];
  const rest = isWin ? [WIN_FFMPEG, "ffmpeg"] : [WIN_FFMPEG, WSL_FFMPEG, "ffmpeg"];
  return [env, hfEnv, ...binOrder, ...rest];
}

function resolveFfmpeg() {
  for (const c of candidates()) {
    if (!c) continue;
    if (c.includes("/") || c.includes("\\") || c.endsWith(".exe")) {
      if (existsSync(c)) return c;
    } else {
      try { execSync(c + " -version", { stdio: "ignore" }); return c; } catch { /* 下一个 */ }
    }
  }
  throw new Error("找不到 ffmpeg：把 ffmpeg 放进项目 bin/（ffmpeg.exe 或 ffmpeg-linux），或设环境变量 FFMPEG");
}

export function ffmpeg() { return resolveFfmpeg(); }

export function mediaDur(file) {
  let errOut = "";
  try {
    execFileSync(ffmpeg(), ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    errOut = e.stderr ? e.stderr.toString() : String(e);
  }
  const lines = errOut.split(String.fromCharCode(10)).map(l => l.trim());
  const dl = lines.find(l => l.indexOf("Duration:") === 0);
  if (!dl) throw new Error("ffmpeg 无法解析时长: " + file);
  const mm = dl.slice(10, 19).split(":").map(Number);
  if (mm.length < 3 || !isFinite(mm[0] + mm[1] + mm[2])) throw new Error("ffmpeg 时长解析异常: " + dl.slice(0, 60));
  return mm[0] * 3600 + mm[1] * 60 + mm[2];
}

export function run(cmd, args, label) {
  const shown = cmd + " " + args.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(" ");
  process.stdout.write("\n$ " + label + "\n  " + shown + "\n");
  execFileSync(cmd, args, { stdio: "inherit" });
}

export const f1 = n => Math.round(n * 100) / 100;
export const fmtT = s => { s = Math.round(s); const m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); };
