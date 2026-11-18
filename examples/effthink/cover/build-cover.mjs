import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = "$PROJECT_ROOT/arena-effthink";
const CD = ROOT + "/cover";
const FF = "$PROJECT_ROOT/bin/ffmpeg.exe";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
if (!CHROME) throw new Error("找不到 Chrome");

const data = (f) => "data:font/woff2;base64," + readFileSync(ROOT + "/assets/" + f).toString("base64");
const src = readFileSync(CD + "/cover-src.html", "utf8")
  .replace("__FONT400__", data("noto-400.woff2"))
  .replace("__FONT700__", data("noto-700.woff2"));

writeFileSync(CD + "/_check.html", src);
const dump = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=1", "--window-size=1920,1080", "--virtual-time-budget=6000",
  "--dump-dom", pathToFileURL(CD + "/_check.html").href], { encoding: "utf8", maxBuffer: 1 << 28 });
const m = /METRICS (\[.*?\]) CONTRAST (\[.*?\]) ISSUES (\[.*?\])<\/pre>/.exec(dump.stdout || "");
if (!m) throw new Error("自检没跑出结果（metrics 节点缺失）—— 检查页面 load 事件与 --dump-dom 输出");
const boxes = JSON.parse(m[1]), contrast = JSON.parse(m[2]), issues = JSON.parse(m[3]);
for (const b of boxes) console.log("  " + b.id.padEnd(28) + " x[" + b.x0 + "," + b.x1 + "] y[" + b.y0 + "," + b.y1 + "] h=" + b.h);
console.log("对比度 " + contrast.join("   "));
if (issues.length) throw new Error("版式自检失败:\n  " + issues.join("\n  "));
console.log("自检通过：关键元素全在 4:3 安全区 x[240,1680] 内，无重叠，三卡等高且各两行，对比度均 ≥3.0");

// B 站首页推荐位是 4:3，个人空间是 16:9，同一张图按中心裁左右 → 关键内容必须落在 x 240..1680。
const shots = [
  { out: "bilibili-cover.png", html: src },
  { out: "guide.png", html: src.replace('class="no-guide"', 'class=""') },
];
for (const s of shots) {
  const h = CD + "/_" + s.out.replace(".png", ".html");
  writeFileSync(h, s.html);
  const r = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--window-size=1920,1080", "--virtual-time-budget=6000",
    "--screenshot=" + CD + "/" + s.out, pathToFileURL(h).href], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(s.out + " 截图失败: " + (r.stderr || r.stdout).slice(0, 400));
  console.log("出图 " + s.out);
}

const crop = (out, vf) => {
  const r = spawnSync(FF, ["-y", "-v", "error", "-i", CD + "/bilibili-cover.png", "-vf", vf, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(vf + " -> " + r.stderr.slice(0, 300));
  console.log("出图 " + path.basename(out));
};
crop(CD + "/preview-4x3.png", "crop=1440:1080:240:0");
crop(CD + "/preview-4x3-small.png", "crop=1440:1080:240:0,scale=480:360");
crop(CD + "/preview-16x9-small.png", "scale=480:270");
for (const f of ["_check.html", "_bilibili-cover.html", "_guide.html"]) if (existsSync(CD + "/" + f)) rmSync(CD + "/" + f);
