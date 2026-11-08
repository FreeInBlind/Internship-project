# 星笺 Starfolio

带云端阅读进度、语义找书和可追溯引用问答的科幻阅读项目。首版使用 Next.js、TypeScript、Tailwind、Better Auth、Drizzle/Neon、Cohere、Pinecone 与 DeepSeek。

## 本地运行

新环境先安装 Bun，再安装依赖并配置环境变量：

```sh
bun install --frozen-lockfile
copy .env.example .env.local
```

填写 `.env.local` 后运行：

```sh
bun run dev
```

默认使用 `http://127.0.0.1:3000`。`BETTER_AUTH_URL` 必须与实际访问的 origin 完全一致；不要混用 `localhost` 和 `127.0.0.1`。

应用依赖已准备好的 Neon 数据库和 Pinecone 向量索引。首次部署前，请确认目标 Neon 数据库已应用仓库内的 Drizzle 迁移；迁移只能在确认目标数据库后单独运行：

```sh
bun run db:migrate
```

不要在网页请求中执行迁移，也不要把原始 PDF、正文导入文件、向量缓存或服务收据放入 Git 仓库。

## Vercel 部署

Vercel 项目使用 Next.js 默认构建配置和 Node.js functions，不设置静态导出。所有服务凭据都配置在 Vercel 的服务端环境变量中，不使用 `NEXT_PUBLIC_` 前缀：

- `DATABASE_URL`：目标 Neon PostgreSQL 连接串。
- `BETTER_AUTH_URL`：实际部署域名的 origin。
- `BETTER_AUTH_SECRET`：独立随机值，至少 32 个字符；不要复用本地值或提交到 Git。
- `DEEPSEEK_API_KEY`、`COHERE_TRIAL_API_KEY`、`COHERE_API_KEY`。
- `PINECONE_API_KEY`、`PINECONE_INDEX_HOST`、`PINECONE_INDEX_NAME`。

Production 和 Preview 环境应分别配置变量。默认域名确定后，先更新 `BETTER_AUTH_URL` 再重新部署。部署后重点检查注册、登录、退出、Cookie/Origin、公开阅读、进度和书签隔离、语义找书以及问答引用与阅读范围。

当前问答、找书和写入限流保存在进程内存，适合单实例演示；多实例部署前需要改为共享限流存储，或接受重启后计数重置。Vercel 函数执行时限和上游模型调用时限也应按所选计划单独核实。

## 演示流程

1. 注册或登录，查看书库和云端续读记录。
2. 打开作品并阅读，等待进度保存后返回书库继续阅读。
3. 使用语义找书查看匹配作品和来源页码。
4. 在阅读器打开 AI 讨论，选择当前位置之前、已读范围或当前刊载部分的全部已收录内容。
5. 查看带页码定位的引用；证据不足时，服务应明确返回无答案。

## 验证

```sh
bun run typecheck
bun run build
```

## 当前边界

- 生成固定使用 DeepSeek 官方 `deepseek-flash`。
- Embedding 使用 Cohere `embed-multilingual-v3.0`（1024 维），可选重排使用 `rerank-v3.5`。
- 只检索当前版本的合格正文，并在召回、重排和上下文拼接阶段校验作品与阅读范围。
- 游客进度与云端进度分开，不自动合并；当前与最远已读位置独立。
- 当前结果是有限样本验证，不承诺所有问题都可回答或所有边界都已覆盖。
- 公开部署前仍需确认内容授权、服务费用/限额、域名和多实例限流方案。
