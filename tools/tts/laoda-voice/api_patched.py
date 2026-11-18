# -*- coding: utf-8 -*-
"""带自定义采样温度的 BreezeTTS 常驻 API 启动器（不修改上游仓库任何文件）。

上游 api.py:168 调 update_generation_config_for_breeze(model) 时不传第二个参数，
runtime.py 里的 generation_config 于是恒为 temperature=0.9 / depth_decoder_temperature=0.9，
模型包的 generation_config.json 被覆盖，API 也没有暴露温度开关。
这里在**我们自己的进程**里把 api 模块的这个名字重新绑定，注入想要的采样参数，
上游代码保持原样。

用法（WSL，cwd 随意）：
  CUDA_VISIBLE_DEVICES=1 BREEZE_TEMP=0.5 BREEZE_PORT=7862 \
    $HOME/breeze-tts-env/.venv/bin/python api_patched.py
"""
import os
import sys

REPO = os.environ.get("BREEZE_REPO", "$PROJECT_ROOT/breeze-tts")
MODEL = os.environ.get("BREEZE_MODEL", "$PROJECT_ROOT/breeze-tts-2")
TEMP = float(os.environ.get("BREEZE_TEMP", "0.5"))
PORT = os.environ.get("BREEZE_PORT", "7862")
TOP_P = float(os.environ.get("BREEZE_TOP_P", "1.0"))
TOP_K = int(os.environ.get("BREEZE_TOP_K", "50"))

sys.path.insert(0, REPO)
import breeze_infer.api as A            # noqa: E402
import breeze_infer.runtime as R        # noqa: E402

GEN = {
    "depth_decoder_do_sample": True,
    "depth_decoder_temperature": TEMP,
    "depth_decoder_top_p": TOP_P,
    "depth_decoder_top_k": TOP_K,
    "do_sample": True,
    "top_p": TOP_P,
    "top_k": TOP_K,
    "max_new_tokens": 750,
    "temperature": TEMP,
}

_orig = A.update_generation_config_for_breeze
A.update_generation_config_for_breeze = lambda model, gen=None: _orig(model, GEN)

print("[api_patched] temp=%s top_p=%s top_k=%s port=%s model=%s" % (TEMP, TOP_P, TOP_K, PORT, MODEL), flush=True)
sys.argv = ["api", "--host", "127.0.0.1", "--port", PORT, MODEL]
A.main()
