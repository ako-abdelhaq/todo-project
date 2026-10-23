kubectl -n argocd delete secret argocd-initial-admin-secret \
  --ignore-not-found

sleep 2

kubectl -n argocd patch secret argocd-secret \
  --type=merge \
  -p '{"data":{"admin.password":null,"admin.passwordMtime":null}}'

sleep 1

kubectl -n argocd rollout restart deployment argocd-server

sleep 15

kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
echo

echo "kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
echo
"
