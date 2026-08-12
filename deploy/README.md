# k3s + Tilt deployment

The original local Docker Compose workflow remains the default:

```sh
tilt up
```

The k3s path requires Tilt, Docker/BuildKit, `kubectl`, Helm 3, and access to
the authenticated registry. The local Compose path does not require Helm.

The hosted registry and k3s are used only when explicitly selecting the opt-in
mode `TILT_MODE=flowkit-k3s` documented below. The legacy `TILT_MODE=k3s`
mode is retired and no longer selects a working workflow.

## FlowKit demo mode

`TILT_MODE=flowkit-k3s` runs the FlowKit demo against k3s instead of the
legacy AVSEC stack:

```sh
export KUBECONFIG=/Users/teopeurt/workspace/k3s/k3s.yaml
export TILT_MODE=flowkit-k3s
tilt up
```

It builds only the `flowkit-demo` image (from
`packages/flowkit-demo/Dockerfile`), applies the Kustomize stack, and installs
Temporal from the upstream Helm chart in the `flowkit-demo-dev` namespace. The
target hostname family is:

- `https://flowkit.k3s.naakwu.app` — FlowKit demo
- `https://mail.flowkit.k3s.naakwu.app` — Mailpit UI (basic auth)
- `https://temporal.flowkit.k3s.naakwu.app` — Temporal UI (basic auth)

## One-time cluster bootstrap

Install cert-manager and create the namespace before starting Tilt. The
namespace is intentionally outside the ordinary Tilt resource graph so `tilt
down` does not remove PVCs or cluster-scoped certificate state.

```sh
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace --set crds.enabled=true

kubectl apply -f deploy/k8s/bootstrap/namespace.yaml
```

Create the registry and runtime secrets using
[`deploy/k8s/examples/README.md`](k8s/examples/README.md), then render and apply
the ClusterIssuer after replacing `${ACME_EMAIL}`. Do not commit rendered
secret files.

Point DNS records for the FlowKit hosts (listed under "FlowKit demo mode") at
the Traefik LoadBalancer address before expecting HTTP-01 certificates to
become ready.

## Safe validation

`deploy/scripts/validate-k3s-target.sh` is read-only and runs automatically as a
Tilt preflight. It verifies the selected context, a Ready node, and all required
secrets. It does not install charts, apply manifests, run migrations, or delete
resources. FlowKit database migrations are managed by the `flowkit-migration`
k8s resource once the user starts the flowkit-k3s Tilt workflow.
