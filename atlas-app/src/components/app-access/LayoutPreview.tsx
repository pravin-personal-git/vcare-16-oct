'use client';


/**
 * A live picture of the phone for Settings > Roles > Phone app > Layout
 * (13 Oct 2026, HANDOFF-2026-10-13 §4.2, demo tab 2): flip a switch and the
 * phone beside it changes, so the owner sees what the technician will see
 * before saving. Drawn from the same keys the phone reads - sample jobs only.
 */
export function LayoutPreview({ get }: { get: (key: string) => string | boolean }) {
  const on = (k: string) => get(k) === true;
  const preset = String(get('layout.preset'));
  const hi = get('layout.lang') !== 'en';
  const large = get('layout.textSize') !== 'normal';
  const t = (en: string, hindi: string) => (hi ? hindi : en);

  if (preset !== 'simple') {
    return (
      <Phone>
        <p className="p-4 text-center text-xs text-muted-foreground">
          {preset === 'web'
            ? 'The whole website inside the app.'
            : 'The app as before: home tiles for each section switched on below, with their own screens.'}
        </p>
      </Phone>
    );
  }

  const filters = [
    on('layout.filter.today') && t('Today', 'आज'),
    on('layout.filter.pending') && t('Pending', 'बाकी'),
    on('layout.filter.week') && t('This week', 'इस हफ्ते'),
    on('layout.filter.all') && t('All', 'सभी'),
  ].filter((x): x is string => !!x);
  const jobs = [
    on('layout.type.complaints') && { tag: t('Complaint', 'शिकायत'), name: 'Sharma Traders', line: t('Camera 3 not recording', 'कैमरा 3 रिकॉर्ड नहीं कर रहा'), late: true },
    on('layout.type.installations') && { tag: t('Installation', 'इंस्टॉलेशन'), name: 'Gupta Residence', line: t('4 cameras + DVR', '4 कैमरे + DVR'), late: false },
    on('layout.type.complaints') && { tag: t('Complaint', 'शिकायत'), name: 'City Hospital', line: t('No display on monitor', 'मॉनिटर पर डिस्प्ले नहीं'), late: false },
  ].filter((x): x is { tag: string; name: string; line: string; late: boolean } => !!x);
  const jobParts = [
    on('layout.job.photo') && t('Photo', 'फोटो'), on('layout.job.voice') && t('Voice note', 'आवाज़ नोट'),
    on('layout.job.parts') && t('Parts', 'पार्ट्स'), on('layout.job.items') && t('Serials', 'सीरियल'),
  ].filter((x): x is string => !!x);
  const extra = [
    on('layout.job.visits') && t('Earlier visits', 'पिछली विज़िट'), on('layout.job.calls') && t('Calls', 'कॉल'),
    on('layout.job.history') && t('History log', 'इतिहास'),
  ].filter((x): x is string => !!x);
  const size = large ? 'text-chip' : 'text-cap';

  return (
    <Phone>
      <div className={`grid gap-2 p-2.5 ${size}`}>
        <p className="font-semibold">{t('My work', 'मेरा काम')}</p>
        <div className="flex flex-wrap gap-1">
          {filters.map((f, i) => (
            <span key={f} className={`rounded-full border px-2 py-0.5 ${i === 0 ? 'border-brand bg-brand/10 text-brand' : 'border-border'}`}>{f}</span>
          ))}
        </div>
        {jobs.length === 0 && <p className="text-muted-foreground">{t('No job types switched on.', 'कोई काम नहीं')}</p>}
        {jobs.map((j) => (
          <div key={j.name} className={`rounded-lg border p-2 ${j.late ? 'border-red-400 bg-red-50 dark:bg-red-950/30' : 'border-border bg-card'}`}>
            <div className="flex items-center justify-between gap-1">
              <span className="font-semibold">{j.name}</span>
              <span className="rounded bg-muted px-1 text-cap">{j.tag}</span>
            </div>
            <p className="text-muted-foreground">{j.line}</p>
            {j.late && <p className="font-semibold text-red-600">{t('Late - visit time passed', 'देर - विज़िट का समय निकल गया')}</p>}
          </div>
        ))}
        <div className="rounded-lg border border-dashed border-border p-2">
          <p className="mb-1 text-cap uppercase tracking-wide text-muted-foreground">{t('Inside a job', 'काम के अंदर')}</p>
          {on('layout.job.callnav') && (
            <div className="mb-1 flex gap-1">
              <span className="flex-1 rounded bg-emerald-600 py-1 text-center text-white">{t('Call', 'कॉल')}</span>
              <span className="flex-1 rounded bg-sky-600 py-1 text-center text-white">{t('Navigate', 'रास्ता')}</span>
            </div>
          )}
          <span className="mb-1 block rounded bg-brand py-1.5 text-center font-semibold text-white">{t('Start travel', 'निकल रहा हूँ')}</span>
          <div className="flex flex-wrap gap-1">
            {jobParts.map((p) => <span key={p} className="rounded border border-border px-1.5">{p}</span>)}
          </div>
          {extra.length > 0 && <p className="mt-1 text-muted-foreground">+ {extra.join(', ')}</p>}
        </div>
      </div>
      <div className="mt-auto grid grid-cols-3 border-t border-border text-center text-cap">
        <span className="py-1.5 font-semibold text-brand">{t('My work', 'मेरा काम')}</span>
        {on('layout.schedule') ? <span className="py-1.5">{t('Schedule', 'शेड्यूल')}</span> : <span />}
        <span className="py-1.5">{t('Me', 'मैं')}</span>
      </div>
    </Phone>
  );
}

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-[30rem] w-[15rem] flex-col overflow-hidden rounded-[1.75rem] border-[6px] border-zinc-800 bg-background shadow-lg" aria-label="Phone preview">
      <div className="h-4 shrink-0 bg-zinc-800" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
