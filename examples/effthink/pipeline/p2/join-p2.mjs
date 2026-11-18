// 把 8 张标题卡 + 8 段完整回放按「卡→局」串成 P2 整片，并可选垫配乐
// 用法: node /e/tmp/join-p2.mjs [--bgm <m4a|wav>]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";

const ROOT = "$PROJECT_ROOT/arena-effthink";
const OUT = ROOT + "/clips-p2";
const FF = process.platform === "win32" ? ROOT + "/../bin/ffmpeg.exe" : "ffmpeg";
const JOBS = JSON.parse(readFileSync(OUT + "/_jobs.json", "utf8"));
const opt = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const HOLD = Number(opt("hold", 0));
const bgmI = process.argv.indexOf("--bgm");
const BGM = bgmI < 0 ? null : process.argv[bgmI + 1];
const DST = OUT + (BGM ? "/p2-replay-av.mp4" : "/p2-replay-silent.mp4");
mkdirSync(OUT + "/hold", { recursive: true });

function durOf(f) {
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(spawnSync(FF, ["-i", f], { encoding: "utf8" }).stderr || "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
const parts = [];
for (const j of JOBS) {
  const c = OUT + "/c" + j.key + ".mp4";
  let v = OUT + "/" + j.key + ".mp4";
  if (HOLD > 0) {
    const h = OUT + "/hold/" + j.key + ".mp4";
    if (!existsSync(h)) {
      const r = spawnSync(FF, ["-y", "-v", "error", "-i", v,
        "-vf", "tpad=stop_mode=clone:stop_duration=" + HOLD,
        "-c:v", "libx264", "-crf", "17", "-preset", "veryfast", "-r", "30", "-pix_fmt", "yuv420p", "-an", h], { stdio: "inherit" });
      if (r.status !== 0) { console.log("!! 定格失败 " + j.key); process.exit(1); }
    }
    v = h;
  }
  if (!existsSync(c) || !existsSync(v)) { console.log("!! 缺件：" + j.key + "（卡 " + (existsSync(c) ? "有" : "无") + " / 片 " + (existsSync(v) ? "有" : "无") + "）"); continue; }
  parts.push(c, v);
}
if (parts.length !== JOBS.length * 2) { console.log("!! 件数不齐（%d 段 / 应 %d 段），先补录再拼", parts.length, JOBS.length * 2); process.exit(1); }
writeFileSync(OUT + "/_list.txt", parts.map((p) => "file '" + p.replace(/\\/g, "/") + "'").join("\n") + "\n", "utf8");
console.log("[join] " + parts.length + " 段 → concat " + DST);
let r = spawnSync(FF, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", OUT + "/_list.txt",
  "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "30",
  "-an", "-movflags", "+faststart", DST], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status);
if (BGM) {
  const dur = durOf(DST);
  const tmp = OUT + "/_p2-bgm.mp4";
  const fc = "[1:a][2:a]acrossfade=d=4:c1=tri:c2=tri," +
    "atrim=0:" + dur.toFixed(3) + ",asetpts=PTS-STARTPTS," +
    "afade=t=in:st=0:d=1.5,afade=t=out:st=" + (dur - 2.5).toFixed(3) + ":d=2.5," +
    "loudnorm=I=-18:TP=-1.5:LRA=11[a]";
  r = spawnSync(FF, ["-y", "-v", "error", "-i", DST, "-i", BGM, "-i", BGM,
    "-filter_complex", fc, "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status);
  renameSync(tmp, DST);
  console.log("[bgm] 配乐交叉循环铺满 " + dur.toFixed(1) + "s，响度 -18 LUFS，尾 2.5s 淡出");
}
console.log("[done] " + DST);
