FROM oven/bun:1.3.9

RUN apt-get update && apt-get install -y python3 make g++ pkg-config git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN bun install --frozen-lockfile
RUN bun run build

ENV T3CODE_HOST=0.0.0.0
ENV T3CODE_PORT=3773
EXPOSE 3773

CMD ["bun", "run", "--cwd", "apps/server", "start", "--", "--host", "0.0.0.0", "--port", "3773", "--no-browser"]