
# ---- Estágio 1: compila o TypeScript --------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Estágio 2: imagem final, só com o necessário para rodar ---------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Pasta dos arquivos anexados ao catálogo (no compose, um volume montado aqui). Criada com o
# dono certo para o volume herdar a permissão de escrita do usuário "node".
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

# Roda como usuário sem privilégios (o usuário "node" já existe na imagem oficial).
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health/ready >/dev/null || exit 1

# Aplica as migrações pendentes e sobe a API. O runner usa um advisory lock, então duas
# réplicas subindo ao mesmo tempo não migram em paralelo.
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/server.js"]
