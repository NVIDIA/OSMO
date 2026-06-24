FROM alpine:3.20 AS certs

FROM scratch AS workflow-controller
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY dist/linux_amd64/workflow-controller /app
USER 65532:65532
ENTRYPOINT ["/app"]

FROM scratch AS dispatcher
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY dist/linux_amd64/dispatcher /app
USER 65532:65532
ENTRYPOINT ["/app"]

FROM scratch AS taskgroup-controller
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY dist/linux_amd64/taskgroup-controller /app
USER 65532:65532
ENTRYPOINT ["/app"]

FROM scratch AS compute-agent
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY dist/linux_amd64/compute-agent /app
USER 65532:65532
ENTRYPOINT ["/app"]

FROM scratch AS taskgroup-apiserver
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY dist/linux_amd64/taskgroup-apiserver /app
USER 65532:65532
ENTRYPOINT ["/app"]

FROM scratch AS osmo-spike
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY dist/linux_amd64/osmo-spike /app
USER 65532:65532
ENTRYPOINT ["/app"]
