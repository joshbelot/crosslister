import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Settings } from '../../../shared/types';
import { useSaveSettings, useSettings } from '../../api/hooks';

/** The full Settings object is loaded, edited locally and saved as a whole (04 §10). */
export function useSettingsDraft() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  const baseline = useRef<string>('');

  useEffect(() => {
    if (!data) return;
    if (draft === null || JSON.stringify(draft) === baseline.current) {
      setDraft(data);
    }
    baseline.current = JSON.stringify(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const dirty = draft !== null && JSON.stringify(draft) !== baseline.current;
  return {
    draft, dirty, saving: save.isPending,
    update(patch: (s: Settings) => Settings) { setDraft((d) => (d ? patch(structuredClone(d)) : d)); },
    save() {
      if (!draft) return;
      save.mutate(draft, { onSuccess: (s) => { baseline.current = JSON.stringify(s); setDraft(s); toast.success('Settings saved'); } });
    },
  };
}
export type SettingsDraft = ReturnType<typeof useSettingsDraft>;
