import { requireContext } from '@/server/context';
import { listChannels } from '@/server/messaging';
import { canStoreSecrets } from '@/server/secret-box';
import { providerChoices } from '@/lib/messaging/registry';
import { MessagingClient } from './MessagingClient';

/** Settings > Email & WhatsApp (workstream D). */
export default async function MessagingSettingsPage() {
  const ctx = await requireContext();

  const email = providerChoices('email');
  const whatsapp = providerChoices('whatsapp');

  // Each branch sends from its own account, so "All Company" has no answer.
  // Shown read-only rather than hidden, so the page is never a dead end.
  if (ctx.scope.kind !== 'single') {
    return (
      <MessagingClient
        email={email} whatsapp={whatsapp} saved={[]}
        canEdit={false} secretsAvailable={canStoreSecrets()}
      />
    );
  }

  const saved = await listChannels(ctx.scope.storeId);

  return (
    <MessagingClient
      email={email}
      whatsapp={whatsapp}
      saved={saved.map((s) => ({
        ...s,
        lastTestedAt: s.lastTestedAt?.toISOString() ?? null,
      }))}
      canEdit={ctx.permissions.has('settings.edit')}
      secretsAvailable={canStoreSecrets()}
    />
  );
}
