
# ---- Estágio 1: gera os arquivos estáticos ---------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Estágio 2: nginx sem privilégios servindo o build e repassando /api ---------------
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# Para onde o nginx repassa /api (o serviço "backend" do docker-compose, por padrão).
ENV BACKEND_URL=http://backend:4000
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
