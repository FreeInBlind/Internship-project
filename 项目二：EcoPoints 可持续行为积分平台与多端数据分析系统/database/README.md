# MySQL 管理脚本

`manage_mysql.py` 使用 SQLAlchemy 管理当前 `ecopoints_11` 数据库。它默认读取项目根目录的 `.env` 中的 `DATABASE_URL`，不会把密码写入脚本。

从项目根目录运行：

```powershell
$python = "D:\my_env\EcoPoints_11_venv\Scripts\python.exe"
& $python database\manage_mysql.py test
& $python database\manage_mysql.py tables
& $python database\manage_mysql.py count users
& $python database\manage_mysql.py list users --limit 20
& $python database\manage_mysql.py schema users
```

执行可信的本地 SQL（`INSERT`、`UPDATE`、`DELETE`、查询等）：

```powershell
& $python database\manage_mysql.py sql "SELECT email, role FROM users"
```

## 账号配置

数据库连接由你本地的 `.env` 提供，仓库不包含真实账号密码。配置步骤：

1. 复制 `.env.example` 为 `.env`（如果还没有）。
2. 修改 `DATABASE_URL`，格式为 `mysql+pymysql://用户名:密码@127.0.0.1:3306/ecopoints_11`。
3. 密码包含 `@`、`:`、`/`、`?`、`#`、`%` 或 `&` 时，先进行 URL 编码。
4. 运行 `& $python database\manage_mysql.py test` 验证。

也可以不改 `.env`，临时传入连接串：

```powershell
& $python database\manage_mysql.py --database-url "mysql+pymysql://user:password@127.0.0.1:3306/ecopoints_11" test
```

如果尚未有 MySQL 密码或数据库，先启动 MySQL Server，然后在 MySQL Workbench 或命令行执行项目的 `sql\schema.sql`。已有项目初始化脚本也可直接运行：`./init_database.ps1`，它会提示输入 MySQL 密码。
