"""Small SQLAlchemy CLI for inspecting and managing the EcoPoints MySQL database.

Examples (run from the project root or this directory)::

    python database/manage_mysql.py test
    python database/manage_mysql.py tables
    python database/manage_mysql.py count users
    python database/manage_mysql.py list users --limit 20
    python database/manage_mysql.py sql "SELECT COUNT(*) AS total FROM users"

The script reads DATABASE_URL from the project .env file. It never prints the
password. Use --database-url only when a temporary override is needed.
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path
from typing import Any
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.exc import SQLAlchemyError

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

DEFAULT_TABLES = (
    "users",
    "initiatives",
    "point_transactions",
    "rewards",
    "redemptions",
    "organizations",
    "organization_datasets",
    "organization_data_rows",
    "dashboard_layouts",
)


def build_database_url(value: str | None) -> str:
    """Read an existing URL or build one interactively from MySQL settings."""
    if value:
        return value
    configured = os.getenv("DATABASE_URL")
    if configured and "YOUR_USER" not in configured:
        return configured

    print("DATABASE_URL is not configured in the project .env file.")
    user = input("MySQL user [root]: ").strip() or "root"
    password = getpass.getpass("MySQL password: ")
    host = input("MySQL host [127.0.0.1]: ").strip() or "127.0.0.1"
    port = input("MySQL port [3306]: ").strip() or "3306"
    database = input("Database [ecopoints_11]: ").strip() or "ecopoints_11"
    return URL.create(
        "mysql+pymysql",
        username=user,
        password=password,
        host=host,
        port=int(port),
        database=database,
    ).render_as_string(hide_password=False)


def make_engine(database_url: str | None) -> Engine:
    return create_engine(build_database_url(database_url), pool_pre_ping=True)


def print_rows(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("(no rows)")
        return
    columns = list(rows[0])
    widths = {column: max(len(column), *(len(str(row.get(column, ""))) for row in rows)) for column in columns}
    print(" | ".join(column.ljust(widths[column]) for column in columns))
    print("-+-".join("-" * widths[column] for column in columns))
    for row in rows:
        print(" | ".join(str(row.get(column, "")).ljust(widths[column]) for column in columns))


def ensure_table(engine: Engine, table: str) -> None:
    if table not in inspect(engine).get_table_names():
        raise ValueError(f"Unknown table: {table}")


def command_test(engine: Engine, _: argparse.Namespace) -> None:
    with engine.connect() as connection:
        version = connection.execute(text("SELECT VERSION()")).scalar_one()
    print(f"Connected successfully. MySQL version: {version}")


def command_tables(engine: Engine, _: argparse.Namespace) -> None:
    tables = inspect(engine).get_table_names()
    print_rows([{"table": table} for table in tables])


def command_count(engine: Engine, args: argparse.Namespace) -> None:
    ensure_table(engine, args.table)
    with engine.connect() as connection:
        total = connection.execute(text(f"SELECT COUNT(*) FROM `{args.table}`")).scalar_one()
    print(f"{args.table}: {total}")


def command_list(engine: Engine, args: argparse.Namespace) -> None:
    ensure_table(engine, args.table)
    limit = max(1, min(args.limit, 500))
    with engine.connect() as connection:
        result = connection.execute(text(f"SELECT * FROM `{args.table}` LIMIT :limit"), {"limit": limit})
        print_rows([dict(row) for row in result.mappings()])


def command_schema(engine: Engine, args: argparse.Namespace) -> None:
    ensure_table(engine, args.table)
    columns = inspect(engine).get_columns(args.table)
    print_rows([{"name": c["name"], "type": str(c["type"]), "nullable": c["nullable"]} for c in columns])


def command_sql(engine: Engine, args: argparse.Namespace) -> None:
    # Begin/commit explicitly so INSERT, UPDATE, DELETE, and DDL statements persist.
    with engine.begin() as connection:
        result = connection.execute(text(args.statement))
        if result.returns_rows:
            print_rows([dict(row) for row in result.mappings()])
        else:
            print(f"Statement completed. Rows affected: {result.rowcount}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage EcoPoints MySQL with SQLAlchemy")
    parser.add_argument("--database-url", help="Temporary SQLAlchemy URL override; otherwise read project .env")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("test", help="test the database connection")
    subparsers.add_parser("tables", help="list database tables")
    count = subparsers.add_parser("count", help="count rows in a table")
    count.add_argument("table", choices=DEFAULT_TABLES)
    listing = subparsers.add_parser("list", help="list rows from a table")
    listing.add_argument("table", choices=DEFAULT_TABLES)
    listing.add_argument("--limit", type=int, default=20)
    schema = subparsers.add_parser("schema", help="show table columns")
    schema.add_argument("table", choices=DEFAULT_TABLES)
    sql = subparsers.add_parser("sql", help="run a SQL statement")
    sql.add_argument("statement", help="SQL statement; use parameters only for trusted local administration")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        engine = make_engine(args.database_url)
        commands = {
            "test": command_test,
            "tables": command_tables,
            "count": command_count,
            "list": command_list,
            "schema": command_schema,
            "sql": command_sql,
        }
        commands[args.command](engine, args)
        return 0
    except (SQLAlchemyError, OSError, ValueError) as exc:
        print(f"Database operation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
