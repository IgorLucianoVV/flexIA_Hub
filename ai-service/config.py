"""Configuração do ai-service — único lugar que lê variáveis de ambiente."""
import os
from dataclasses import dataclass
from typing import List
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv

load_dotenv()


def _strip_prisma_only_params(url: str) -> str:
    """psycopg2/libpq não entende o parâmetro `schema` que algumas connection strings
    trazem (herança do Prisma) — remove ele e mantém os demais."""
    parts = urlsplit(url)
    query_pairs = [(k, v) for k, v in parse_qsl(parts.query) if k != "schema"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query_pairs), parts.fragment))


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f'Variável de ambiente obrigatória "{name}" não definida. '
            "Configure-a em ai-service/.env (veja ai-service/.env.example)."
        )
    return value


def _csv(name: str) -> List[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    env: str
    port: int
    log_level: str
    database_url: str
    db_pool_min: int
    db_pool_max: int
    # Segredo compartilhado com o backend (cabeçalho X-Service-Token). Vazio = sem checagem (dev).
    service_token: str
    cors_origins: List[str]
    anthropic_api_key: str
    router_model: str
    synthesis_model: str
    # Fração do índice que pode mudar antes de o modelo de embeddings ser reajustado do zero.
    refit_threshold: float

    @property
    def is_production(self) -> bool:
        return self.env == "production"


def load_settings() -> Settings:
    settings = Settings(
        env=os.environ.get("APP_ENV", "development").strip().lower(),
        port=int(os.environ.get("PORT", "8000")),
        log_level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        database_url=_strip_prisma_only_params(_required("DATABASE_URL")),
        db_pool_min=int(os.environ.get("DB_POOL_MIN", "1")),
        db_pool_max=int(os.environ.get("DB_POOL_MAX", "8")),
        service_token=os.environ.get("SERVICE_TOKEN", "").strip(),
        cors_origins=_csv("CORS_ORIGINS"),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
        # Modelos atuais da Anthropic (os claude-3-5-* usados antes foram aposentados e
        # passariam a falhar assim que uma chave fosse configurada). Um modelo rápido e
        # barato para o roteamento, um equilibrado para a síntese.
        router_model=os.environ.get("AI_ROUTER_MODEL", "claude-haiku-5-5").strip(),
        synthesis_model=os.environ.get("AI_SYNTHESIS_MODEL", "claude-sonnet-5-5").strip(),
        refit_threshold=float(os.environ.get("RAG_REFIT_THRESHOLD", "0.3")),
    )
    if settings.is_production and not settings.service_token:
        raise RuntimeError(
            "SERVICE_TOKEN é obrigatório em produção: sem ele, qualquer um que alcance o "
            "ai-service na rede consegue consultar dados de cliente."
        )
    return settings


settings = load_settings()
