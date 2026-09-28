import { deploymentSchema } from './model';
import type { Deployment } from './model';

/** Full immutable identity, never a boxId-only lookup or a redirect to the latest address. */
export function deploymentIdentity(deployment: Deployment): string {
  const d = deploymentSchema.parse(deployment);
  return [d.chainId, d.version, d.address, d.asset, d.intakeAdmin, d.runtimeHash]
    .map((value) => String(value).toLowerCase())
    .join(':');
}

export function registeredGroup(
  config: { GROUP_DEPLOYMENT: Deployment | null; GROUP_PREVIOUS_DEPLOYMENTS: Deployment[] },
  deployment: Deployment,
): boolean {
  const identity = deploymentIdentity(deployment);
  return [config.GROUP_DEPLOYMENT, ...config.GROUP_PREVIOUS_DEPLOYMENTS].some(
    (entry) => entry !== null && deploymentIdentity(entry) === identity,
  );
}
