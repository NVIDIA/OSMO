package main

import (
	"flag"
	"log"
	"os"
	"strings"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/agent"

	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func main() {
	var clusterID string
	var dispatcherURL string
	var agentToken string
	var agentTokenFile string
	flag.StringVar(&clusterID, "cluster-id", "compute-a", "compute cluster id")
	flag.StringVar(&dispatcherURL, "dispatcher-url", "http://dispatcher:8090", "control-plane dispatcher URL")
	flag.StringVar(&agentToken, "agent-token", "", "bearer token for dispatcher agent endpoints")
	flag.StringVar(&agentTokenFile, "agent-token-file", "", "file containing bearer token for dispatcher agent endpoints")
	flag.Parse()

	scheme := runtime.NewScheme()
	utilruntime.Must(taskgroupv1alpha1.AddToScheme(scheme))
	kubeClient, err := client.New(ctrl.GetConfigOrDie(), client.Options{Scheme: scheme})
	if err != nil {
		log.Fatalf("create compute client: %v", err)
	}
	remoteAgent := agent.NewRemoteComputeAgent(clusterID, dispatcherURL, kubeClient)
	remoteAgent.SetAgentToken(readToken(agentToken, agentTokenFile))
	if err := remoteAgent.Run(ctrl.SetupSignalHandler()); err != nil {
		log.Fatalf("run compute agent: %v", err)
	}
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
