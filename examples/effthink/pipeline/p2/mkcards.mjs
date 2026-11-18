// 给 P2 的 8 局各出一张 2.5s 标题卡（1920x1080@30，与录像同参数，能直接 concat）
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from "node:fs";

const ROOT = "$PROJECT_ROOT/arena-effthink";
const OUT = ROOT + "/clips-p2";
const CD = OUT + "/_cards";
mkdirSync(CD, { recursive: true });
const FF = process.platform === "win32" ? ROOT + "/../bin/ffmpeg.exe" : "ffmpeg";
const FONT = ROOT + "/assets/NotoSansSC-Bold.otf";
const REG = ROOT + "/assets/NotoSansSC-Regular.otf";
const JOBS = JSON.parse(readFileSync(OUT + "/_jobs.json", "utf8"));
// fontfile 里的盘符冒号会被 filtergraph 当成选项分隔符，所以把字体拷进 cwd 用纯文件名引用
copyFileSync(FONT, CD + "/bold.otf");
copyFileSync(REG, CD + "/reg.otf");
const FONT_C = "bold.otf", REG_C = "reg.otf";

const put = (n, s) => writeFileSync(CD + "/" + n, s, "utf8");
// drawtext 的 x=(w-text_w)/2 是按整块文本居中的，多行会左吊，所以每行单独画一次
function wrap(s, max) {
  const out = []; let cur = "", w = 0;
  for (const ch of s) {
    const u = /[\x00-\xff]/.test(ch) ? 0.5 : 1;
    if (w + u > max && cur) { out.push(cur); cur = ch; w = u; } else { cur += ch; w += u; }
  }
  if (cur) out.push(cur);
  return out;
}
const dt = (file, font, size, color, y) =>
  "drawtext=fontfile=" + font + ":textfile=" + file + ":fontsize=" + size +
  ":fontcolor=" + color + ":x=(w-text_w)/2:y=" + y;

const durOf = (f) => {
  const r = spawnSync(FF, ["-i", f], { encoding: "utf8" });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr || "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

for (let i = 0; i < JOBS.length; i++) {
  const j = JOBS[i], n = i + 1;
  const mp4 = OUT + "/" + j.key + ".mp4";
  if (!existsSync(mp4)) { console.log("跳过 " + j.key + "（还没录）"); continue; }
  const dur = durOf(mp4);
  put("tag.txt", "P2 · 完整回放    " + n + " / " + JOBS.length + "    " + dur.toFixed(0) + " 秒");
  const tl = wrap(j.t, 26), nl = wrap(j.n, 32);
  put("ttl.txt", tl[0]); put("ttl2.txt", tl[1] || " ");
  put("note.txt", nl[0]); put("note2.txt", nl[1] || " ");
  put("note3.txt", nl[2] || " ");
  if (nl.length > 3) console.log("!! " + j.key + " 说明超过 3 行，缩短文案");
  const dst = OUT + "/c" + j.key + ".mp4";
  const r = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi",
    "-i", "color=c=0x050b2a:s=1920x1080:r=30:d=3",
    "-vf", [dt("tag.txt", REG_C, 34, "0x93a9e6", "h*0.28"),
            dt("ttl.txt", FONT_C, 64, "white", "h*0.40"),
            dt("ttl2.txt", FONT_C, 64, "white", "h*0.40+82"),
            dt("note.txt", REG_C, 36, "0xff8a6e", "h*0.60"),
            dt("note2.txt", REG_C, 36, "0xff8a6e", "h*0.60+52"),
            dt("note3.txt", REG_C, 36, "0xff8a6e", "h*0.60+104"),
            "format=yuv420p"].join(","),
    "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-r", "30",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], { cwd: CD, stdio: "inherit" });
  console.log((r.status === 0 ? "OK   " : "FAIL ") + j.key + "  " + dur.toFixed(1) + "s → " + (existsSync(dst) ? (statSync(dst).size / 1024).toFixed(0) + "KB" : "—"));
}
