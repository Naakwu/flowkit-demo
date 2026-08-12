# Opt-in FlowKit demo mode for k3s (TILT_MODE=flowkit-k3s).
# The root Tiltfile loads this only when TILT_MODE=flowkit-k3s.

load('ext://helm_resource', 'helm_resource', 'helm_repo')

# Builds only the FlowKit demo image and wires the flowkit-* resources.
def configure_flowkit_k3s():
    registry = os.getenv('FLOWKIT_K3S_REGISTRY', 'docker.pigstycoders.com/flowkit-demo-dev')
    namespace = os.getenv('FLOWKIT_K3S_NAMESPACE', 'flowkit-demo-dev')
    temporal_chart_version = os.getenv('TEMPORAL_HELM_CHART_VERSION', '1.2.0')
    target_platform = os.getenv('K3S_PLATFORM', 'linux/amd64')

    allow_k8s_contexts(os.getenv('K3S_TILT_CONTEXT', 'default'))

    docker_build(
        registry + '/flowkit-demo',
        '.',
        dockerfile='packages/flowkit-demo/Dockerfile',
        platform=target_platform,
    )

    k8s_yaml(kustomize('deploy/k8s/overlays/k3s-dev'))

    # Temporal is installed through its upstream chart because it ships
    # lifecycle hooks that should be handled by Helm, not plain YAML.
    # The helm_repo extension creates a local resource named after the repo
    # (resource_name), distinct from the 'temporal' helm_resource below.
    helm_repo('temporal', 'https://go.temporal.io/helm-charts', resource_name='temporal-repo')
    helm_resource(
        'temporal',
        'temporal/temporal',
        namespace=namespace,
        flags=[
            '--version=%s' % temporal_chart_version,
            '--values=deploy/k8s/temporal/values-k3s-dev.yaml',
        ],
        resource_deps=['postgres'],
    )

    k8s_resource('postgres')
    k8s_resource('mailpit')
    k8s_resource('flowkit-migration', resource_deps=['postgres'], auto_init=False)
    k8s_resource('flowkit-seed', resource_deps=['flowkit-migration'], auto_init=False)
    k8s_resource('flowkit-api', resource_deps=['flowkit-seed', 'temporal', 'flowkit-temporal-namespace'])
    k8s_resource('flowkit-worker', resource_deps=['flowkit-seed', 'temporal', 'flowkit-temporal-namespace'])
    k8s_resource('flowkit-notify', resource_deps=['flowkit-seed', 'mailpit'])

    local_resource(
        'k3s-preflight',
        cmd='./deploy/scripts/validate-k3s-target.sh',
        deps=['deploy/scripts/validate-k3s-target.sh', 'deploy/k8s/overlays/k3s-dev'],
        auto_init=True,
        allow_parallel=False,
    )
