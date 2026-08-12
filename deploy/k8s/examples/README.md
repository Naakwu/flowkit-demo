# k3s secrets

Create these secrets in `faan-avsec-dev` before starting `TILT_MODE=k3s tilt up`.
The commands below read values from environment variables so credentials remain
outside the repository and shell history should be disabled or handled safely.

```sh
kubectl -n faan-avsec-dev create secret docker-registry registry-credentials \
  --docker-server=docker.pigstycoders.com \
  --docker-username="$REGISTRY_USERNAME" --docker-password="$REGISTRY_PASSWORD"

kubectl -n faan-avsec-dev create secret generic postgres-credentials \
  --from-literal=POSTGRES_USER=postgres --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD"

kubectl -n faan-avsec-dev create secret generic temporal-db-credentials \
  --from-literal=password="$TEMPORAL_DB_PASSWORD"

kubectl -n faan-avsec-dev create secret generic redis-credentials \
  --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD"

kubectl -n faan-avsec-dev create secret generic avsec-runtime \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" \
  --from-literal=BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --from-literal=AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" \
  --from-literal=AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

htpasswd -nbB "$OPS_USER" "$OPS_PASSWORD" | kubectl -n faan-avsec-dev create secret generic ops-ingress-auth \
  --from-file=users=/dev/stdin
```

The namespace and cert-manager `ClusterIssuer` are bootstrap resources and are
applied separately. Set `ACME_EMAIL` and substitute it into
`deploy/k8s/bootstrap/cluster-issuer.yaml` before applying it.
