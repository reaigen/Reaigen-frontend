FROM node:20-alpine AS base

# --- deps ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY vendor/reaigen-floorplan-solver-0.1.0.tgz ./vendor/reaigen-floorplan-solver-0.1.0.tgz
COPY vendor/reaigen-spinoff-0.1.37.tgz ./vendor/reaigen-spinoff-0.1.37.tgz
RUN npm ci --ignore-scripts

# --- build ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- run ---
FROM base AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3055
ENV PORT=3055
CMD ["node", "server.js"]
