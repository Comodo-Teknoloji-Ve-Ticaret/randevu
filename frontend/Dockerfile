# RandevunHazır web — ön yüz derlenir, Caddy ile sunulur (otomatik HTTPS); /api istekleri API'ye iletilir.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Sunucu modu: tarayıcı API'ye bu adresten bağlanır (ör. https://randevuhazir.com.tr)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
