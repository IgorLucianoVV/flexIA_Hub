import hmac
import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import settings
from logging_setup import configure_logging

configure_logging(settings.log_level)

import db  # noqa: E402  (depois da configuração de log)
import graph as agent_graph  # noqa: E402
import rag  # noqa: E402

logger = logging.getLogger("ai-service")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # O índice é conferido em segundo plano: o serviço já responde ao health check enquanto
    # isso roda, em vez de segurar a subida (e o orquestrador) até a indexação terminar.
    threading.Thread(target=rag.ensure_index, name="rag-ensure-index", daemon=True).start()
    yield
    db.close_pool()


app = FastAPI(title="FlexIA Hub — AI Service", lifespan=lifespan)

# Este serviço só deveria ser chamado pelo backend (servidor para servidor), então CORS
# fica fechado por padrão. `CORS_ORIGINS` existe para quem quiser abrir conscientemente.
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Service-Token", "X-Request-Id"],
    )


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Erro não tratado na requisição",
            extra={"request_id": request_id, "method": request.method, "path": request.url.path},
        )
        return JSONResponse(status_code=500, content={"error": "Erro interno do serviço de IA", "request_id": request_id})
    response.headers["X-Request-Id"] = request_id
    if request.url.path != "/health":
        logger.info(
            f"{request.method} {request.url.path} {response.status_code}",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000),
            },
        )
    return response


def require_service_token(x_service_token: Optional[str] = Header(default=None)) -> None:
    """Só o backend pode chamar /ask e /reindex. O RAG lê dados de cliente; sem isso,
    qualquer um que alcançasse este serviço na rede consultaria esses dados sem login."""
    expected = settings.service_token
    if not expected:
        return  # desenvolvimento local sem token configurado
    if not x_service_token or not hmac.compare_digest(x_service_token, expected):
        raise HTTPException(status_code=401, detail="Token de serviço ausente ou inválido")


class HistoryTurn(BaseModel):
    question: str = Field(max_length=2000)
    answer: str = Field(max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: List[HistoryTurn] = Field(default_factory=list, max_length=6)


@app.get("/health")
def health():
    database = db.ping()
    body = {
        "ok": database["ok"],
        "configured": agent_graph.is_configured(),
        "service": "flexia-hub-ai-service",
        "checks": {"database": database},
    }
    if database["ok"]:
        try:
            status = rag.index_status()
            body["index"] = {
                "chunks": status["chunks"],
                "fitted_at": status["fitted_at"].isoformat() if status["fitted_at"] else None,
                "updated_at": status["updated_at"].isoformat() if status["updated_at"] else None,
            }
        except Exception as exc:  # noqa: BLE001
            body["index"] = {"error": str(exc)}
    return JSONResponse(status_code=200 if database["ok"] else 503, content=body)


@app.post("/ask", dependencies=[Depends(require_service_token)])
def ask(req: AskRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question é obrigatório")
    return agent_graph.ask(question, [turn.model_dump() for turn in req.history])


@app.post("/reindex", dependencies=[Depends(require_service_token)])
def reindex(full: bool = False):
    """Sincroniza o índice de RAG com os dados atuais da plataforma. Incremental por padrão
    (só reprocessa o que mudou); `?full=true` reajusta o modelo e reindexa tudo."""
    return rag.sync_index(full=full)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=False, log_config=None)
