"""启动 Qwen3-VL OpenAI 兼容接口的入口脚本。

本文件不负责加载模型，而是定位同目录下的 qw_server.py 并启动它。
这样做可以把“启动参数/环境变量”和“接口实现”分开，便于后续维护。
"""

import os
import subprocess
import sys
from pathlib import Path

# MODEL_PATH 是服务器上的模型目录；优先读取环境变量，便于更换模型而无需改代码。
MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    "/root/autodl-tmp/models/models/Qwen--Qwen3-VL-8B-Instruct/snapshots/master",
)

def main() -> None:
    """使用当前 Python 解释器启动同目录的 FastAPI 实现。"""
    # 复制当前进程环境，保留 CUDA、代理等配置，再显式传递模型目录。
    environment = os.environ.copy()
    environment["MODEL_PATH"] = MODEL_PATH
    # 使用 __file__ 的绝对路径，不依赖执行命令时所在的当前目录。
    server_script = Path(__file__).resolve().with_name("qw_server.py")
    if not server_script.is_file():
        raise FileNotFoundError(
            f"Missing API server file: {server_script}. Upload qw_server.py to the same directory as openai_server.py."
        )
    # 沿用当前 Python 解释器启动服务；check=True 可把子进程错误直接反馈给用户。
    subprocess.run([sys.executable, str(server_script)], env=environment, check=True)


if __name__ == "__main__":
    main()
