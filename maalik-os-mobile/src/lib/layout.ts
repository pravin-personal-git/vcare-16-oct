import { useEffect, useState } from 'react';
import { refreshMe } from './api';
import { loadAccess, withDefaults, OPEN_ACCESS, type AppAccess } from './access';
import { useT } from '@/i18n/I18nProvider';
import { LARGE_TEXT, setTextScale } from '@/theme/textScale';

/**
 * The person's phone layout (13 Oct 2026, Settings > Roles > Phone app >
 * Layout), applied: large text and the layout's language for the simple
 * field-worker app (decision 7). Reads the saved copy first so nothing
 * flickers, then the server's, which the owner may have changed since.
 * `fresh` is false until the server has answered.
 */
export function applyLayout(a: AppAccess) {
  setTextScale(a.layout.preset === 'simple' && a.layout.textSize === 'large' ? LARGE_TEXT : 1);
}

export function useLayout(): { access: AppAccess; fresh: boolean } {
  const { applyLayoutLang } = useT();
  const [access, setAccess] = useState<AppAccess>(OPEN_ACCESS);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    let live = true;
    const use = (a: AppAccess) => {
      if (!live) return;
      setAccess(a);
      applyLayout(a);
      if (a.layout.preset === 'simple') applyLayoutLang(a.layout.lang);
    };
    void loadAccess().then(use);
    refreshMe().then((s) => {
      if (s?.kind === 'user' && s.app) use(withDefaults(s.app));
      if (live) setFresh(true);
    }).catch(() => { if (live) setFresh(true); });
    return () => { live = false; };
  }, [applyLayoutLang]);
  return { access, fresh };
}
