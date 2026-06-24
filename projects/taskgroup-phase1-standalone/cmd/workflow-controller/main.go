package main

import (
	"flag"
	"log"

	workflowv1alpha1 "example.com/taskgroup-phase1-standalone/api/workflow/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/bridge"
	"example.com/taskgroup-phase1-standalone/pkg/dispatcher"

	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"
)

func main() {
	var clusterID string
	var dispatcherURL string
	var metricsAddr string
	flag.StringVar(&clusterID, "cluster-id", "compute-a", "compute cluster id")
	flag.StringVar(&dispatcherURL, "dispatcher-url", "http://dispatcher:8090", "control-plane dispatcher URL")
	flag.StringVar(&metricsAddr, "metrics-bind-address", ":8081", "metrics bind address")
	flag.Parse()
	ctrl.SetLogger(zap.New(zap.UseDevMode(true)))

	controlScheme := runtime.NewScheme()
	utilruntime.Must(workflowv1alpha1.AddToScheme(controlScheme))
	mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
		Scheme: controlScheme,
		Metrics: metricsserver.Options{
			BindAddress: metricsAddr,
		},
	})
	if err != nil {
		log.Fatalf("create control manager: %v", err)
	}

	otgClient := bridge.NewHTTPClient(dispatcherURL)
	reconciler := dispatcher.NewWorkflowReconciler(mgr.GetClient(), otgClient, dispatcher.DefaultPlanners())
	if err := reconciler.SetupWithManager(mgr); err != nil {
		log.Fatalf("setup workflow controller: %v", err)
	}
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		log.Fatalf("run manager: %v", err)
	}
}
