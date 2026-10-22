kubectl create namespace project-monitoring

cd ./monitoring 

helm upgrade --install prom prometheus-community/prometheus   --namespace project-monitoring   --create-namespace   --values prom-values.yml

helm upgrade --install loki grafana/loki   --namespace project-monitoring   --values loki-values.yml

helm upgrade --install k8smon grafana/k8s-monitoring \
  --namespace project-monitoring \
  --values alloy-values.yml

helm upgrade --install grafana grafana/grafana \
  --namespace project-monitoring \
  --values grafana-values.yml

echo "Everything is set up correctly "

echo "kubectl port-forward --namespace project-monitoring svc/grafana 2000:80"

cd ..