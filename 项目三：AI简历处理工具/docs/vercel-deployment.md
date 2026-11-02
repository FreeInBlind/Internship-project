# GitHub 与 Vercel 部署说明

目标仓库：`https://github.com/FreeInBlind/Internship-project`。
目标应用目录：`项目三：AI简历处理工具`（全角冒号 `：`）。

本文件说明部署设置，不代表 GitHub 推送、Vercel 部署或生产数据库迁移已完成。发布副本的验证范围与阻塞见 [发布检查记录](release-checklist.md)。2026-11-02 的本机测试和构建已通过，但完整/生产依赖安全审计均未通过（四个漏洞依赖条目）；正式公开部署前需核实并处理受影响版本，不能将以下配置步骤视为已具备上线条件。

## 1. 公开访问范围

首页 `/` 已公开，访客不需要应用账户即可查看介绍。工作台、设置、历史与报告属于用户私有功能，仍要求应用邮箱密码登录；不能为公开首页而删除这些页面和 API 的认证或 owner 校验。

Vercel 登录墙与本项目的应用登录是两个独立机制。对外分享 Production Domains 中的正式域名，例如 `https://你的项目名.vercel.app`，不要将受保护的 Preview 或某次 deployment 专属 URL 当作正式入口。

在 Vercel 项目 Settings → Deployment Protection 中检查 Vercel Authentication：选择不保护生产域名的 Standard Protection，或关闭 Vercel Authentication。确保没有其他 Password Protection/Trusted IP 限制作用于正式域名。部署后用无痕窗口、不登录 Vercel 访问 `/` 验证；访问 `/history` 跳到本项目的登录页属于预期行为。

## 2. 导入 GitHub 子目录

1. 使用自己的 GitHub 账号登录 Vercel，选择 Add New → Project。
2. 导入 `FreeInBlind/Internship-project`，按需授权 Vercel GitHub App 访问该仓库。
3. Framework Preset 选 **Next.js**，Root Directory 必须选 **`项目三：AI简历处理工具`**，不是仓库根目录。
4. 项目名用英文短横线，例如 `ai-resume-workspace`；仓库子目录保留中文名。
5. Node.js 选 **24.x**，与 `package.json` 的 `>=24 <25` 一致。
6. 项目目录内 `vercel.json` 已提供安装与构建命令：安装 `npm ci --include=dev`，构建 `prisma generate && next build`。Prisma CLI 当前是 devDependency，需要安装开发依赖。Output Directory 保持 Next.js 默认自动识别，无需改为 `out`，也不使用静态导出。
7. Vercel 负责运行 Next.js 服务/API，不执行本机 `npm run dev` 或 `npm start`，也不配置监听端口 3010。
8. 个人 AI 测试和分析路由已设置 `maxDuration: 60` 秒；这是为 45 秒上游超时和 DNS 等待留出响应余量，仍须确认所选 Vercel 计划允许该时限。超出平台上限时，按实际套餐调整配置并重新验证。
9. 配置下述 Production 环境变量，再进行正式部署。修改环境变量后需要重新部署才能应用。

构建包含 `prisma generate`，避免 Vercel 缓存依赖导致客户端仍使用旧 schema；生成客户端不会应用数据库迁移。构建命令不包含自动迁移、seed 或数据库重置。

## 3. 环境变量（真实值只填 Vercel 的服务端环境变量）

| 名称 | 用途与设置 |
| --- | --- |
| `DATABASE_URL` | Neon/PostgreSQL 应用运行时池化连接 URL，使用供应商提供的 TLS 参数。建议 Vercel Functions 区域靠近数据库。不要把真实 URL 写入 GitHub。 |
| `DATABASE_URL_UNPOOLED` | 与池化连接对应同一数据库的直连 URL；Prisma schema 引用它。生产迁移使用直连，不把池化 URL 当迁移连接。 |
| `NEXTAUTH_SECRET` | 独立高熵随机认证密钥；生成后稳定保管。变更会使现有会话失效。 |
| `NEXTAUTH_URL` | 完整正式 HTTPS origin，例如 `https://ai-resume-workspace.vercel.app`；不得填 localhost、3010、路径或 Preview 随机 URL。注册和写操作校验精确同源。 |
| `CUSTOM_AI_ENCRYPTION_KEY` | 需要账户加密保存个人 AI 时配置：独立随机 32 字节的标准 Base64，44 字符、恰有一个末尾 `=`。不能复用认证密钥或 AI API key；不能以 `NEXT_PUBLIC_` 开头。缺失时加密保存按钮不可用，临时配置仍可用。 |
| `CRON_SECRET` | 只有准备启用过期记录物理清理时才配置独立高熵值；现有清理 API 需精确 Bearer 认证。本轮不自动创建调度。 |
| `TRUST_PROXY` | 默认不设置；只有确认所用代理覆盖且可信地提供来源 IP 时才设 `1`，用于认证限流。 |

官方 AI 的本机受控门禁不能复制到 Vercel。`STAGE4A_ACCEPTANCE`、`NEXT_PUBLIC_STAGE4A_ACCEPTANCE`、`GROQ_UPSTREAM_ENABLED`、`GROQ_QUOTA_MIGRATION_ENABLED` 保持未设置或 `false`；不要上传本机 budget marker 或设置 `STAGE4A_BUDGET_FILE`。当前官方服务有本机 origin 限制，在公网部署不会自动开放。个人 AI 的临时/账户模式与该门禁独立。

生成密钥应在自己的安全终端/密钥管理工具中完成，直接填入 Vercel；不要在聊天、提交记录、截图或日志中粘贴值。账户加密密钥后续需稳定保存，随意更换会导致已有配置无法解密。

## 4. 数据库准备

公开首页构建成功不等于登录、报告或配置存储已经可用。真实功能依赖数据库结构与运行时 Prisma Client 一致。

- 新空库：由有权限的维护者审查仓库内所有正式 Prisma migrations，备份/确认目标后再按受控生产流程应用。
- 已有库：先核对当前表和 `_prisma_migrations` 状态；不要直接重新执行建表 SQL，也不要为了消除错误使用 reset、db push 或盲目 baseline。
- 个人 AI 配置需要 `20261102000000_add_ai_config` 的 `AiConfig` 表和正确的主密钥。只有填写个人 AI 的地址、key、模型不足以启用账户加密保存。
- 报告使用已有 `SavedReport` 表，首存固定保留 14 天，修改不续期。API 会拒绝过期记录；物理删除还需要单独配置清理调度。
- 本轮上传与部署准备不自动执行生产迁移、建库、数据清理或真实 provider 测试。

`prisma generate` 只生成客户端，不创建任何表，也不证明数据库迁移完成。不要将迁移操作放入每次 Git push 自动执行的构建流程。

## 5. 运行时限制与上线验收

个人 AI 请求的 `requestId` 去重和同账号并发锁位于单个 Node.js 进程内。Vercel 多实例、实例重启或扩缩容时不能提供跨实例的全局 exactly-once 或全局互斥保证；不要将当前内存集合当作持久队列或计费幂等层。若生产环境需要跨实例保证，应另行设计数据库/KV 原子状态。

1. 查看 Build Logs，确认安装、Prisma Client 生成、Next.js 编译完成。若平台因依赖版本安全策略拒绝构建，按实际错误升级受影响版本并回归测试，不设置绕过安全检查的变量。
2. 在未登录 Vercel 的无痕窗口访问正式域名 `/`，确认首页可见、格式限制及本地 OCR 资源可加载。
3. 访问 `/history` 应跳转到应用登录页，而不是 Vercel 登录页。
4. 数据库准备完成后用自己的测试账号和虚构材料检查注册/登录、文本确认、主动保存/历史恢复/修改/删除。不要以示例或 mock 测试替代真实持久化验收。
5. 个人 AI 账户保存：确认可点击、保存后仅显示固定掩码，刷新能恢复；不需要为了验证配置保存而点击可能收费的“测试连接”或分析。
6. 核对报告首次保存和到期时间，编辑不延长有效期。清理调度启用前独立审查 `CRON_SECRET` 与删除范围。

## 6. 上传文件筛选原则

保留：Next.js 应用源码、Prisma schema 与正式 migrations、依赖清单/锁文件、Tailwind/ESLint/Vitest 配置、需要的浏览器本地 PDF/DOCX/OCR 资源、脱敏说明和适用离线测试。

排除：所有真实 `.env*`（仅允许空值 `.env.example`）、node_modules、`.next*`、`.offline-resume-*`、`.stage4a-*` 运行目录、预算 marker、API事件/构建日志、本机工具配置、`.vercel` 与上传用仓库副本。含硬编码私人数据库目标的本机验收脚本及绑定该目标的测试不属于公网部署所需内容，不应原样发布。原项目本机验收记录留在本地。

## 官方参考

- https://vercel.com/docs/monorepos
- https://vercel.com/docs/builds/configure-a-build
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- https://vercel.com/docs/deployment-protection
- https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel
