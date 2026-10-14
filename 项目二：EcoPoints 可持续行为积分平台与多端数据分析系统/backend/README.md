# EcoPoints Backend

This is a local FastAPI + MySQL backend for the course demo.
这是用于课程演示的本地 FastAPI + MySQL 后端。

## File guide / 文件说明

- app/main.py: API application and routes. / API 应用和路由。
- app/config.py: Reads .env. / 读取环境配置。
- app/database.py: SQLAlchemy engine and sessions. / 数据库引擎和会话。
- app/models.py: MySQL table models. / 数据库表模型。
- app/schemas.py: Request and response validation. / 请求响应校验。
- app/security.py: Password hashing and JWT. / 密码哈希和 JWT。
- app/dependencies.py: Authentication dependency. / 登录鉴权依赖。
- requirements.txt: Python packages. / Python 依赖。
- ../sql/schema.sql: Manual database/table creation. / 手动建库建表脚本。
- ../.env.example: Safe config template. / 安全配置模板。
- ../setup_venv.ps1: Creates the requested virtual environment. / 创建指定虚拟环境。
- ../start_backend.ps1: Starts the local API. / 启动本地 API。
- ../seed_demo.py: Adds demo data and a demo account. / 创建演示数据和演示账号。

## Setup / 配置步骤

For a portable setup using a project-local `.venv`, follow [the root README](../README.md#本地运行). The helper scripts below retain the original workstation paths.
使用项目内 `.venv` 的通用运行步骤见[根目录 README](../README.md#本地运行)；下方辅助脚本保留了原开发环境路径。

1. Install Python 3.11 or newer and make sure python works in PowerShell.
2. From this project folder, run setup_venv.ps1. It creates D:\my_env\EcoPoints_11_venv, separate from the legacy EcoPoints environment.
3. Copy .env.example to .env and replace the MySQL username and password.
4. Use your MySQL client to run sql/schema.sql.
5. Run seed_demo.py with the virtual environment Python to create demo data.
6. Run start_backend.ps1; open http://127.0.0.1:8001/docs.

Keep .env private. This setup is for localhost course demonstrations, not production hosting.
请勿公开 .env。本配置适用于本机课程演示，不面向生产部署。
