FROM rust:1.88-slim-bookworm AS builder
ENV PATH="/usr/local/cargo/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends build-essential protobuf-compiler pkg-config ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock* build.rs ./
COPY proto ./proto
RUN mkdir src && printf 'fn main() {}\n' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/osmo-rust-spike /usr/local/bin/osmo-rust-spike
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/osmo-rust-spike"]
