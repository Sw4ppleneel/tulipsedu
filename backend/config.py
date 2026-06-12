from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Core
    database_url: str = "postgresql://tulips:tulips@localhost:5432/tulipsedu"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30
    debug: bool = False
    base_domain: str = "tulipsedu.in"
    app_base_url: str = "http://localhost:8000"

    # Workflow worker (python -m worker.main)
    worker_poll_seconds: int = 3
    worker_batch_size: int = 100

    # CORS — comma-separated origins for production (e.g. "https://s1.tulipsedu.in")
    # Use cors_origin_regex for wildcard subdomain support in production.
    cors_origins: str = "http://localhost:5173"
    cors_origin_regex: str = ""  # e.g. r"https://[a-z0-9-]+\.tulipsedu\.in"

    # Cloudflare R2 (file uploads)
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = ""
    r2_public_url: str = ""  # e.g. https://cdn.tulipsedu.in

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
