module go.corp.nvidia.com/osmo/src/service/router_go

go 1.24.3

require (
	go.corp.nvidia.com/osmo/proto v0.0.0-00010101000000-000000000000
	golang.org/x/sync v0.18.0
	google.golang.org/grpc v1.77.0
	google.golang.org/protobuf v1.36.10
)

replace go.corp.nvidia.com/osmo/proto => ../../../proto

require (
	golang.org/x/net v0.47.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
	golang.org/x/text v0.31.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251124214823-79d6a2a48846 // indirect
)
