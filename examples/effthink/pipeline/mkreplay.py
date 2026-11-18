
"""把一局回放渲染成自带头像的独立 HTML，供成片定点录屏。

  python3 pipeline/mkreplay.py <replay.json|.json.gz> -o out.html [--viewer pipeline/viewer/bomb.html]

头像来自 $AVATAR_DIR\png\avatars（优先取同名 512 原图，缩到 192 缓存进 pipeline/viewer/_ava/），27B 用副本里的 assets/ava-27b.png；
两者都按 data URI 内联，产物单文件、file:// 可直接打开。名字表见 NAME2FILE。
"""
import argparse, base64, gzip, json, mimetypes, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
AVA_DIR = pathlib.Path('$AVATAR_DIR/png/avatars')
AVA_27B = ROOT / 'assets' / 'ava-27b.png'
NAME2FILE = {
    '你的 bot': AVA_27B,
    'GPT-6 Astra': 'gpt-6-astra@96.png',
    'GPT-6 Sol': 'gpt-6-sol@96.png',
    'GPT-6.1 Sol': 'gpt-6-sol@96.png',
    'Opus 5.5': 'opus-5.5@96.png',
    'Kimi K3': 'kimi-k3@96.png',
    'GLM 5.3': 'glm-5.3@96.png',
    'DeepSeek V4.1 Flash': 'deepseek-v4.1-flash@96.png',
    '豆包 Seed 2.1': 'doubao-seed-2.1-turbo@96.png',
    '豆包 Seed 2.1 Turbo': 'doubao-seed-2.1-turbo@96.png',
    'Qwen 3.8 Max': 'qwen-3.8-max@96.png',
    'MiMo V2.6 Pro': 'mimo-v2.6-pro@96.png',
    'Fable 5.1': 'fable-5.1@96.png',
    'Sonnet 5.5': 'sonnet-5.5@96.png',
    'Base': 'base@96.png',
    '基准': 'base@96.png',
    # 加时赛补测的八方局（diag8）里本机就叫 bot，对手是 baseline#1…7 这七个基准副本
    'bot': AVA_27B,
}


AVA_PX = 192          # 棋盘单位圆 2× 超采样下最大约 40 逻辑 px，192 留 4× 余量；比 512 原图省约 8 倍体积
AVA_CACHE = HERE / 'viewer' / '_ava'


def sized(path):
    """优先取同名 512 原图并缩到 AVA_PX 缓存；PIL 不可用或图本来就小则原样返回。"""
    q = pathlib.Path(path)
    if q.name.endswith('@96.png'):
        big = q.with_name(q.name.replace('@96.png', '.png'))
        if big.is_file():
            q = big
    if AVA_PX <= 0 or not q.is_file() or q.stat().st_size <= 40960:
        return q
    try:
        from PIL import Image
    except Exception:
        return q
    AVA_CACHE.mkdir(parents=True, exist_ok=True)
    out = AVA_CACHE / (q.stem + '@%d.png' % AVA_PX)
    if not out.is_file() or out.stat().st_mtime < q.stat().st_mtime:
        im = Image.open(q).convert('RGBA')
        if max(im.size) > AVA_PX:
            im = im.resize((AVA_PX, AVA_PX), Image.LANCZOS)
        im.save(out, 'PNG', optimize=True)
    return out


def data_uri(path):
    b = pathlib.Path(path).read_bytes()
    mime = mimetypes.guess_type(str(path))[0] or 'image/png'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(b).decode('ascii'))


# 圈地/夺旗的选手名是 bot 编号（<模型>@<工具>#<序号>），按前缀映射到头像文件
PREFIX = {
    'your-bot': AVA_27B,
    'sonnet-5': 'sonnet-5.5@96.png',
    'deepseek-4.1f': 'deepseek-v4.1-flash@96.png',
    'mimo-2.6-pro': 'mimo-v2.6-pro@96.png',
    'anchor-': 'base@96.png',
    'baseline': 'base@96.png',
}


def resolve(name):
    """把选手名（显示名或 bot 编号）解析成头像文件路径，找不到返回 None。"""
    if name in NAME2FILE:
        f = NAME2FILE[name]
        return pathlib.Path(f) if pathlib.Path(f).is_absolute() else AVA_DIR / f
    slug = str(name).split('@')[0]
    for pre, f in PREFIX.items():
        if slug.startswith(pre):
            return pathlib.Path(f) if pathlib.Path(f).is_absolute() else AVA_DIR / f
    for cand in (slug + '@96.png', slug + '.png'):
        p = AVA_DIR / cand
        if p.is_file():
            return p
    return None


def avatars_for(names):
    out = {}
    missing = []
    for n in names:
        if n in out:
            continue
        p = resolve(n)
        if p and p.is_file():
            out[n] = data_uri(sized(p))
        else:
            missing.append(n)
    return out, missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('replay')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--viewer', default=str(HERE / 'viewer' / 'bomb.html'))
    args = ap.parse_args()
    src = pathlib.Path(args.replay)
    raw = gzip.open(src, 'rt', encoding='utf-8').read() if src.suffix == '.gz' else src.read_text(encoding='utf-8')
    data = json.loads(raw)
    names = (data.get('result') or {}).get('names') or []
    av, missing = avatars_for(names)
    tpl = pathlib.Path(args.viewer).read_text(encoding='utf-8')
    if '/*REPLAY_DATA*/null' not in tpl:
        sys.exit('模板里没有 /*REPLAY_DATA*/ 占位：' + args.viewer)
    safe = raw.replace('<', '\\u003c')
    html = tpl.replace('/*REPLAY_DATA*/null', safe).replace('/*AVATARS*/null', json.dumps(av, ensure_ascii=False))
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print('%-52s %6.1f KB  头像 %d/%d%s' % (out.name, out.stat().st_size / 1024, len(av), len(names),
          ('  缺: ' + ','.join(missing)) if missing else ''))


if __name__ == '__main__':
    main()
