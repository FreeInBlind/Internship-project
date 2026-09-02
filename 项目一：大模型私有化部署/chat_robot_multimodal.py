"""Qwen3-VL 多模态聊天 Web UI。

本程序的处理流程是：上传内容 -> 组织为 Qwen-VL 的 messages ->
由 AutoProcessor 同时处理文字、图片和视频 -> 模型流式生成回答 ->
将回答实时更新到 Gradio 聊天窗口。

环境变量：
  MODEL_PATH      模型目录；默认值沿用原脚本。
  MAX_PIXELS      单张图片的最大像素数，默认 1280*1280，用于控制显存占用。
  ATTN_IMPL       可选，例如 flash_attention_2；未设置时由 Transformers 自动选择。
"""

from __future__ import annotations

import os
import queue
import inspect
from pathlib import Path
from threading import Thread
from typing import Any
from urllib.parse import quote

import gradio as gr
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor, TextIteratorStreamer

try:
    # Qwen 官方工具负责读取视频并按模型要求抽帧。
    from qwen_vl_utils import process_vision_info
except ImportError:  # 仅使用文本/图片时仍可运行；视频场景会给出明确提示。
    process_vision_info = None


MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    "/root/autodl-tmp/models/models/Qwen--Qwen3-VL-8B-Instruct/snapshots/master",
)
# 限制图片像素数可以显著降低视觉编码阶段的显存占用；数值越大细节越多，显存开销也越高。
MAX_PIXELS = int(os.environ.get("MAX_PIXELS", str(1280 * 1280)))
VIDEO_SUFFIXES = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


def normalize_uploads(value: Any) -> list[str]:
    """兼容不同 Gradio 版本返回的路径、字典和 FileData 对象。"""
    if value is None:
        return []
    values = value if isinstance(value, (list, tuple)) else [value]
    paths: list[str] = []
    for item in values:
        if isinstance(item, (str, Path)):
            paths.append(str(item))
            continue
        if isinstance(item, dict):
            path = item.get("path") or item.get("name")
        else:
            path = getattr(item, "path", None) or getattr(item, "name", None)
        if path:
            paths.append(str(path))
    return paths


def load_model_and_processor(model_dir: str):
    """加载视觉语言模型及其多模态处理器。

    ``device_map=auto`` 会让 Transformers 按显存情况自动放置模型；
    ``torch_dtype=auto`` 使用模型配置中推荐的数据类型，通常可节省显存。
    ``trust_remote_code`` 对 Qwen-VL 的自定义视觉代码是必要的。
    """
    model_kwargs: dict[str, Any] = {
        "trust_remote_code": True,
        "device_map": "auto",
        "torch_dtype": "auto",
    }
    # Flash Attention 需要已经在镜像中安装；不设置时不会影响普通部署。
    if attention := os.environ.get("ATTN_IMPL"):
        model_kwargs["attn_implementation"] = attention

    # AutoModelForImageTextToText 能根据 config.json 自动选择 Qwen3-VL 架构。
    model = AutoModelForImageTextToText.from_pretrained(model_dir, **model_kwargs)
    processor = AutoProcessor.from_pretrained(
        model_dir, trust_remote_code=True, max_pixels=MAX_PIXELS
    )
    # 推理模式会关闭 Dropout 等训练行为，减少无意义的计算。
    model.eval()
    return model, processor


# 模块导入时加载一次模型，避免每次点击“提交”都重复占用大量显存。
model, processor = load_model_and_processor(MODEL_PATH)
# generate 的输入张量必须放到模型所在设备；device_map=auto 时取首个参数所在设备即可。
MODEL_DEVICE = next(model.parameters()).device


def display_user_content(content: list[dict[str, str]]) -> str:
    """把模型消息转换为聊天窗口中的可读 Markdown。

    这是“显示副本”，不会改变送入模型的原始路径和消息结构。
    图片通过 Gradio 的 ``/file=`` 路由显示；视频暂显示文件名，
    但原视频路径仍会完整保存在 model_content 中并送入模型。
    """
    lines: list[str] = []
    for item in content:
        if item["type"] == "text":
            lines.append(item["text"])
        elif item["type"] == "image":
            path = item["image"]
            # /file= 是 Gradio 对临时上传文件提供的访问路径。
            lines.append(f"![图片](/file={quote(path)})")
        elif item["type"] == "video":
            lines.append(f"已上传视频：{Path(item['video']).name}")
    return "\n\n".join(lines)


def render_chat(history: list[dict[str, Any]]) -> list[dict[str, str]]:
    """转换为当前 Gradio Chatbot 要求的消息字典列表。

    当前 AutoDL 环境中的 Gradio 不接受 ``type="messages"`` 参数，
    但其 postprocess 仍要求每条消息含有 role 和 content 字段。
    """
    displayed: list[dict[str, str]] = []
    for message in history:
        if message["role"] == "user":
            displayed.append(
                {"role": "user", "content": display_user_content(message["model_content"])}
            )
        elif message["role"] == "assistant":
            displayed.append({"role": "assistant", "content": message["content"]})
    return displayed


def collect_visual_inputs(messages: list[dict[str, Any]]) -> tuple[Any, Any, dict[str, Any]]:
    """提取 Qwen Processor 所需的图像和视频数据。

    Qwen 官方示例使用 ``qwen_vl_utils.process_vision_info`` 读取本地媒体、
    URL 或 data URL，并负责视频抽帧。若只处理文字/图片且未安装该工具，
    图片仍可直接交给 Processor；一旦出现视频，则给出可操作的安装提示。
    """
    if process_vision_info is not None:
        # 新版 Qwen3-VL 可能额外返回视频帧率/时间戳参数；旧版工具不支持该参数。
        try:
            vision_info = process_vision_info(messages, return_video_kwargs=True)
        except TypeError:
            vision_info = process_vision_info(messages)
        if len(vision_info) == 3:
            image_inputs, video_inputs, video_kwargs = vision_info
            return image_inputs, video_inputs, video_kwargs or {}
        image_inputs, video_inputs = vision_info
        return image_inputs, video_inputs, {}

    images = [
        part["image"]
        for message in messages
        for part in (message["content"] if isinstance(message["content"], list) else [])
        if part["type"] == "image"
    ]
    videos = [
        part["video"]
        for message in messages
        for part in (message["content"] if isinstance(message["content"], list) else [])
        if part["type"] == "video"
    ]
    if videos:
        raise RuntimeError("视频输入需要安装 qwen-vl-utils：pip install qwen-vl-utils")
    return images or None, None, {}


def build_messages(
    history: list[dict[str, Any]], system_prompt: str | None
) -> list[dict[str, Any]]:
    """生成传给模型的完整上下文。

    ``model_content`` 保留了图片/视频路径，而 ``content`` 只是界面文本；
    因此这里必须使用 model_content，不能直接使用界面显示数据。
    """
    messages: list[dict[str, Any]] = []
    system_prompt = (system_prompt or "").strip()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for message in history:
        if message["role"] == "user":
            messages.append({"role": "user", "content": message["model_content"]})
        elif message["role"] == "assistant":
            messages.append({"role": "assistant", "content": message["content"]})
    return messages


def add_user_message(
    text: str | None, uploaded_files: Any, history: list[dict[str, Any]] | None
):
    """接收用户输入，并建立一轮“用户消息 + 空助手消息”。

    空助手消息是为了让流式生成函数可以不断修改最后一条记录。
    """
    text = (text or "").strip()
    file_paths = normalize_uploads(uploaded_files)
    if not text and not file_paths:
        raise gr.Error("请输入问题或上传至少一张图片/视频。")

    # Gradio File(file_count=multiple) 在不同版本中可能返回路径字符串、字典或 FileData。
    model_content: list[dict[str, str]] = []
    for file_path in file_paths:
        # Gradio 会给出临时文件的实际路径，文件后缀可可靠地区分图像和视频。
        kind = "video" if Path(file_path).suffix.lower() in {
            ".mp4", ".avi", ".mov", ".mkv", ".webm"
        } else "image"
        model_content.append({"type": kind, kind: file_path})
    if text:
        model_content.append({"type": "text", "text": text})

    updated_history = (history or []) + [
        {
            "role": "user",
            "model_content": model_content,
        },
        {"role": "assistant", "content": ""},
    ]
    return "", None, render_chat(updated_history), updated_history


def generate_reply(
    history: list[dict[str, Any]], system_prompt: str, max_new_tokens: int,
    top_p: float, temperature: float,
):
    """将图文消息预处理后交给模型，并把回答实时回传给 Gradio。"""
    # history 最后一项是 add_user_message 预留的空助手消息，不能再次作为输入。
    messages = build_messages(history[:-1], system_prompt)
    # Qwen 的 chat template 会插入视觉占位符和生成起始标记。
    prompt = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    # qwen-vl-utils 会读取本地媒体，并按 Qwen3-VL 要求完成视频抽帧。
    image_inputs, video_inputs, video_kwargs = collect_visual_inputs(messages)
    # Processor 同时完成分词、图片缩放/归一化、视频抽帧和张量整理。
    inputs = processor(
        text=[prompt],
        images=image_inputs or None,
        # 新版 Transformers 约定视频元数据放在 videos_kwargs 中。
        videos=video_inputs or None,
        videos_kwargs=video_kwargs,
        padding=True,
        return_tensors="pt",
    ).to(MODEL_DEVICE)

    # Streamer 将新 token 解码成文字，主线程可以边生成边刷新网页。
    streamer = TextIteratorStreamer(
        processor.tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=120
    )
    # 这些参数对应右侧滑块；temperature=0 时使用贪心解码。
    generate_kwargs: dict[str, Any] = {
        **inputs,
        "streamer": streamer,
        "max_new_tokens": int(max_new_tokens),
        "repetition_penalty": 1.1,
        "use_cache": True,
    }
    # 温度为 0 时使用贪心解码，不传采样参数以避免 Transformers 警告。
    if temperature > 0:
        generate_kwargs.update(
            {"do_sample": True, "top_p": float(top_p), "temperature": float(temperature)}
        )
    else:
        generate_kwargs["do_sample"] = False

    worker_errors: list[Exception] = []

    def worker() -> None:
        try:
            with torch.inference_mode():
                model.generate(**generate_kwargs)
        except Exception as error:
            # 后台线程异常不会自动传回 Gradio，先记录并结束 streamer。
            worker_errors.append(error)
            try:
                streamer.end()
            except Exception:
                pass

    # generate 会阻塞，因此放到后台线程，当前函数专门消费 streamer。
    Thread(target=worker, daemon=True).start()

    answer = ""
    try:
        # 每收到一段文本就 yield 一次，Gradio 会立即更新聊天窗口。
        for token in streamer:
            if token:
                answer += token
                history[-1]["content"] = answer
                # 同时回写 State，下一轮请求才会携带刚生成的助手回答。
                yield render_chat(history), history
    except queue.Empty as error:
        cause = worker_errors[0] if worker_errors else error
        raise RuntimeError("模型生成超时，请降低图片分辨率或最大生成长度。") from cause
    if worker_errors:
        raise RuntimeError("模型生成失败，请查看终端中的完整异常信息。") from worker_errors[0]


with gr.Blocks(title="Qwen3-VL 私有化多模态助手") as demo:
    gr.Markdown("# Qwen3-VL 私有化多模态助手")
    # 此镜像的 Gradio 不接受 type 参数，但默认输出格式为 messages。
    chatbot = gr.Chatbot(height=600)
    # State 保存模型需要的原始多模态上下文，不直接暴露给用户。
    history_state = gr.State([])

    with gr.Row():
        with gr.Column(scale=3):
            user_input = gr.Textbox(
                label="问题", placeholder="输入问题；可结合上传的图片或视频提问", lines=4
            )
            image_input = gr.File(
                label="图片或视频（可多选）",
                file_types=["image", "video"],
                file_count="multiple",
            )
            submit_button = gr.Button("提交", variant="primary")
        with gr.Column(scale=1):
            prompt_input = gr.Textbox(label="系统提示词", lines=5)
            clear_button = gr.Button("清除聊天记录")
            max_new_tokens = gr.Slider(1, 32768, value=2048, step=1, label="最大生成长度")
            top_p = gr.Slider(0.01, 1.0, value=0.8, step=0.01, label="Top P")
            temperature = gr.Slider(0.0, 2.0, value=0.6, step=0.01, label="Temperature")

    # 点击提交：先清空输入框并显示用户消息，再异步开始生成回答。
    submit_event = submit_button.click(
        add_user_message,
        inputs=[user_input, image_input, history_state],
        outputs=[user_input, image_input, chatbot, history_state],
        queue=False,
    )
    submit_event.then(
        generate_reply,
        inputs=[history_state, prompt_input, max_new_tokens, top_p, temperature],
        outputs=[chatbot, history_state],
    )
    # 回车提交与点击按钮使用完全相同的处理链。
    user_input.submit(
        add_user_message,
        inputs=[user_input, image_input, history_state],
        outputs=[user_input, image_input, chatbot, history_state],
        queue=False,
    ).then(
        generate_reply,
        inputs=[history_state, prompt_input, max_new_tokens, top_p, temperature],
        outputs=[chatbot, history_state],
    )
    # 清空可见聊天记录和内部上下文，下一次提问从新会话开始。
    clear_button.click(lambda: ([], []), outputs=[chatbot, history_state], queue=False)


# 开启队列以支持生成器的流式输出，并把单卡生成任务限制为一个。
# 不同 Gradio 版本使用不同参数名，因此按运行时签名做兼容处理。
queue_parameters = inspect.signature(demo.queue).parameters
if "default_concurrency_limit" in queue_parameters:
    demo.queue(default_concurrency_limit=1)
elif "concurrency_count" in queue_parameters:
    demo.queue(concurrency_count=1)
else:
    demo.queue()
# 保留 server_name=127.0.0.1：AutoDL 的网页映射通常映射本机回环地址。
# 默认不启用 Gradio 公网分享链接，避免无鉴权暴露推理入口；网页映射不受影响。
demo.launch(
    server_name="127.0.0.1",
    server_port=int(os.environ.get("GRADIO_PORT", "6006")),
    inbrowser=os.environ.get("INBROWSER", "0") == "1",
    share=os.environ.get("GRADIO_SHARE", "0") == "1",
)
