"""Example client for the Qwen3-VL OpenAI-compatible API.

Set BASE_URL to the provider's mapped URL when calling the remote server.
For an image or video, set IMAGE_PATH or VIDEO_PATH. The client sends the file
as a data URL, so the server does not need access to your local filesystem.
"""

import argparse
import base64
import mimetypes
import os
from pathlib import Path

DEFAULT_BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:6006/v1")
DEFAULT_API_KEY = os.environ.get("API_KEY", "EMPTY")
DEFAULT_MODEL_ID = os.environ.get("MODEL_ID", "qwen3-vl-8b-instruct")


def file_as_data_url(filename: str, expected_kind: str) -> str:
    """读取本地媒体并转换成 data URL。

    本地路径只存在于客户端电脑，服务器无法直接读取；转成 data URL 后，
    文件内容会随 JSON 请求一起发送，因此映射服务器无需共享本地文件系统。
    """
    path = Path(filename).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Media does not exist: {path}")
    mime_type = mimetypes.guess_type(path.name)[0]
    if not mime_type or not mime_type.startswith(f"{expected_kind}/"):
        raise ValueError(f"{path} is not a recognized {expected_kind} file")
    # Base64 只使用 ASCII 字符，适合安全地嵌入 JSON 字符串。
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def parse_args() -> argparse.Namespace:
    """读取命令行参数；未提供的值回退到环境变量。"""
    parser = argparse.ArgumentParser(description="调用本地 Qwen3-VL OpenAI 兼容接口")
    parser.add_argument("--question", default=os.environ.get("QUESTION", "请描述这张图片的内容。"))
    parser.add_argument("--image", default=os.environ.get("IMAGE_PATH"))
    parser.add_argument("--video", default=os.environ.get("VIDEO_PATH"))
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--api-key", default=DEFAULT_API_KEY)
    parser.add_argument("--model", default=DEFAULT_MODEL_ID)
    parser.add_argument("--stream", action="store_true", default=os.environ.get("STREAM", "0") == "1")
    parser.add_argument("--max-tokens", type=int, default=int(os.environ.get("MAX_TOKENS", "512")))
    return parser.parse_args()


def build_content(question: str, image_path: str | None, video_path: str | None):
    """构造 OpenAI 多模态 content-part；本地文件以 data URL 发送。"""
    if image_path and video_path:
        raise ValueError("--image 和 --video 不能同时使用。")
    if image_path:
        return [
            {"type": "image_url", "image_url": {"url": file_as_data_url(image_path, "image")}},
            {"type": "text", "text": question},
        ]
    if video_path:
        return [
            {"type": "video_url", "video_url": {"url": file_as_data_url(video_path, "video")}},
            {"type": "text", "text": question},
        ]
    return question


def main() -> None:
    # 延迟导入可让本文件中的请求构造函数在未安装 SDK 时被单独复用和测试。
    from openai import OpenAI

    args = parse_args()
    content = build_content(args.question, args.image, args.video)
    # OpenAI SDK 负责构造 HTTP 请求、序列化 messages 和解析响应。
    client = OpenAI(api_key=args.api_key, base_url=args.base_url.rstrip("/"))
    response = client.chat.completions.create(
        model=args.model,
        messages=[
            {"role": "system", "content": "你是一个有帮助的多模态 AI 助手。"},
            {"role": "user", "content": content},
        ],
        max_tokens=args.max_tokens,
        temperature=0.4,
        top_p=0.8,
        stream=args.stream,
    )
    if args.stream:
        # 每个 chunk 可能只带少量文字；结束块不含 content，需要跳过。
        for chunk in response:
            token = chunk.choices[0].delta.content if chunk.choices else None
            if token:
                print(token, end="", flush=True)
        print()
    else:
        print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
