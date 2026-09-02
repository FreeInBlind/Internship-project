"""Qwen3-VL 的 OpenAI 兼容 API 服务。

本服务基于 Transformers，适用于 chat_robot_multimodal.py 已能运行的环境。
支持文本、图片、视频、多轮对话、SSE 流式响应、健康检查和可选 API Key 鉴权。

性能说明：Transformers 的 model.generate() 不支持 vLLM 那样的连续批处理。单卡时
MAX_CONCURRENT 应保持为 1，避免多个请求同时占用 KV Cache 而发生 OOM。若目标是
高并发吞吐，需要安装与 Qwen3-VL/CUDA 版本兼容的 vLLM，而不是提高此数值。
"""

import base64
import binascii
import ipaddress
import json
import os
import queue
import secrets
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import torch
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from transformers import AutoModelForImageTextToText, AutoProcessor, TextIteratorStreamer

try:
    # Qwen 官方工具负责读取本地媒体、URL 或 data URL，并执行视频抽帧。
    from qwen_vl_utils import process_vision_info
except ImportError:  # 仅文本/图片场景仍可运行；视频请求会返回明确错误。
    process_vision_info = None


# =============================== 部署参数 ===============================
# 所有参数都可以在启动前以环境变量覆盖，避免将服务器差异写死在源码中。
MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    "/root/autodl-tmp/models/models/Qwen--Qwen3-VL-8B-Instruct/snapshots/master",
)
MODEL_ID = os.environ.get("MODEL_ID", "qwen3-vl-8b-instruct")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "6006"))
# 图片像素上限越大细节越多，同时视觉编码阶段的显存和等待时间越高。
MAX_PIXELS = int(os.environ.get("MAX_PIXELS", str(1280 * 1280)))
# 限制单个 Base64 媒体文件解码后的大小，避免大视频耗尽内存和临时磁盘。
MAX_MEDIA_BYTES = int(os.environ.get("MAX_MEDIA_BYTES", str(64 * 1024 * 1024)))
# 单 GPU + Transformers 的稳定默认值；请求会在 GPU 入口排队。
MAX_CONCURRENT = max(1, int(os.environ.get("MAX_CONCURRENT", "1")))
STREAM_TIMEOUT = float(os.environ.get("STREAM_TIMEOUT", "120"))
# 设置后，调用 /v1 接口必须携带 Authorization: Bearer <API_KEY>。
API_KEY = os.environ.get("API_KEY", "")
# 默认只接受客户端上传的 data URL，避免模型服务被当作 SSRF 代理。
ALLOW_REMOTE_MEDIA = os.environ.get("ALLOW_REMOTE_MEDIA", "0") == "1"


# 模型在 FastAPI 启动阶段只加载一次，不能在每个请求中重复加载。
model: Any = None
processor: Any = None
model_device: torch.device | None = None
# 即使 HTTP 服务可并发接收请求，也只允许有限请求进入真正的 GPU 推理。
generation_slots = threading.BoundedSemaphore(MAX_CONCURRENT)


def configure_torch() -> None:
    """启用可选的 CUDA 性能设置，不改变 API 行为。"""
    # Ampere 及更新 NVIDIA 显卡支持 TF32，可加速部分 float32 矩阵运算。
    if torch.cuda.is_available() and os.environ.get("USE_TF32", "1") == "1":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True


@asynccontextmanager
async def lifespan(_: FastAPI):
    """服务启动时加载 Qwen3-VL，退出时释放可回收的 CUDA 缓存。"""
    global model, processor, model_device
    configure_torch()
    model_dir = Path(MODEL_PATH).expanduser()
    if not model_dir.is_dir():
        raise RuntimeError(f"MODEL_PATH 不存在或不是目录: {model_dir}")

    # 自动精度与设备映射能够适配不同显存配置，不应不加判断地强制 fp16。
    model_kwargs: dict[str, Any] = {
        "trust_remote_code": True,
        "device_map": "auto",
        "torch_dtype": "auto",
    }
    # 例如：export ATTN_IMPL=flash_attention_2。只有依赖已安装时才设置。
    if attention_impl := os.environ.get("ATTN_IMPL"):
        model_kwargs["attn_implementation"] = attention_impl

    model = AutoModelForImageTextToText.from_pretrained(str(model_dir), **model_kwargs)
    processor = AutoProcessor.from_pretrained(
        str(model_dir), trust_remote_code=True, max_pixels=MAX_PIXELS
    )
    model.eval()  # 关闭 Dropout 等训练行为。
    # 输入需要位于模型入口设备；device_map=auto 会处理后续跨设备层。
    model_device = next(model.parameters()).device
    yield

    model = processor = model_device = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


app = FastAPI(title="Qwen3-VL OpenAI-compatible API", version="2.0", lifespan=lifespan)


# ============================== 请求结构 ==============================
class ChatMessage(BaseModel):
    """OpenAI 的单条消息；content 可为文本或 content-part 列表。"""

    role: Literal["system", "user", "assistant"]
    content: Any


class ChatCompletionRequest(BaseModel):
    """本服务实现的 /v1/chat/completions 常用参数子集。"""

    model: str = MODEL_ID
    messages: list[ChatMessage] = Field(min_length=1)
    max_tokens: int = Field(default=512, ge=1, le=32768)
    temperature: float = Field(default=0.6, ge=0.0, le=2.0)
    top_p: float = Field(default=0.8, gt=0.0, le=1.0)
    repetition_penalty: float = Field(default=1.1, ge=0.1, le=2.0)
    stream: bool = False


def require_api_key(request: Request) -> None:
    """验证 Bearer Token；API_KEY 留空时不鉴权，便于 SSH 隧道调试。"""
    expected = f"Bearer {API_KEY}"
    provided = request.headers.get("authorization", "")
    if API_KEY and not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ============================ 多模态输入转换 ============================
def cleanup(temp_files: list[str]) -> None:
    """清理本请求创建的临时媒体，文件删除失败不影响响应。"""
    for filename in temp_files:
        try:
            Path(filename).unlink(missing_ok=True)
        except OSError:
            pass


def is_safe_remote_host(hostname: str | None) -> bool:
    """过滤明显的本机/内网地址，降低开启远程媒体时的 SSRF 风险。"""
    if not hostname:
        return False
    normalized = hostname.rstrip(".").lower()
    if normalized in {"localhost", "localhost.localdomain"} or normalized.endswith(".local"):
        return False
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        # 域名仍可能解析到内网地址；默认关闭远程媒体是主要安全边界。
        return True
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
    )


def save_data_url(url: str, expected_kind: str, temp_files: list[str]) -> str:
    """解码 data URL 成临时文件，供 Qwen Processor 从路径读取媒体。"""
    try:
        header, encoded = url.split(",", 1)
        mime = header.split(";", 1)[0].split(":", 1)[1]
        media_kind, extension = mime.split("/", 1)
        if media_kind != expected_kind or not header.endswith(";base64"):
            raise ValueError("Unexpected media MIME type")
        # Base64 通常是原文件的约 4/3，先检查长度减少超大解码分配。
        if len(encoded) > ((MAX_MEDIA_BYTES + 2) // 3) * 4:
            raise HTTPException(status_code=413, detail="Uploaded media exceeds MAX_MEDIA_BYTES")
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_MEDIA_BYTES:
            raise HTTPException(status_code=413, detail="Uploaded media exceeds MAX_MEDIA_BYTES")
        suffix = "." + ("".join(char for char in extension if char.isalnum()) or "bin")
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as file:
            file.write(data)
            temp_files.append(file.name)
            return file.name
    except HTTPException:
        raise
    except (ValueError, IndexError, binascii.Error) as error:
        raise HTTPException(status_code=400, detail=f"Invalid {expected_kind} data URL") from error


def resolve_media(value: Any, kind: str, temp_files: list[str]) -> str:
    """读取 image_url/video_url，并按安全策略解析媒体地址。"""
    url = value.get("url") if isinstance(value, dict) else value
    if not isinstance(url, str) or not url:
        raise HTTPException(status_code=400, detail=f"{kind}_url.url must be a non-empty string")
    if url.startswith("data:"):
        return save_data_url(url, kind, temp_files)
    if not ALLOW_REMOTE_MEDIA:
        raise HTTPException(
            status_code=400,
            detail="Remote media is disabled; send a base64 data URL or set ALLOW_REMOTE_MEDIA=1",
        )
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not is_safe_remote_host(parsed.hostname):
        raise HTTPException(status_code=400, detail=f"Unsafe {kind} URL")
    return url


def convert_messages(messages: list[ChatMessage]) -> tuple[list[dict[str, Any]], list[str]]:
    """将 OpenAI 消息格式转换为 Qwen 的 text/image/video 消息格式。"""
    converted: list[dict[str, Any]] = []
    temp_files: list[str] = []
    try:
        for message in messages:
            if isinstance(message.content, str):
                converted.append({"role": message.role, "content": message.content})
                continue
            if not isinstance(message.content, list):
                raise HTTPException(status_code=400, detail="message.content must be text or a content-part list")
            content: list[dict[str, str]] = []
            for part in message.content:
                if not isinstance(part, dict):
                    raise HTTPException(status_code=400, detail="Each content part must be an object")
                part_type = part.get("type")
                if part_type == "text":
                    text = part.get("text", "")
                    if not isinstance(text, str):
                        raise HTTPException(status_code=400, detail="text content must be a string")
                    content.append({"type": "text", "text": text})
                elif part_type == "image_url":
                    content.append({"type": "image", "image": resolve_media(part.get("image_url"), "image", temp_files)})
                elif part_type == "video_url":
                    # video_url 是为 Qwen-VL 添加的扩展字段，不属于标准 OpenAI Chat 字段。
                    content.append({"type": "video", "video": resolve_media(part.get("video_url"), "video", temp_files)})
                else:
                    raise HTTPException(status_code=400, detail="Only text, image_url, and video_url parts are supported")
            converted.append({"role": message.role, "content": content})
        return converted, temp_files
    except Exception:
        # 如果第二个媒体解析失败，也要清理第一个已经落盘的临时文件。
        cleanup(temp_files)
        raise


def build_inputs(messages: list[dict[str, Any]]):
    """套用 Qwen chat template，并预处理全部图像/视频为模型输入张量。"""
    assert processor is not None and model_device is not None
    prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    if process_vision_info is not None:
        # 官方工具保证视觉张量顺序与占位符一致；新版还可能提供视频处理参数。
        try:
            vision_info = process_vision_info(messages, return_video_kwargs=True)
        except TypeError:
            vision_info = process_vision_info(messages)
        if len(vision_info) == 3:
            images, videos, video_kwargs = vision_info
            video_kwargs = video_kwargs or {}
        else:
            images, videos = vision_info
            video_kwargs = {}
    else:
        images = [
            part["image"] for message in messages
            for part in (message["content"] if isinstance(message["content"], list) else [])
            if part["type"] == "image"
        ]
        videos = [
            part["video"] for message in messages
            for part in (message["content"] if isinstance(message["content"], list) else [])
            if part["type"] == "video"
        ]
        if videos:
            raise HTTPException(status_code=500, detail="Video input requires qwen-vl-utils")
        video_kwargs = {}
    # Processor 负责分词、图片缩放归一化、视频读取抽帧和张量构造。
    return processor(
        text=[prompt], images=images or None, videos=videos or None,
        videos_kwargs=video_kwargs,
        padding=True, return_tensors="pt",
    ).to(model_device)


def generate_options(request: ChatCompletionRequest) -> dict[str, Any]:
    """把 API 采样参数转为 Transformers generate 参数，并启用 KV Cache。"""
    options: dict[str, Any] = {
        "max_new_tokens": request.max_tokens,
        "repetition_penalty": request.repetition_penalty,
        "use_cache": True,
    }
    # 温度为 0 使用贪心解码，不传采样参数以避免 Transformers 警告。
    if request.temperature > 0:
        options.update({"do_sample": True, "temperature": request.temperature, "top_p": request.top_p})
    else:
        options["do_sample"] = False
    return options


def completion_response(request: ChatCompletionRequest, answer: str, prompt_tokens: int, completion_tokens: int) -> dict[str, Any]:
    """构造非流式 OpenAI Chat Completion 响应。"""
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}", "object": "chat.completion", "created": int(time.time()), "model": request.model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "total_tokens": prompt_tokens + completion_tokens},
    }


# =============================== API 路由 ===============================
@app.get("/health")
def health_check():
    """供映射平台或人工确认模型是否已加载完成。"""
    return {"status": "ok" if model is not None else "loading", "model": MODEL_ID}


@app.get("/v1/models", dependencies=[Depends(require_api_key)])
def list_models():
    """让 OpenAI SDK 或 VS Code 插件发现模型 ID。"""
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "created": 0, "owned_by": "local"}]}


def sse(payload: dict[str, Any]) -> bytes:
    """将 JSON 包装成 Server-Sent Events 数据块。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def stream_response(request: ChatCompletionRequest, messages: list[dict[str, Any]], temp_files: list[str]):
    """后台线程执行阻塞式 generate，前台生成器持续发送 OpenAI SSE 块。"""
    assert model is not None and processor is not None
    completion_id = f"chatcmpl-{uuid.uuid4().hex}"
    worker_errors: list[Exception] = []
    acquired = False
    worker_started = False
    try:
        generation_slots.acquire()
        acquired = True
        inputs = build_inputs(messages)
        streamer = TextIteratorStreamer(
            processor.tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=STREAM_TIMEOUT
        )

        def worker() -> None:
            try:
                with torch.inference_mode():
                    model.generate(**inputs, streamer=streamer, **generate_options(request))
            except Exception as error:
                # 后台线程异常不能自动到达 HTTP 响应，必须显式记录。
                worker_errors.append(error)
                try:
                    streamer.end()
                except Exception:
                    pass
            finally:
                # 必须等待 generate() 结束后再释放单卡推理槽位。
                generation_slots.release()
                cleanup(temp_files)

        threading.Thread(target=worker, daemon=True).start()
        worker_started = True
        acquired = False
        yield sse({"id": completion_id, "object": "chat.completion.chunk", "created": int(time.time()), "model": request.model, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]})
        try:
            for text in streamer:
                if text:
                    yield sse({"id": completion_id, "object": "chat.completion.chunk", "created": int(time.time()), "model": request.model, "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}]})
        except queue.Empty as error:
            raise RuntimeError(f"No token received within {STREAM_TIMEOUT} seconds") from (worker_errors[0] if worker_errors else error)
        if worker_errors:
            raise RuntimeError("Model generation failed") from worker_errors[0]
        yield sse({"id": completion_id, "object": "chat.completion.chunk", "created": int(time.time()), "model": request.model, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
        yield b"data: [DONE]\n\n"
    finally:
        # 后台线程启动前发生异常时，仍由当前生成器负责回收资源。
        if acquired:
            generation_slots.release()
        if not worker_started:
            cleanup(temp_files)


@app.post("/v1/chat/completions", dependencies=[Depends(require_api_key)])
def chat_completions(request: ChatCompletionRequest):
    """执行图文/视频问答；stream=true 返回 SSE，否则返回完整 JSON。"""
    if model is None or processor is None or model_device is None:
        raise HTTPException(status_code=503, detail="Model is still loading")
    if request.model not in {MODEL_ID, ""}:
        raise HTTPException(status_code=404, detail=f"Model not found: {request.model}")
    messages, temp_files = convert_messages(request.messages)
    if request.stream:
        return StreamingResponse(
            stream_response(request, messages, temp_files),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    acquired = False
    try:
        generation_slots.acquire()
        acquired = True
        inputs = build_inputs(messages)
        with torch.inference_mode():
            output_ids = model.generate(**inputs, **generate_options(request))
        # generate 返回“输入 token + 输出 token”，这里只解码新生成的部分。
        generated_ids = output_ids[:, inputs.input_ids.shape[1]:]
        answer = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        return JSONResponse(content=completion_response(
            request, answer, int(inputs.input_ids.shape[1]), int(generated_ids.shape[1])
        ))
    except torch.cuda.OutOfMemoryError as error:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=507, detail="GPU out of memory; reduce MAX_PIXELS, media size, or max_tokens") from error
    finally:
        if acquired:
            generation_slots.release()
        cleanup(temp_files)


if __name__ == "__main__":
    # worker 必须为 1；多个 Uvicorn worker 会各自加载完整模型，单卡通常会 OOM。
    uvicorn.run(app, host=HOST, port=PORT, workers=1)
