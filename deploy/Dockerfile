FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/rules/package.json packages/rules/package.json
RUN npm ci
COPY tsconfig.json ./
COPY apps/web apps/web
COPY apps/server apps/server
COPY packages packages
ARG VITE_GAME_URL
ENV VITE_GAME_URL=$VITE_GAME_URL
RUN npm run build
CMD ["npm","run","start","--workspace","@wangxu/server"]
