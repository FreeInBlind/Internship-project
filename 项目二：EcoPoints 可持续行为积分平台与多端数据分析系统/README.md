# EcoPoints｜可持续行为积分与数据分析平台

EcoPoints 是面向校园及组织场景的全栈课程项目，将步行、骑行等可持续行为与积分、奖励兑换和数据分析串联起来。项目包含 Web 界面、FastAPI 后端、MySQL 数据库，以及用于 GPS 行程记录的 Flutter Android 配套客户端，可作为本地演示与代码评审项目。

## 核心功能

- **账号与权限**：邮箱密码注册及登录、JWT 鉴权，区分普通用户、组织和管理员；后端独立校验角色、账号状态及数据访问范围。
- **可持续出行**：网页导入 GPX，移动端提交分段 GPS 数据；后端统一校验距离、时长、速度、采样间隔和定位精度，并识别重复轨迹，避免重复发放积分。
- **积分与奖励**：记录积分流水，展示余额及活动趋势；管理员发布奖励，用户及组织提交带联系方式的兑换申请，处理积分扣减和库存。
- **个人数据看板**：Basic 提供固定模块；Plus 支持自定义时间范围、模块增删、排序、宽度调整及图表 PNG 导出，布局按账号保存。
- **组织数据分析**：CSV 导入与字段识别；Plus 支持字段映射、多条件筛选、聚合、11 类图表、移动平均、环比分析、线性趋势外推和异常标记。
- **管理与审核**：活动及奖励发布、组织申请与 Plus 申请审核、账号订阅及状态管理、交通积分规则调整和站内通知。
- **移动端与界面体验**：Flutter Android 前台行程记录、分段暂停、GPX 导出及失败后保留记录；Web 支持深色模式、字号与语言偏好。

## 技术栈与实现要点

- Web：HTML、CSS、原生 JavaScript、Apache ECharts 6.1.0。
- 后端：Python 3.11+、FastAPI、Pydantic、SQLAlchemy、PyMySQL。
- 数据库：MySQL；通过外键关联账号、积分流水、行程、奖励、审核请求及组织数据集。
- 身份验证：PBKDF2 密码哈希与 JWT；环境变量配置数据库连接和签名密钥。
- 移动端：Flutter / Dart、Android 定位、HTTP API、设备本地记录。
- 验证：Python unittest 使用隔离的内存 SQLite；另有 Playwright 浏览器检查及 Flutter 测试。

行程校验与积分结算集中在后端，客户端不决定奖励值；行程和积分流水在同一事务中保存。组织看板按数据集提供分析，个人看板按账号积分记录提供分析。详细设计见 [交通规则与接口](TRANSPORT.md)、[数据看板说明](DASHBOARD.md) 和 [数据库结构](DATABASE_SCHEMA.md)。

## 项目结构

~~~text
EcoPoints/
├── index.html                 # Web 页面、导航与账号交互
├── style.css                  # 全局样式
├── dashboard.js / .css        # 数据看板交互与样式
├── transport.js               # 网页行程上传与历史记录
├── admin-rules.js             # 管理员交通积分规则界面
├── motto*.txt                 # 页面使用的多语言环保语录
├── assets/                    # 头像、ECharts 及第三方许可说明
├── backend/
│   ├── app/                   # API、模型、校验、鉴权、分析与出行逻辑
│   └── requirements.txt       # 固定版本的 Python 依赖
├── sql/schema.sql             # 数据库建库、建表脚本
├── database/                  # 本地数据库管理工具
├── mobile/                    # Flutter Android 源码、配置与测试
├── tests/                     # 后端及浏览器检查，模拟 GPX 样例
├── seed_demo.py               # 演示管理员、活动和奖励数据
├── serve_frontend.py           # 固定项目目录的本地 Web 服务
├── *.ps1                      # Windows 本地辅助脚本
└── .env.example               # 可公开的配置模板
~~~

## 本地运行

以下步骤适用于 Windows PowerShell。需要 Python 3.11+、运行中的 MySQL Server，以及 MySQL 客户端。移动端另需 Flutter SDK 和 Android 开发环境。

### 1. 创建环境并配置

在下载或克隆后的项目根目录执行：

~~~powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
Copy-Item .env.example .env
~~~

如果 PowerShell 阻止执行激活脚本，可先运行 Set-ExecutionPolicy -Scope Process Bypass，只调整当前终端会话。

编辑 .env，替换数据库用户名、密码及 JWT 密钥：

~~~dotenv
DATABASE_URL=mysql+pymysql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:3306/ecopoints_11
SECRET_KEY=replace-with-a-long-random-local-key
ACCESS_TOKEN_EXPIRE_MINUTES=120
CORS_ORIGINS=http://localhost:5501,http://127.0.0.1:5501
~~~

使用随机密钥替换 SECRET_KEY 占位符，可运行以下命令生成：

~~~powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
~~~

数据库密码中的 @、:、/、?、#、%、& 等字符需要在连接串中 URL 编码。.env 只保留在本地，仓库只包含 .env.example。

### 2. 初始化数据库并加载演示数据

在 MySQL Workbench 或其他 MySQL 客户端执行 [sql/schema.sql](sql/schema.sql)，创建 ecopoints_11 及表结构。也可使用辅助脚本；下面的客户端路径和用户名需替换为自己的实际配置：

~~~powershell
.\init_database.ps1 -Mysql "C:\path\to\MySQL\bin\mysql.exe" -User YOUR_USER
python seed_demo.py
~~~

脚本按建库、建表的顺序执行，并提示输入数据库密码。seed_demo.py 向当前配置的数据库写入演示数据，仅应对本地演示库执行。

演示管理员：邮箱 sarah.tan@example.edu，密码 EcoPointsDemo123!。这是公开的演示身份，不应与真实账号或密码复用。若该账号已存在，种子脚本会恢复管理员角色，但不会重置其密码。普通用户和组织账号通过注册页面创建。

### 3. 启动后端与网页

终端一，在项目根目录激活虚拟环境并启动 API：

~~~powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8001
~~~

终端二，在项目根目录启动网页服务：

~~~powershell
python serve_frontend.py
~~~

- 网页：<http://127.0.0.1:5501/index.html>
- 交互式 API 文档：<http://127.0.0.1:8001/docs>
- 健康检查：<http://127.0.0.1:8001/health>

两个服务均可通过 Ctrl+C 停止。网页服务固定使用其脚本所在的项目目录，并禁用开发缓存。

现有 setup_venv.ps1、start_backend.ps1 使用原开发环境的固定路径 D:\my_env\EcoPoints_11_venv；上述命令使用项目内 .venv，便于其他电脑复现。原环境用户仍可继续使用这些辅助脚本。

### 4. 可选：运行 Android 客户端

在 mobile/ 下安装依赖，连接 Android 设备，并将 API 端口转发至电脑：

~~~powershell
cd mobile
flutter pub get
adb reverse tcp:8001 tcp:8001
flutter run
~~~

手机中的 API 地址填 http://127.0.0.1:8001，电脑上的后端需保持运行。环境安装、设备权限和联调步骤见 [mobile/README.md](mobile/README.md)。

## 建议演示流程

1. 注册普通用户，登录后查看个人首页与 Basic 看板。
2. 在 Activity 上传 tests/fixtures/walk-demo.gpx 和 cycle-demo.gpx，默认分别获得 10、20 积分；再次上传同一轨迹，验证不会重复加分。
3. 使用演示管理员查看审核队列、发布活动或奖励，调整交通积分规则；管理员不参与积分获取及奖励兑换。
4. 注册组织账号并导入自建模拟 CSV；管理员为其开启 Plus 后，演示字段映射、筛选、图表添加与布局保存。
5. 可选：用 Android 客户端记录一段真实行程，导出 GPX 或直接上传，随后在网页查看同一账号的记录。

GPX 样例是模拟轨迹；演示不需要上传个人真实出行数据。奖励兑换需要足够余额，示例行程的 30 积分不足以兑换种子数据中的奖励，可由管理员创建低积分演示奖励。

## 测试与验证

在项目根目录完成依赖安装及 .env 配置后运行：

~~~powershell
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests -p "test_*.py" -v
~~~

后端测试使用内存 SQLite，覆盖账号权限、审核流程、数据分析、交通校验及重复提交等行为，不写入项目 MySQL 数据。

移动端检查：

~~~powershell
cd mobile
flutter analyze
flutter test
~~~

浏览器检查 tests/browser_*.cjs 当前仍包含原开发电脑的 Playwright 模块路径和 Edge 路径；在其他电脑运行前需安装 Playwright 并调整这些路径。其隔离 API 服务为 tests/serve_dashboard_test.py，监听 127.0.0.1:8002，需配合 5501 端口的网页服务。这些脚本不代表仓库已配置自动 CI。

## 当前边界

- 本项目用于本地演示，尚未提供生产部署、HTTPS、真实支付或 Google OAuth 登录；Google 登录按钮和 Plus 支付二维码属于占位流程。assets/plus-payment-qr.png 当前未提供，界面会显示占位提示。
- GPX/GPS 校验判断轨迹数据是否符合规则，无法证明真实交通方式或完全防止伪造。后端保留行程摘要和哈希，不保存原始 GPX 或完整路线。
- Android 记录限前台运行，切换到后台会暂停；当前 HTTP 配置面向本地联调。
- 看板线性外推和异常标记是探索性分析，不是经过验证的预测模型。
- 页面仍通过 Google Fonts 与 CDN 加载部分字体及图标；ECharts 随源码本地提供。
- 项目包含公开演示管理员约定，后端启动也会将该演示邮箱对应账号设为管理员；对外部署前需要调整演示账号逻辑及密钥配置。

## GitHub 手动上传范围

建议上传完整、可复现的源码：根目录 HTML/CSS/JS、motto*.txt、backend/、mobile/ 的源码及项目配置、database/、sql/schema.sql、assets/、tests/ 的测试源码与模拟 GPX，以及 README、设计文档、辅助脚本、.env.example、.gitignore、.gitattributes 和 mobile/pubspec.lock。assets/vendor/ 中的 ECharts 文件及 LICENSE/NOTICE 应一起保留。Android Gradle wrapper 属于构建工具，gradlew、gradlew.bat、gradle/wrapper/ 可保留。

不要上传以下本地文件：

- .env、其他真实环境配置、API 密钥、证书私钥或 Android 签名密钥。
- backend_run.log、backend_error.log 等日志；虚拟环境、__pycache__/、.pyc、测试临时目录。
- mobile/.dart_tool/、mobile/build/、mobile/android/.gradle/、mobile/android/.kotlin/、mobile/android/.cxx/、.flutter-plugins-dependencies、mobile/android/local.properties，以及自动生成的 GeneratedPluginRegistrant.java。
- mobile/.vscode/settings.json（包含本机 Flutter SDK 路径）；通用的 launch.json 可保留。
- 真实数据库备份、用户资料、审核附件、个人 GPS 轨迹和未脱敏截图。sql/schema.sql 是表结构，应保留。

**通过 GitHub 网页直接上传文件时，.gitignore 不会替你筛除文件。** 请先在单独的待上传文件夹中挑选上述内容，保留原目录层级，核对后再上传；无需删除本地开发目录中的文件。tests/*.png 是验证产物，默认排除。若用于展示，可从中挑选已检查的截图，另存到 docs/screenshots/，再添加到 README。

作为应聘作品，建议补充本人实际负责的模块、团队协作范围及 2–3 张脱敏截图或演示视频。项目简介只描述已实现的能力，个人贡献应与实际经历一致。公开课程或团队代码前，请确认学校、团队及素材的使用许可；本仓库暂未指定整体开源许可证，第三方许可仍需遵守。
