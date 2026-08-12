#!/usr/bin/env bash
set -euo pipefail

: "${KUBECONFIG:?Set KUBECONFIG to the k3s kubeconfig before running Tilt}"

context="$(kubectl config current-context)"
node_count="$(kubectl get nodes --no-headers 2>/dev/null | awk '$2 == "Ready" {count++} END {print count + 0}')"

if [[ "${node_count}" -lt 1 ]]; then
  echo "No Ready k3s node found in context ${context}" >&2
  exit 1
fi

kubectl get namespace faan-avsec-dev >/dev/null
kubectl get secret registry-credentials -n faan-avsec-dev >/dev/null
kubectl get secret postgres-credentials -n faan-avsec-dev >/dev/null
kubectl get secret temporal-db-credentials -n faan-avsec-dev >/dev/null
kubectl get secret redis-credentials -n faan-avsec-dev >/dev/null
kubectl get secret avsec-runtime -n faan-avsec-dev >/dev/null
kubectl get secret ops-ingress-auth -n faan-avsec-dev >/dev/null

echo "k3s target ${context} is ready for Tilt"
