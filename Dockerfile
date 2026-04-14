# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY assets ./assets/
COPY templates ./templates/
COPY src ./src/

RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/dms /usr/local/bin/dms
COPY run.sh /app/run.sh
COPY config.yaml /app/config.yaml

RUN addgroup --system --gid 1001 deadman \
    && adduser --system --uid 1001 --ingroup deadman deadman \
    && chmod +x /app/run.sh \
    && chown -R deadman:deadman /app

USER deadman
EXPOSE 3000

ENV RUST_LOG=info

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["/app/run.sh"]
