module go.corp.nvidia.com/osmo

go 1.24.3

require (
	// Runtime dependencies
	github.com/conduitio/bwlimit v0.1.0
	github.com/creack/pty v1.1.18
	github.com/gokrazy/rsync v0.0.0-20250601185929-d3cb1d4a4fcd
	github.com/google/shlex v0.0.0-20191202100458-e7afc7fbc510
	github.com/gorilla/websocket v1.5.0
	gopkg.in/yaml.v3 v3.0.1

	// Service dependencies (authz_sidecar)
	github.com/envoyproxy/go-control-plane v0.12.0
	github.com/lib/pq v1.10.9
	google.golang.org/genproto/googleapis/rpc v0.0.0-20231212172506-995d672761c0
	google.golang.org/grpc v1.60.1
)

require (
	// Runtime indirect dependencies
	github.com/google/renameio/v2 v2.0.0 // indirect
	github.com/landlock-lsm/go-landlock v0.0.0-20250303204525-1544bccde3a3 // indirect
	github.com/mmcloughlin/md4 v0.1.2 // indirect
	golang.org/x/sync v0.13.0 // indirect
	golang.org/x/time v0.3.0 // indirect
	kernel.org/pub/linux/libs/security/libcap/psx v1.2.76 // indirect

	// Service indirect dependencies
	github.com/census-instrumentation/opencensus-proto v0.4.1 // indirect
	github.com/cncf/xds/go v0.0.0-20231128003011-0fa0005c9caa // indirect
	github.com/envoyproxy/protoc-gen-validate v1.0.4 // indirect
	github.com/golang/protobuf v1.5.3 // indirect
	golang.org/x/net v0.19.0 // indirect
	golang.org/x/sys v0.32.0 // indirect
	golang.org/x/text v0.14.0 // indirect
	google.golang.org/protobuf v1.31.0 // indirect
)
