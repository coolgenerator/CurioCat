from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Database
    database_url: str = "postgresql+asyncpg://curiocat:curiocat@localhost:5432/curiocat"

    # LLM
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o"
    openai_api_key: str = ""
    openai_base_url: str = ""
    anthropic_api_key: str = ""

    # Embeddings (uses separate base URL since proxies often don't support embedding models)
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    embedding_api_key: str = ""
    embedding_base_url: str = ""

    # Search
    brave_search_api_key: str = ""

    # Server
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
