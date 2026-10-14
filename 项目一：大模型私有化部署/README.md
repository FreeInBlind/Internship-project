# Qwen3-VL 私有化多模态推理服务

基于 **Qwen3-VL-8B-Instruct** 的单卡私有化部署项目。项目将本地视觉语言模型封装为两种可使用形态：

- 面向业务体验的 Gradio Web UI：支持文本、多图和视频问答、多轮上下文与流式输出。
- 面向应用集成的 FastAPI 服务：提供 OpenAI Chat Completions 风格接口与 SSE 流式响应。

项目针对 AutoDL 单 GPU 环境设计，重点处理多模态消息转换、视觉预处理、显存约束、接口兼容、安全边界与可配置部署。

> 模型权重不包含在本仓库中。请从官方或已获授权的渠道获取模型，并遵循模型许可证。

## 招聘者速览

- **问题**：解决纯文本大模型部署流程无法处理图像与视频的问题，构建可用的 Qwen3-VL 多模态理解服务。
- **实现**：基于 Transformers 和 PyTorch 完成模型加载、视觉输入预处理、流式生成和多轮上下文管理。
- **工程化**：提供 Gradio 交互端、FastAPI 服务端、OpenAI SDK 调用样例、健康检查、鉴权、资源限制及部署配置。
- **边界意识**：针对单卡并发 OOM、媒体临时文件、远程媒体 SSRF、模型权重与密钥泄露设置了约束。

## 项目亮点

- 使用 `AutoModelForImageTextToText`、`AutoProcessor` 和 Qwen 官方 `qwen-vl-utils` 打通图像/视频理解链路。
- 支持文本、图片、视频和多轮对话；视频由视觉工具读取并按模型要求抽帧。
- 使用 `TextIteratorStreamer`、后台生成线程和 SSE 实现端到端流式输出。
- 将 Qwen3-VL 请求与响应转换为 OpenAI Chat Completions 常用格式，便于 Python SDK 或上层业务接入。
- 通过环境变量管理模型路径、端口、采样参数、显存限制与鉴权；单卡默认串行推理以规避并发 OOM。
- 对 Base64 媒体大小、临时文件回收、API Key 和远程媒体访问设置基础安全控制。

## 架构

~~~text
浏览器 / Python 客户端
        |
        +-- Gradio Web UI (chat_robot_multimodal.py)
        |       |
        |       +-- Qwen3-VL + AutoProcessor + qwen-vl-utils
        |
        +-- OpenAI-compatible API (openai_server.py -> qw_server.py)
                |
                +-- /health
                +-- /v1/models
                +-- /v1/chat/completions  (JSON / SSE)
~~~

Web UI 和 API 默认都使用 `6006` 端口，同一台机器一次只启动其中一个。若需要同时运行，请通过 `GRADIO_PORT` 或 `PORT` 修改其中一方端口。

## 功能范围

- 文本、多图、视频问答与多轮对话。
- Web UI 与 API 流式回答。
- OpenAI SDK 风格的 `/v1/models` 与 `/v1/chat/completions`。
- `stream=true` 的 Server-Sent Events（SSE）响应。
- 标准 `image_url` 输入；`video_url` 是本项目为 Qwen3-VL 增加的扩展字段。
- Base64 data URL 媒体上传、媒体大小限制与临时文件回收。
- 可选 Bearer Token 鉴权、健康检查和 GPU OOM 错误提示。

## 目录说明

~~~text
.
|-- chat_robot_multimodal.py  # Gradio 图文/视频聊天界面
|-- qw_server.py              # FastAPI + OpenAI 兼容 API 实现
|-- openai_server.py          # API 服务启动入口
|-- cli.py                    # OpenAI SDK 命令行调用示例
|-- requirements.txt          # Python 依赖
|-- .env.example              # 环境变量示例，不含真实密钥
`-- .gitignore                # 忽略模型、虚拟环境、密钥和本地 IDE 文件
~~~

## 环境要求

- Linux + NVIDIA GPU，推荐 AutoDL 或其他 CUDA 环境。
- Python 3.10+。
- 与 CUDA 驱动匹配的 PyTorch。
- 已下载到本机磁盘的 Qwen3-VL 模型目录。
- 视频问答需要 `qwen-vl-utils` 和可用的视频解码后端。

先按 [PyTorch 官网](https://pytorch.org/get-started/locally/) 为 CUDA 版本安装 PyTorch，再安装其余依赖：

~~~bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_REPOSITORY_DIRECTORY>
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
~~~

> 如果 AutoDL 镜像已自带可用的 PyTorch 和 CUDA，不应无条件覆盖它；只需安装缺失的 Python 包即可。

## 配置

从模板开始配置：

~~~bash
cp .env.example .env
~~~

程序不会自动加载 `.env`。部署时请将必要值导出为环境变量，或通过进程管理工具注入：

~~~bash
export MODEL_PATH=/root/autodl-tmp/models/models/Qwen--Qwen3-VL-8B-Instruct/snapshots/master
export MODEL_ID=qwen3-vl-8b-instruct
export MAX_PIXELS=1638400
export MAX_CONCURRENT=1
export API_KEY=replace-with-a-long-random-secret
~~~

如果希望直接加载 `.env`，可在启动前执行 `set -a; source .env; set +a`，或使用你自己的进程管理工具注入这些变量。

关键变量：

- `MODEL_PATH`：模型目录，必须包含模型配置和权重文件。
- `MAX_PIXELS`：图片最大像素数。分辨率越高，视觉细节与显存开销都会增加。
- `MAX_MEDIA_BYTES`：单个 Base64 媒体文件解码后的最大字节数，默认 64 MiB。
- `MAX_CONCURRENT`：允许进入 GPU 推理的最大请求数。单卡 Transformers 推理建议保持 `1`。
- `API_KEY`：设置后，访问 `/v1/*` 必须携带 `Authorization: Bearer <API_KEY>`。
- `ALLOW_REMOTE_MEDIA`：默认 `0`，仅接受 data URL，避免服务被用作远程资源访问代理。
- `ATTN_IMPL`：仅在已正确安装 Flash Attention 时设置为 `flash_attention_2`。

## 启动 Web UI

~~~bash
export MODEL_PATH=/path/to/Qwen3-VL-8B-Instruct
python chat_robot_multimodal.py
~~~

脚本保留 `server_name="127.0.0.1"`，适合通过 AutoDL 网页端口映射访问。默认端口为 `6006`；如端口已被 API 服务占用：

~~~bash
export GRADIO_PORT=7860
python chat_robot_multimodal.py
~~~

Web UI 默认不会创建 Gradio 公共分享链接。确有需要时设置 `GRADIO_SHARE=1`；在公网环境中应优先使用 AutoDL 映射、访问控制或反向代理鉴权。

## 启动 OpenAI 兼容 API

~~~bash
export MODEL_PATH=/path/to/Qwen3-VL-8B-Instruct
export API_KEY=replace-with-a-long-random-secret
python openai_server.py
~~~

服务启动完成后检查：

~~~bash
curl http://127.0.0.1:6006/health
curl -H "Authorization: Bearer $API_KEY" http://127.0.0.1:6006/v1/models
~~~

在 AutoDL 设置端口映射后，若映射地址是 `https://example.com`，客户端通常应配置为 `https://example.com/v1`。若平台已在映射地址中包含 `/v1`，请不要重复添加。

## 调用示例

文本调用：

~~~bash
python cli.py --base-url https://example.com/v1 --api-key replace-with-your-key --question "用三点说明 Python 和 C++ 的主要区别。"
~~~

图片问答：

~~~bash
python cli.py --base-url https://example.com/v1 --api-key replace-with-your-key --image ./assets/example.jpg --question "提取图片中的关键信息并总结。" --stream
~~~

视频问答：

~~~bash
python cli.py --base-url https://example.com/v1 --api-key replace-with-your-key --video ./assets/example.mp4 --question "概括视频中的主要事件。"
~~~

`cli.py` 会将本地媒体编码为 data URL，服务端无需访问客户端文件系统。`video_url` 是为 Qwen3-VL 视频能力增加的非标准扩展字段，并非所有 OpenAI 兼容服务都支持。

## 测试

不加载模型权重的单元测试覆盖 CLI 内容构造、Base64 媒体临时文件回收与远程地址安全判断：

~~~bash
python -m unittest discover -s tests -v
~~~

模型实际加载、CUDA 显存表现与视频解码需要在目标 AutoDL 环境完成验证。

## API 请求格式

标准图片输入示例：

~~~json
{
  "model": "qwen3-vl-8b-instruct",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "image_url", "image_url": {"url": "[image omitted]"}},
        {"type": "text", "text": "描述图片内容"}
      ]
    }
  ],
  "stream": true
}
~~~

视频输入将 `image_url` 替换为 `video_url`，其结构相同。服务支持 `max_tokens`、`temperature`、`top_p`、`repetition_penalty` 和 `stream` 参数。

## 性能与限制

- 本项目直接使用 Transformers `model.generate()`，目标是单卡部署和接口封装，不是高并发推理引擎。
- 默认 `MAX_CONCURRENT=1` 会将 GPU 请求排队，避免多个生成任务同时占用 KV Cache 导致显存溢出。
- 长视频、高分辨率图片和较大的 `max_tokens` 都会提高显存占用和响应时延。OOM 时优先降低 `MAX_PIXELS`、媒体大小或生成长度。
- 如需连续批处理、高吞吐或多用户生产部署，应评估与模型和 CUDA 版本兼容的专用推理框架、鉴权、限流、观测和反向代理方案。

## 说明

本仓库用于存储应聘作品、作品展示与技术交流。使用 Qwen3-VL 模型时请遵守其官方模型许可证及所在平台的服务条款。
