# FlexIA Hub — Plano de Melhorias (situação em 15/11/2026)

Auditoria técnica + lacunas de produto levantadas em 13/11/2026, com a situação de cada item
depois da implementação. O desenho das soluções está em `ARQUITETURA.md`.

## Técnico / infraestrutura

| # | Item | Situação |
|---|---|---|
| T1 | Rotas de leitura sem login | ✅ Toda rota de dados exige login (21 rotas cobertas por teste) |
| T2 | `JWT_SECRET` com valor padrão | ✅ Obrigatório; configuração inteira validada na subida |
| T3 | Sem limite de requisições | ✅ Login, cadastro, redefinição de senha e teto geral da API |
| T4 | ai-service sem pool de conexões | ✅ Pool com timeouts |
| T5 | Reindexação sempre completa | ✅ Incremental por hash, automática, com reajuste só quando o índice muda demais |
| T6 | Sem logs estruturados | ✅ pino (backend) e JSON (ai-service), com id de requisição |
| T7 | Sem Docker / CI | 🟡 Dockerfiles, compose e GitLab CI escritos; **imagens não construídas neste ambiente** (Docker Hub bloqueado) |
| T8 | JWT de 30 dias sem revogação | ✅ Access token de 1h + refresh rotativo e revogável |
| T9 | Rotas sem tratamento de erro | ✅ Tratamento central; erros de cliente viram 4xx |
| T10 | Pool do Postgres sem timeout | ✅ |
| T11 | Listas sem paginação | ✅ Clientes e projetos paginados; painel com agregados no banco |
| T12 | Health check superficial | ✅ `/api/health/ready` confere o banco |
| T13 | Schema aplicado à mão | ✅ Migrações versionadas (`npm run migrate`) |
| T14 | CORS aberto no ai-service | ✅ Fechado por padrão + token entre serviços |
| T15 | Sem testes no ai-service e no frontend | ✅ 18 (pytest) e 17 (vitest) |
| T16 | Módulos de domínio sem teste | ✅ Backend foi de 33 para 112 testes |
| — | Error Boundary no React | ✅ |
| — | `schema.prisma` órfão | ✅ Removido |
| — | Tokens em `localStorage` | ⏳ Mantido (custo documentado em `ARQUITETURA.md`) |
| — | Soft delete | ⏳ Não feito; a auditoria registra o que foi apagado |
| — | Cache de dados no frontend | ⏳ Não feito |

## Produto

| Item | Situação |
|---|---|
| Notificações in-app | ✅ |
| Busca global (Ctrl+K) | ✅ |
| Painel de administração (usuários, papéis, categorias) | ✅ |
| Log de auditoria | ✅ |
| Catálogo: scorecard, item parado, descontinuação, dependências | ✅ |
| Catálogo: indicador de uso/popularidade | ⏳ |
| Ativação: templates com prazos | ✅ |
| Ativação: entregas vencidas / da semana | ✅ (lista; sem Gantt) |
| Ativação: dependência entre artefatos, previsão de término | ⏳ |
| Cliente 360: composição e histórico do health score | ✅ |
| Cliente 360: alertas e documentos pela tela | ✅ |
| Cliente 360: contatos do cliente, exportação em PDF | ⏳ |
| Fórum: aviso de resposta, resposta aceita | ✅ |
| Fórum: reações, markdown, anexos | ⏳ |
| Assistente: histórico persistido, avaliação das respostas, visão do admin | ✅ |
| Assistente: resposta em streaming | ⏳ |
| Notificações por email | ⏳ Depende de provedor de email |

## Próximos passos sugeridos

1. Validar `docker compose up --build` num ambiente com acesso ao Docker Hub e escolher onde hospedar.
2. Configurar `ANTHROPIC_API_KEY` e testar o caminho de síntese do Assistente.
3. Conectar um provedor de email (recuperação de senha em produção e notificações por email).
4. Conectar GitLab e ClickUp reais; ajustar a heurística de classificação do catálogo.
5. Itens ⏳ acima, na ordem em que o uso real mostrar necessidade.
