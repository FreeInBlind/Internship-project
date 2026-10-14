# EcoPoints-1.1 本地运行命令

此文件保留原开发环境的 D 盘路径。其他电脑请优先使用 [README 中的通用运行步骤](README.md#本地运行)，下方项目目录示例需替换为实际下载位置。

本文件只针对 EcoPoints-1.1 (10.1)，使用新版自己的前端、API、数据库和虚拟环境。

固定地址：
- 网页端：http://127.0.0.1:5501/index.html
- API：http://127.0.0.1:8001
- API 文档：http://127.0.0.1:8001/docs
- 数据库：ecopoints_11
- 虚拟环境：D:\\my_env\\EcoPoints_11_venv

初始化数据库。推荐直接运行项目自带脚本（会严格按“创建数据库 -> 导入表结构”的顺序执行）：
cd "C:\path\to\EcoPoints"
.\\init_database.ps1

不要在数据库创建前使用 mysql ... ecopoints_11 作为连接参数；那会先尝试进入不存在的数据库并触发 ERROR 1049。

配置数据库连接：
Copy-Item .env.example .env
notepad .env

.env 内容至少包括：
DATABASE_URL=mysql+pymysql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:3306/ecopoints_11
SECRET_KEY=replace-with-a-long-random-local-key
ACCESS_TOKEN_EXPIRE_MINUTES=120
CORS_ORIGINS=http://localhost:5501,http://127.0.0.1:5501

安装依赖并启动 API：
cd "C:\path\to\EcoPoints"
Set-ExecutionPolicy -Scope Process Bypass
.\\setup_venv.ps1
.\\start_backend.ps1

另开 PowerShell 启动网页端：
cd "C:\path\to\EcoPoints"
.\\start_frontend.ps1
Start-Process "http://127.0.0.1:5501/index.html"

注册 POST：
$registerBody = @{ full_name = "Test User"; email = "test@example.com"; password = "EcoPointsTest123!"; campus = "Main Campus"; department = "Environmental Studies" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/api/auth/register" -ContentType "application/json" -Body $registerBody

登录 POST 并保存 Token：
$loginBody = @{ email = "sarah.tan@example.edu"; password = "EcoPointsDemo123!" } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/api/auth/login" -ContentType "application/json" -Body $loginBody
$token = $login.access_token

获取当前用户：
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8001/api/me" -Headers @{ Authorization = "Bearer $token" }

获取奖励列表：
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8001/api/rewards"

兑换奖励 POST（把 1 换成真实 reward id）：
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/api/rewards/1/redeem" -Headers @{ Authorization = "Bearer $token" }

健康检查：
Invoke-RestMethod "http://127.0.0.1:8001/health"
Invoke-RestMethod "http://127.0.0.1:5501/__ecopoints_source"

加载演示数据：
& "D:\\my_env\\EcoPoints_11_venv\\Scripts\\python.exe" .\\seed_demo.py
