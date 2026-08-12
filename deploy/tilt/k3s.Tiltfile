# Opt-in k3s deployment for FAAN AVSEC ODC.
# The root Tiltfile loads this only when TILT_MODE=k3s.

load('ext://helm_resource', 'helm_resource', 'helm_repo')

def configure_k3s():
    registry = os.getenv('K3S_REGISTRY', 'docker.pigstycoders.com/faan-avsec-dev')
    namespace = os.getenv('K3S_NAMESPACE', 'faan-avsec-dev')
    temporal_chart_version = os.getenv('TEMPORAL_HELM_CHART_VERSION', '1.2.0')
    target_platform = os.getenv('K3S_PLATFORM', 'linux/amd64')

    # k3s.yaml normally names its single context "default". Override this
    # explicitly when the kubeconfig uses a different context name.
    allow_k8s_contexts(os.getenv('K3S_TILT_CONTEXT', 'default'))

    docker_build(
        registry + '/backend',
        'packages',
        dockerfile='packages/faan-avsec-backend/Dockerfile.prod',
        platform=target_platform,
    )
    docker_build(
        registry + '/migration',
        'packages/faan-avsec-backend',
        dockerfile='Dockerfile.atlas',
        platform=target_platform,
    )
    docker_build(
        registry + '/public-web',
        '.',
        dockerfile='deploy/docker/web.Dockerfile',
        build_args={
            'APP_DIR': 'faan-avsec-web',
            'VITE_API_URL': os.getenv('VITE_PUBLIC_API_URL', 'https://api.k3s.faan-avsec.naakwu.app'),
            'VITE_BETTER_AUTH_URL': os.getenv('VITE_BETTER_AUTH_URL', 'https://api.k3s.faan-avsec.naakwu.app'),
        },
        platform=target_platform,
    )
    docker_build(
        registry + '/internal-web',
        '.',
        dockerfile='deploy/docker/web.Dockerfile',
        build_args={
            'APP_DIR': 'faan-avsec-web-internal',
            'VITE_API_URL': os.getenv('VITE_INTERNAL_API_URL', 'https://api.k3s.faan-avsec.naakwu.app'),
            'VITE_BETTER_AUTH_URL': os.getenv('VITE_BETTER_AUTH_URL', 'https://api.k3s.faan-avsec.naakwu.app'),
        },
        platform=target_platform,
    )

    k8s_yaml(kustomize('deploy/k8s/overlays/k3s-dev'))

    k8s_resource('postgres-bootstrap', resource_deps=['postgres'])
    k8s_resource('ministack-bucket', resource_deps=['ministack'])

    # Temporal is installed through its upstream chart because it ships
    # lifecycle hooks that should be handled by Helm, not plain YAML.
    helm_repo('temporal', 'https://go.temporal.io/helm-charts')
    helm_resource(
        'temporal',
        'temporal/temporal',
        namespace=namespace,
        flags=[
            '--version=%s' % temporal_chart_version,
            '--values=deploy/k8s/temporal/values-k3s-dev.yaml',
        ],
        resource_deps=['postgres-bootstrap'],
    )

    k8s_resource('backend', resource_deps=['postgres-bootstrap', 'redis', 'temporal', 'ministack-bucket'])
    k8s_resource('public-web', resource_deps=['backend'])
    k8s_resource('internal-web', resource_deps=['backend'])
    k8s_resource('mailpit')

    local_resource(
        'k3s-preflight',
        cmd='./deploy/scripts/validate-k3s-target.sh',
        deps=['deploy/scripts/validate-k3s-target.sh', 'deploy/k8s/overlays/k3s-dev'],
        auto_init=True,
        allow_parallel=False,
    )
