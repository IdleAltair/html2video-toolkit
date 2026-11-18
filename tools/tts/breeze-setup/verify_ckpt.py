import json, os, sys

# 用 HF 官方清单（之前抓的 API 响应）逐项核对 ModelScope 落盘结果
d = json.load(open(os.path.expanduser("~/breeze_hf.json")))
want = {s["rfilename"]: s.get("size") for s in d["siblings"]}
root = "$PROJECT_ROOT/breeze-tts-2"
bad, missing, extra = [], [], []
for name, size in want.items():
    p = os.path.join(root, name)
    if not os.path.exists(p):
        missing.append(name)
        continue
    got = os.path.getsize(p)
    if size is not None and got != size:
        bad.append((name, size, got))
for dirpath, dirnames, filenames in os.walk(root):
    if ".cache" in dirpath:
        continue
    for f in filenames:
        rel = os.path.relpath(os.path.join(dirpath, f), root).replace("\\", "/")
        if rel not in want:
            extra.append(rel)
print(f"HF 清单 {len(want)} 项  本地额外 {len(extra)} 项")
print("MISSING:", missing or "none")
print("SIZE-MISMATCH:", bad or "none")
print("EXTRA:", extra or "none")
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, dn, fn in os.walk(root) if ".cache" not in dp for f in fn)
print(f"本地合计 {total/1e9:.2f} GB / HF 期望 {sum(v for v in want.values() if v)/1e9:.2f} GB")
