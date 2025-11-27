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

	// Router/gRPC dependencies
	golang.org/x/sync v0.18.0
	google.golang.org/grpc v1.77.0
	google.golang.org/protobuf v1.36.10
)

require (
	github.com/google/renameio/v2 v2.0.0 // indirect
	github.com/landlock-lsm/go-landlock v0.0.0-20250303204525-1544bccde3a3 // indirect
	github.com/mmcloughlin/md4 v0.1.2 // indirect
	golang.org/x/net v0.47.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
	golang.org/x/text v0.31.0 // indirect
	golang.org/x/time v0.3.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251124214823-79d6a2a48846 // indirect
	kernel.org/pub/linux/libs/security/libcap/psx v1.2.76 // indirect
)
