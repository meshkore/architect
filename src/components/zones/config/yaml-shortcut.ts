import { mcAlert } from '~/lib/modal';

export const CLUSTER_YAML = '.meshkore/public/cluster.yaml';
export const ARCHITECT_TOKEN = '.meshkore/credentials/architect-token';

export function editYaml(title: string, body?: string): () => void {
  return () => void mcAlert(
    body ?? `Open ${CLUSTER_YAML} in your editor. The daemon picks up changes automatically via its file-watcher and rebuilds state.json.`,
    { title },
  );
}
