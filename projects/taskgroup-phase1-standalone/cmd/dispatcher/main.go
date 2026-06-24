package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"strings"

	"example.com/taskgroup-phase1-standalone/pkg/bridge"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func main() {
	var addr string
	var stateBackend string
	var stateNamespace string
	var agentToken string
	var agentTokenFile string
	flag.StringVar(&addr, "listen-address", ":8090", "HTTP listen address")
	flag.StringVar(&stateBackend, "state-backend", "configmap", "dispatcher state backend: configmap or memory")
	flag.StringVar(&stateNamespace, "state-namespace", os.Getenv("POD_NAMESPACE"), "namespace for dispatcher state objects")
	flag.StringVar(&agentToken, "agent-token", "", "bearer token required on agent endpoints")
	flag.StringVar(&agentTokenFile, "agent-token-file", "", "file containing bearer token required on agent endpoints")
	flag.Parse()

	server := newServer(stateBackend, stateNamespace)
	if token := readToken(agentToken, agentTokenFile); token != "" {
		server.SetAgentToken(token)
	}
	log.Printf("dispatcher listening on %s", addr)
	if err := http.ListenAndServe(addr, server.ControlHandler()); err != nil {
		log.Fatalf("run dispatcher: %v", err)
	}
}

func newServer(stateBackend string, stateNamespace string) *bridge.DispatcherServer {
	if stateBackend == "memory" {
		return bridge.NewDispatcherServer()
	}
	if err := bridge.ValidateConfigMapStoreNamespace(stateNamespace); err != nil {
		log.Fatalf("invalid dispatcher state config: %v", err)
	}
	scheme := runtime.NewScheme()
	utilruntime.Must(corev1.AddToScheme(scheme))
	kubeClient, err := client.New(ctrl.GetConfigOrDie(), client.Options{Scheme: scheme})
	if err != nil {
		log.Fatalf("create dispatcher state client: %v", err)
	}
	return bridge.NewDispatcherServerWithStore(bridge.NewConfigMapStore(kubeClient, stateNamespace))
}

func readToken(token string, tokenFile string) string {
	if tokenFile == "" {
		return strings.TrimSpace(token)
	}
	data, err := os.ReadFile(tokenFile)
	if err != nil {
		log.Fatalf("read agent token file: %v", err)
	}
	return strings.TrimSpace(string(data))
}
