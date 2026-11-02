# AI 简历处理工具

基于 Next.js Pages Router、React、NextAuth 和 Prisma/PostgreSQL 的简历分析应用。首页公开；工作台、设置、报告和历史需要应用账户登录。

## 当前功能

- 邮箱密码注册和登录，中英文界面。
- 浏览器解析 TXT、PDF、DOCX 和图片，支持本地 OCR；用户确认文本后再提交。附件不持久化。
- 个人 AI 临时配置和显式连接测试；用户主动分析后生成结构化报告，可编辑 Markdown。
- 用户主动保存报告，保存确认后的简历文本、求职信息及报告内容；按账户隔离，首次保存后固定保留 14 天，编辑不续期。
- 历史分页、详情恢复、标题和 Markdown 修改、删除；不提供报告导出。
- 每账户一份 AES-256-GCM 加密的个人 AI 配置。需要独立主密钥及 AiConfig 数据库迁移；缺少前置条件时账户保存不可用，临时配置仍可使用。

个人 AI 的临时配置仅保留在当前标签页应用内存，刷新、关闭标签或退出登录后需要重新输入。上游仅支持经 DNS 校验的公开 HTTPS 默认端口。官方 AI 在普通运行和 Vercel 部署中默认关闭，本发布副本不包含本机受控验收入口。

## 运行环境与本地命令

- Node.js `>=24 <25`，npm `>=11 <12`
- Next.js `14.2.35`，React `18.3.1`，Tailwind CSS `3.4.17`
- Prisma `5.22.0`，PostgreSQL

在项目子目录执行：

```bash
npm ci --include=dev
npx prisma generate
npm run dev
```

开发服务默认监听 `http://127.0.0.1:3010`，开发缓存为 `.next-local/`；不要混用 localhost 的 Cookie 和来源。普通启动关闭官方 AI 门禁。复制 `.env.example` 为本机被忽略的 `.env.local`，仅在本机填写自己的配置；Prisma CLI 不会自动读取 Next.js 的 `.env.local`，生成客户端时需由终端提供 schema 引用的环境变量。

```bash
npm test -- --run
npm run lint
npm run build
```

本副本保留 34 个适用离线测试文件及 Vitest 配置，排除了绑定私人数据库目标的本机验收测试。测试使用合成数据和 mock，不代表真实数据库、provider 或 Vercel 验收通过。最终副本的验证进度见 [发布检查记录](docs/release-checklist.md)。

自托管生产运行使用 `npm run build`、`npm start`；通过 `NEXTAUTH_URL` 配置正式 origin，`PORT` 和 `APP_HOST` 仅控制内部监听。Vercel 使用自身的 Next.js 运行方式，无需配置 `PORT=3010` 或执行 `npm start`。

## GitHub 与 Vercel

仓库：`https://github.com/FreeInBlind/Internship-project`，应用子目录：`项目三：AI简历处理工具`。

完整导入、公开访问、环境变量与数据库准备步骤见 [Vercel 部署说明](docs/vercel-deployment.md)。Root Directory 选择本应用子目录，Node.js 选择 24.x；`vercel.json` 配置安装 `npm ci --include=dev`，构建 `prisma generate && next build`。

数据库运行连接、认证密钥和正式 HTTPS origin 必须通过环境变量配置。个人 AI 账户保存还需要独立的 `CUSTOM_AI_ENCRYPTION_KEY`。仓库不包含真实环境文件或密钥。

Prisma Client 生成不应用迁移。正式 migrations 与 PostgreSQL provider 锁文件一并保留，但本次准备没有执行生产迁移、seed、reset、db push 或真实数据库测试。

## 已知限制与待验证事项

- 个人 AI 请求去重和同账号并发锁位于单 Node.js 进程内，不能保证 Vercel 多实例间的全局幂等或互斥。
- 测试和分析 API 设置 `maxDuration: 60`，需确认 Vercel 套餐支持。
- OCR/PDF/DOCX 静态入口资源已纳入副本，真实浏览器对各格式及运行时资源加载仍需上线验证。
- 生产数据库迁移、账户加密保存、真实 provider、完整登录和报告 CRUD 尚未在本次发布环境验收。
- 2026-11-02 发布副本独立安装、Prisma validate/generate、34 个文件共 887 项测试、lint 和生产构建已通过；lint 保留 `CustomAiProvider.jsx` 的三条 React Hooks 警告。本机 HTTP 冒烟检查尚未执行，原因和验证范围见 [发布检查记录](docs/release-checklist.md)。
- 同日完整与生产依赖 `npm audit` 均退出 1：发现四个漏洞依赖条目（Next.js、NextAuth、PostCSS、uuid），共 2 critical、1 high、1 moderate。这是依赖条目统计，不是 CVE 数；公告适用条件和修复版本尚未独立核实，本次未升级依赖。正式公开上线前需处理受影响版本并回归，不绕过平台安全检查；GitHub 文件上传不等于已具备上线条件。
