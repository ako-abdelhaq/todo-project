k3d cluster create --agents 2 -p 3080:8080@loadbalancer -p "8081:80@loadbalancer" --port 8082:30080@agent:0 --k3s-arg '--disable=traefik@server:0'
kubectl apply --server-side -f https://github.com/envoyproxy/gateway/releases/latest/download/install.yaml
kubectl -n envoy-gateway-system rollout status deployment/envoy-gateway --timeout=180s
docker exec k3d-k3s-default-agent-0 sh -c "mkdir -p /tmp/kube/staging"
docker exec k3d-k3s-default-agent-0 sh -c "mkdir -p /tmp/kube/production"