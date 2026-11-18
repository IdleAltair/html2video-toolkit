// P2 完整回放：按 Q4-final.md 第二节的 8 局逐局整场录（串行，避免抢帧）
// 用法: node /e/tmp/rec-p2.mjs [起始序号]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOT = "$PROJECT_ROOT/arena-effthink";
const OUT = ROOT + "/clips-p2";
mkdirSync(OUT, { recursive: true });
const L = "$TMP/replay-out/land/coder390/";
const B = "$TMP/replay-out/bomb/html/";
const C = "$TMP/replay-out/ctf/html/";
const kick = (sp) => "(function(){var s=document.getElementById('speed');if(s){s.value='" + sp + "';" +
  "s.dispatchEvent(new Event('change'));}var b=document.getElementById('play');if(b)b.click();})()";

// 采集帧率 = 回放页的 speed（screencast 只在画面变化时出帧），所以一律用 20 回合/秒那档：
// @2/@8 录出来是 2/8 fps 的幻灯片，@20 才有 20fps 的连续感。9 个视频槽用的也是这一档。
// sec = 回合数 / 20 + 余量；跑完画面转静止、不再出帧，多出来的秒数不会变成静止段
const JOB = [
  { key: "01-land-L32", f: L + "c390-sub-duel-seed1004-gpt-6-sol-our1165.html", sp: 20, sec: 42,
    t: "圈地 · 单挑 2 人 40×40 · 交卷版", n: "600 回合 · 1165 : 358 赢下当期前三的 gpt-6-sol" },
  { key: "02-land-L38", f: L + "c390-sub-duel-seed1002-deepseek-41f-our1013.html", sp: 20, sec: 42,
    t: "圈地 · 单挑 2 人 40×40 · 交卷版", n: "600 回合 · 1013 : 14 胜 deepseek-4.1f，被它切断 9 次仍赢" },
  { key: "03-land-L55", f: L + "c390-fin-melee-seed6001-our708.html", sp: 20, sec: 42,
    t: "圈地 · 混战 4 人 48×48 · 加时终版", n: "600 回合 · 在 sonnet-5 与 opus-5.5 夹击下拿第一，只领先 27 格" },
  { key: "04-bomb-B45", f: B + "B45_本轮Coder390-coder390-ctl-w7-113314_10人_局01299_574帧.html", sp: 10, sec: 72,
    t: "炸弹人 · 10 人 25×25 · 正赛交卷", n: "574 帧 · 200 局里唯一一局打到终场只剩自己一人（41/4、5 杀）" },
  { key: "05-bomb-B41", f: B + "B41_本轮Coder390-coder390-ctl-w7-113314_10人_局01253_597帧.html", sp: 10, sec: 72,
    t: "炸弹人 · 10 人 25×25 · 正赛交卷", n: "597 帧 · 43/4 分 + 7/2 杀，本批次双峰值" },
  { key: "06-bomb-B70", f: B + "B70_本轮Coder390-coder390-ctl-w7-123041_10人_局01150_602帧.html", sp: 10, sec: 72,
    t: "炸弹人 · 10 人 25×25 · 加时改完又退回的那一遍", n: "602 帧 · 同图同座位：交卷版 8 回合被炸死 0 分 → 这一遍打满 600 回合独占第一" },
  { key: "07-ctf-957", f: C + "R3_rerun-ot-13-003-00-00957.html", sp: 20, sec: 32,
    t: "夺旗 · 13 方混战 49×49 · 加时终版",
    n: "400 回合 · 本轮夺旗最大场，11 个真实选手同场。夺旗正式赛没存回放，画面是同一张图另起的一局（旗点每局现抽），右上角是本局内部分数，不代表成绩" },
  { key: "08-ctf-065", f: C + "R4_rerun-ot-02-004-04-00065.html", sp: 20, sec: 32,
    t: "夺旗 · 2 方 23×23 · 加时终版",
    n: "400 回合 · 本机 4 : 3 拿下豆包 Seed 2.1 Turbo。同样另起的一局，只看抢旗与防守的走法" },
];
writeFileSync(OUT + "/_jobs.json", JSON.stringify(JOB, null, 1));
const from = Number(process.argv[2] || 0);
const log = [];
for (let i = from; i < JOB.length; i++) {
  const j = JOB[i];
  const url = encodeURI("file:///" + j.f.replace(/\\/g, "/")) + "#stage";
  console.log("== " + (i + 1) + "/8 " + j.key + " @" + j.sp + " 录 " + j.sec + "s ==");
  const r = spawnSync(process.execPath, [ROOT + "/pipeline/record-4k.mjs",
    "--page", url, "--needle", encodeURIComponent(j.f.split("/").pop().slice(0, 12)),
    "--kick", kick(j.sp), "--out", OUT + "/" + j.key + ".mp4", "--seconds", String(j.sec),
    "--w", "1920", "--h", "1080", "--fps", "30", "--root", ROOT], { stdio: "inherit" });
  log.push(j.key + " exit=" + r.status);
  writeFileSync(OUT + "/_rec-p2.log", log.join("\n") + "\n");
}
console.log("\n" + log.join("\n"));
