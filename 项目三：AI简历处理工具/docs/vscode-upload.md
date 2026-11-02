# 使用 VS Code 上传到现有 GitHub 仓库

整理日期：2026-11-02。

目标仓库：https://github.com/FreeInBlind/Internship-project

本机整理目录：`D:\CodeHouse\项目三：AI简历处理工具`

远端目标目录：仓库根目录下的 `项目三：AI简历处理工具`（全角冒号 `：`）。

本目录是已经筛选的应用源码包，不包含 `.git`，尚未提交或推送。原有 130 个发布文件复制自经过检查的发布副本，本说明是新增的第 131 个文件。

## 1. 目录关系

上传后的 GitHub 结构应为：

```text
Internship-project/
├── 项目一：大模型私有化部署/
├── 项目二：EcoPoints 可持续行为积分平台与多端数据分析系统/
└── 项目三：AI简历处理工具/
    ├── .env.example
    ├── .eslintrc.json
    ├── .gitignore
    ├── README.md
    ├── package.json
    ├── package-lock.json
    ├── vercel.json
    ├── components/
    ├── docs/
    ├── lib/
    ├── pages/
    ├── prisma/
    ├── public/
    ├── scripts/
    ├── styles/
    ├── test/
    └── tests/
```

图中省略部分构建和测试配置文件，复制时保留整个文件夹，包括点开头的文件。

VS Code 应打开包含 `.git` 和三个项目目录的 `Internship-project` 仓库根目录。不要在独立的项目三源码包中选择“初始化仓库”或“发布到 GitHub”，也不要把项目三文件夹里的内容直接铺到远端仓库根目录。

## 2. 在 VS Code 获取现有仓库

推荐单独克隆一份，避免和之前用于筛选、安装、构建的目录混用。

1. 在 Windows 文件资源管理器创建 `D:\CodeHouse\GitHubUpload`，用于存放克隆仓库。
2. 打开 VS Code，按 `Ctrl+Shift+P`，执行 **Git: Clone / Git: 克隆**。
3. 输入 `https://github.com/FreeInBlind/Internship-project.git`。
4. 选择 `D:\CodeHouse\GitHubUpload` 作为父目录。正常情况下，VS Code 创建 `D:\CodeHouse\GitHubUpload\Internship-project`。
5. 如出现 GitHub 登录提示，通过 VS Code/浏览器完成账户授权，确认所用账号有仓库写入权限。
6. 克隆完成后选择“打开”，查看资源管理器，应看到仓库已有的项目一和项目二。
7. 打开“源代码管理”（`Ctrl+Shift+G`），应没有你尚未处理的本地修改。左下角确认当前分支，原准备副本的分支是 `main`；新克隆仍以实际显示的默认分支为准。

若上述位置已存在一份仓库，先确认远端和本地变更；不要覆盖已有仓库。可以改用另一个空的父目录重新克隆。

若你已经有最新且干净的同一仓库，也可以直接在 VS Code 打开该仓库，使用源代码管理菜单的“拉取 / Pull”取得最新内容，再进行下一步。

## 3. 复制项目三目录

1. 保持 VS Code 打开仓库根目录。
2. 在文件资源管理器中复制整个 `D:\CodeHouse\项目三：AI简历处理工具` 文件夹。
3. 将其粘贴到新克隆的仓库根目录：`D:\CodeHouse\GitHubUpload\Internship-project`。
4. 最终 `package.json` 应在：

   `D:\CodeHouse\GitHubUpload\Internship-project\项目三：AI简历处理工具\package.json`

5. 不应出现 `项目三：AI简历处理工具\项目三：AI简历处理工具\package.json` 的重复嵌套。
6. 如果最新远端已经有同名“项目三”目录，先比较已有文件和本次源码包，再决定合并，不能直接覆盖远端更新。

仅上传源码不需要运行 `npm install`、启动项目或配置真实环境变量。浏览器 PDF/DOCX/OCR 资源在 `public/vendor` 内，是应用需要的本地资源，应一并上传。

## 4. 暂存前检查

在“源代码管理”的“更改”列表中：

- 所有新文件都应位于 `项目三：AI简历处理工具/` 下；项目一、项目二不应有修改或删除。
- 整理时共 131 个文件：原发布文件 130 个，加本说明一个；VS Code 可能按文件夹折叠显示。
- 应有 `package-lock.json`、`.gitignore`、`.env.example`、正式 Prisma schema 和四份 migration SQL。
- `.env.example` 只保留空配置和本机示例，不要填写真实数据库 URL、认证密钥或 provider key。
- 不应有 `.env.local`、其他真实 `.env*`、`node_modules`、`.next`、`.next-local`、`.vercel`、日志、marker、`.github-upload` 或本机验收工具。
- 不要把其他目录的真实环境文件或密钥复制过来。

本源码包已排除上述运行产物；如果你复制后又本地安装、构建，保留现有 `.gitignore`，不要强制添加被忽略的目录。

## 5. 在 VS Code 提交并推送

如果你有 `main` 的直接写入权限，且仓库允许直接提交：

1. 在“更改”列表中检查项目三的文件。
2. 将项目三文件夹的更改暂存。若工作区只有项目三更改，可以使用“暂存所有更改”；若混有其他修改，只暂存项目三。
3. 查看“暂存的更改”，再次确认没有项目一、项目二的变更，没有真实凭据文件。
4. 输入提交说明，例如：`feat: add AI resume processing tool`。
5. 点击“提交 / Commit”。提交只写入本机 Git，不会自动上传，除非启用了额外的自动同步行为。
6. 使用源代码管理菜单中的“推送 / Push”，或“同步更改 / Sync Changes”。同步会包含拉取和推送，以 VS Code 提示为准。
7. 等待完成；若弹出 GitHub 登录，使用有写入权限的账号授权。

首次提交如果提示未设置 Git 用户信息，可在 VS Code 集成终端设置仓库内身份：

```bash
git config user.name "你的GitHub显示名"
git config user.email "你的GitHub提交邮箱或GitHub noreply邮箱"
```

不需要把 GitHub 密码、访问令牌写进提交、源码或远端 URL。

若仓库启用分支保护：

1. 在提交前点击左下角分支名，创建分支，例如 `upload/ai-resume-tool`。
2. 在该分支暂存并提交项目三。
3. 点击“发布分支 / Publish Branch”或推送当前分支，确认远端为现有仓库的 `origin`。
4. 在 GitHub 创建 Pull Request，目标分支选仓库默认分支，检查仅新增项目三目录，再按仓库流程合并。
5. Vercel 如跟踪 `main`，应在合并到 `main` 后使用正式生产部署。

本轮只是准备文件和操作说明，没有替你创建提交或推送。

## 6. 推送失败时如何处理

- **没有权限 / 403**：确认浏览器和 Git 凭据对应的账号对 `FreeInBlind/Internship-project` 有写入权限。
- **分支受保护**：使用新分支和 Pull Request，不强行推送默认分支。
- **远端有新提交 / rejected / non-fast-forward**：先保存并提交自己的项目三变更，使用 VS Code 拉取远端；若发生冲突，在合并编辑器逐个核对后提交，再正常推送。不要选择 force push。
- **仓库不对**：在 VS Code 终端执行 `git remote -v`，核对为上述 GitHub 地址；不要把凭据嵌入 URL。
- **上传列表多出几万文件**：先停止提交，检查 node_modules、缓存是否被加入，确认 `.gitignore` 存在。不要绕过忽略规则批量强制暂存。
- **提示大文件**：整理时最大文件约 4.48 MiB，没有超过 100 MiB 的文件。若出现大文件，检查是否混入新的依赖、构建产物或附件。

## 7. 在 GitHub 验证结果

打开 https://github.com/FreeInBlind/Internship-project ，切换到实际推送或合并的分支，确认：

1. 项目一、项目二仍在，内容未被项目三覆盖。
2. 根目录出现 `项目三：AI简历处理工具`。
3. 点进目录后能看到 `package.json`、`vercel.json`、README 和源码目录。
4. 最近提交只包含预期的项目三变更。
5. 仓库中没有真实环境文件和凭据。

以后修改新仓库内的项目三，并在同一 Git 仓库提交推送，才能自然保留版本历史。本机 `D:\CodeHouse\项目三：AI简历处理工具` 是此次交付的独立源码包，复制后与仓库里的版本不会自动同步。

## 8. 后续连接 Vercel

详细步骤见 [Vercel 部署说明](vercel-deployment.md)，最关键设置为：

| 设置 | 值 |
| --- | --- |
| Git 仓库 | `FreeInBlind/Internship-project` |
| Production Branch | 以实际正式分支为准，通常是 `main` |
| Framework Preset | Next.js |
| Root Directory | `项目三：AI简历处理工具` |
| Node.js | 24.x |
| Install Command | `npm ci --include=dev` |
| Build Command | `prisma generate && next build` |
| Output Directory | 默认自动识别 |
| 本机端口 3010 | 不配置到 Vercel |

生产环境需要 `DATABASE_URL`、`DATABASE_URL_UNPOOLED`、`NEXTAUTH_SECRET` 和正式 HTTPS origin 的 `NEXTAUTH_URL`。账户加密保存还需要独立 `CUSTOM_AI_ENCRYPTION_KEY` 和正确的 AiConfig 表。真实值仅放本机被忽略的配置或 Vercel 服务端环境变量，不上传 GitHub。

让访客免登录查看首页：检查 Vercel Deployment Protection，确保 Vercel Authentication 不保护正式生产域名，并核对其他密码/IP 限制。分享 Production 正式域名，用未登录 Vercel 的无痕窗口访问 `/`。应用私有页面跳到本项目登录页是预期行为，保留其认证和账户隔离。

## 9. 当前验证与上线缺口

原发布副本已独立安装并通过 Prisma validate/generate、34 个文件共 887 项测试、lint 和生产构建；lint 有三条 React Hooks 警告。本次整理是源码复制和文件一致性检查，没有在本目录重复安装、构建或启动。

2026-11-02 完整及生产依赖审计均未通过：Next.js、NextAuth、PostCSS、uuid 四个漏洞依赖条目，共 2 critical、1 high、1 moderate。尚未核实全部公告适用条件和修复方案，也未升级依赖。正式公开上线前需处理受影响版本并回归；不要绕过平台安全检查。

临时 HTTP 冒烟、真实浏览器解析、生产数据库迁移、登录/报告 CRUD、账户个人 AI 保存及实际 Vercel 验收尚未完成。代码上传成功不等于这些功能已在线验收。更多记录见 [发布检查记录](release-checklist.md)。
