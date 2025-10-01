FROM ubuntu:22.04 as builder
RUN apt update && apt install -y apt-transport-https curl gnupg
RUN mkdir -p /etc/apt/keyrings
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
RUN apt update && apt install nodejs -y
RUN mkdir build

# Download sources
COPY next.config.mjs package-lock.json package.json tsconfig.json build/
RUN cd build && npm i

# Build outputs
COPY public /build/public
COPY src /build/src
RUN cd build && npm run build

FROM gcr.io/distroless/nodejs18-debian12 as final
USER nonroot

WORKDIR /app

COPY --from=0 /build/.next/standalone /app
COPY --from=0 /build/.next/static /app/.next/static
COPY --from=0 /build/public /app/public

ENV HOSTNAME 0.0.0.0
ENV NODE_ENV production
CMD ["/app/server.js"]
