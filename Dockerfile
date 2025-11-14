# syntax=docker/dockerfile:1

FROM node:20-slim AS deps
WORKDIR /app
ENV NODE_ENV=development

# System deps needed for building and for python availability in build stage
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-pip build-essential git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./

# Use Yarn classic for compatibility with existing yarn.lock
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
RUN yarn install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY . .
ENV NODE_ENV=production
RUN yarn build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Minimal system deps in runtime for Python
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-pip ca-certificates curl libvips \
  && rm -rf /var/lib/apt/lists/*

# App runtime files (Next standalone output)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Python requirements and scripts
COPY --from=builder /app/requirements.txt ./requirements.txt
COPY --from=builder /app/python-scripts ./python-scripts
RUN pip3 install --no-cache-dir -r requirements.txt

# Runtime env
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PYTHON_PATH=python3

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/ || exit 1
CMD ["node", "server.js"]
