/**
 * ModelSection — "Client, model & effort" (MemberDetailPanel section 1).
 *
 * Load-bearing UI: the daemon dispatches this member through the CLI,
 * provider, model and effort saved here (multi-CLI ClientDrivers +
 * MPV1), so the four fields are saved together as one PATCH — a partial
 * save could leave a ZAI model id under the Anthropic provider.
 */

import { ClientModelEffortPicker, engineBody, type EngineChoice } from '~/components/team/ClientModelEffortPicker';
import { SectionSaveButton } from '~/components/ui/SectionSaveButton';

export function ModelSection(props: {
  value: EngineChoice;
  onChange: (next: EngineChoice) => void;
  saving: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  return (
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">Client, model &amp; effort</h3>
        <SectionSaveButton
          saving={props.saving}
          onClick={() => props.onSave(engineBody(props.value) as unknown as Record<string, unknown>)}
        />
      </div>
      <ClientModelEffortPicker value={props.value} onChange={props.onChange} />
    </section>
  );
}

export default ModelSection;
