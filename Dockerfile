FROM node:20-alpine AS base

# --- deps ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# The whole directory, not each tarball by name. package.json pins these as
# file: dependencies, so naming them here duplicated the version in a second
# place and the two drifted: the spinoff bump to 0.1.45 updated package.json and
# left this copying 0.1.44, which fails at COPY before npm ci can report
# anything useful. Copying the directory means a version bump only has to be
# made once.
COPY vendor/ ./vendor/
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
