import { Alert } from 'react-native';
import { router } from 'expo-router';
import { signOut } from './api';
import { refreshCounts, waiting } from './outbox';
import { pendingJobSteps } from './jobQueue';
import { pendingUploads } from './uploads';

/**
 * Sign out, asking first when changes made on this phone have not reached the
 * office yet (F-13, 13 Oct 2026): signing out wipes the phone's copy, and a
 * queued Work done or voice note would be lost with it.
 */
export async function confirmSignOut(t: (s: string) => string) {
  const n = (await waiting()).length + (await pendingJobSteps()).length + (await pendingUploads()).length;
  const go = async () => { await signOut(); void refreshCounts(); router.replace('/welcome'); };
  if (!n) { await go(); return; }
  Alert.alert(
    t('Changes not sent yet'),
    t(`${n} change(s) made on this phone have not reached the office. Signing out now loses them. Go online first to send them.`),
    [
      { text: t('Stay signed in'), style: 'cancel' },
      { text: t('Sign out anyway'), style: 'destructive', onPress: () => { void go(); } },
    ],
  );
}
