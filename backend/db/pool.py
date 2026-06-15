import asyncpg


async def create_pool(dsn: str) -> asyncpg.Pool:
    # 4 gunicorn workers × max_size 20 = 80 connections, under Postgres' default
    # max_connections=100 (worker service uses its own small pool). Warm min_size
    # avoids cold-start latency on the morning attendance/fee burst.
    return await asyncpg.create_pool(dsn=dsn, min_size=5, max_size=20)


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()
