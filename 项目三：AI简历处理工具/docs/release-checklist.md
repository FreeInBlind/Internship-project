# 发布副本检查记录

检查日期：2026-11-02。当前阶段为提交前准备；尚未 git add、commit、push 或部署到 Vercel。

## 已完成的文件整理

- 恢复 `lib/stage4a-budget.cjs`：它是 `lib/groq.js` 的运行依赖，仅包含预算检查代码，不含真实 marker 或凭据。官方 AI 仍默认关闭。
- 补齐通用 `scripts/run-next.cjs`，使 dev/start 指向实际文件；保留本机 3010 默认端口与独立开发缓存。
- 删除失效的 `test:integration` 命令；未纳入真实数据库验收脚本。
- 纳入 34 个适用离线测试文件、`test/setup.js` 和 Vitest 配置。排除 stage4aAcceptance、stage4aLifecycle、offlineVerify 三组依赖本机专项验收工具的测试。
- 保留正式 Prisma schema 和四份 migration SQL，补充 `migration_lock.toml` 的 PostgreSQL provider 声明；未修改既有 SQL，未应用迁移。
- 重写发布版 README，移除本机历史记录和失效文档引用；保留部署说明及当前验证限制。
- 保留 `.gitignore`；真实环境文件、依赖、缓存、运行日志和预算 marker 不纳入上传。
- `.eslintrc.json` 增加 `root: true`，修复发布副本嵌套在原项目时向上继承配置造成的 Next ESLint 插件冲突。

## 已取得的执行验证结果

本轮已在用户授权安装和运行副本后，完成下列独立验证。发布副本未复用原项目 node_modules；根目录仅有 `.env.example`，子进程使用显式环境白名单和回环 dummy 数据库 URL，不传入真实数据库或 AI 凭据。

| 检查 | 实际结果 |
| --- | --- |
| `npm ci --include=dev` | 退出 0，安装 561 个包；未另行批准或重放被安装策略限制的生命周期脚本。 |
| Prisma validate | 退出 0，schema 有效。 |
| Prisma generate | 退出 0，生成 Prisma Client 5.22.0 到副本 node_modules；未应用迁移。 |
| `npm test -- --run --maxWorkers=2 --minWorkers=1` | 退出 0，34 个文件、887 项测试全部通过。 |
| `npm run lint` | 修复配置继承冲突后退出 0，仍有三条 React Hooks 警告。 |
| `npm run build` | 退出 0，Next.js 14.2.35 编译、静态页生成及构建追踪完成。 |
| `npm audit --json` | 退出 1，四个漏洞依赖条目。 |
| `npm audit --json --omit=dev` | 退出 1，同样四个漏洞依赖条目。 |

三条 lint 警告位于 `components/CustomAiProvider.jsx`：35 行的 useMemo 依赖，以及 98、114 行 effect cleanup 中的 ref 引用。未禁用规则，也未为消除警告改动组件行为。

测试、lint、build 使用 Node 层意外外联保护；它不是操作系统沙箱，测试 mock 可替换方法，不能据此宣称绝对零网络。Prisma 校验和生成不证明数据库已连接、迁移已应用或真实数据读写可用。原项目历史 39 个文件、965 项测试的记录不作为当前副本的结果。

## 依赖审计未通过

完整与生产审计均为：2 critical、1 high、1 moderate，共四个漏洞依赖条目，而非四个 CVE。

| 依赖 | 审计严重程度 | 当前处理状态 |
| --- | --- | --- |
| next | critical | 未升级；审计建议涉及 Next 大版本变更，需另行评估兼容性。 |
| next-auth | critical | 未升级；需核实公告适用条件、修复版本并回归认证流程。 |
| postcss | high | 未升级；需同时检查直接开发依赖和框架传递依赖。 |
| uuid | moderate | 未升级；需检查 NextAuth 传递依赖的修复。 |

这是 npm registry 返回的审计结果；尚未逐项独立核实官方公告和本项目触发条件。审计建议的版本不作为已核实的最新版本。本次未执行 `npm audit fix`、`--force` 或框架大版本迁移，不能将构建成功表述为安全审计通过。

## 临时服务与实际运行验收

临时回环 production HTTP 检查脚本已在仓库外准备，计划检查公开首页、登录页、私有页面未登录跳转和静态资源响应，结束后停止服务。该启动命令被本次自动审批拒绝：恢复摘要中的历史授权不能作为审批器认可的当前执行授权。因此本次没有启动该临时服务，也没有取得 HTTP 冒烟结果；当前没有为人工验收保留应用服务。

静态资源入口已核对存在；实际浏览器 PDF、DOCX、OCR 解析及运行时加载仍待验证。未注册、登录、执行真实报告 CRUD、读取真实环境文件或请求真实 AI。

## 上传候选文件静态复核

安装和构建后，以 `git ls-files -z` 和 `git ls-files --others --exclude-standard -z` 合并得到的候选文件复核，排除 node_modules、`.next` 等生成物：项目三共 130 个文件、约 34.59 MiB，含 34 个测试文件、四份正式 migration SQL。最大文件约 4.48 MiB，无文件超过 100 MiB。此体积为补充本段记录前的检查值，后续文档文字使字节数略有变化。

依赖清单与锁文件的名称、版本、依赖和 engines 一致；191 处第一方静态相对 import/require 均可解析到候选文件，三份 Markdown 中四处本地链接目标存在，npm 脚本目标及声明一致。未核验外部文档 URL、章节锚点、动态拼接引用或 vendor 打包运行时引用。

128 个文本候选的模式扫描未命中私人 Neon hostname、私钥块、常见 provider/GitHub token、数据库 URL 或长 Bearer 字面值。宽泛的凭据赋值规则有 25 处命中，全部位于 tests 下的合成数据和 mock 上下文，未发现足以认定为真实凭据的证据；两个 traineddata 二进制只做文件名和大小检查。此检查不保证覆盖所有秘密类型，也不替代第三方许可及依赖审计。

Git 范围复核：原仓库已有 90 个跟踪文件，项目三的 130 个文件全部尚未跟踪，其他目录无新增；已有跟踪文件 diff 与 cached diff 均为空，项目一、项目二相对当前 HEAD/索引未修改。已确认 `.env.local`、node_modules、`.next`、`.next-local`、`.stage4a-runtime` 和日志被忽略。未执行 git add、commit 或 push；仓库外的验证脚本、审计 JSON 和临时目录不属于上传候选。

## 上线前尚未完成

- 依赖公告适用性核实、必要升级与回归；当前安全审计未通过。
- 临时 HTTP 冒烟检查及真实浏览器文件解析验收。
- 在隔离数据库验证正式迁移链，以及生产数据库变更审查。
- 生产环境变量、独立加密主密钥和数据库结构配置。
- GitHub 提交和推送、Vercel 部署、无痕公开首页验收。
- 应用登录、报告 CRUD、跨账户隔离、14 天生命周期及个人 AI 账户保存验收。

本轮未执行生产 migrate、seed、reset、db push、真实数据库测试写入或真实 provider 请求。GitHub 上传与线上发布是不同步骤，以上缺口不能由 mock 测试和构建结果替代。
