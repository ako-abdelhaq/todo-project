source ./create-cluster.sh

source ./install-argo-rollout.sh

source ./monitoring/monitor.sh

source ./argo/argo-install.sh

source ./argo/set-password.sh

kubectl config set-context --current --namespace=project

kubectl apply -f argo/