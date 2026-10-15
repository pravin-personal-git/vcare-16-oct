import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * THE EXPO TOKEN THIS PHONE REGISTERED (F-05, 10 Oct 2026).
 *
 * Kept so sign-out can tell the server which phone just emptied. Without it
 * the server has no way to know: Expo neither knows nor cares whether an app
 * has a session, so Urgent alerts went on arriving with their real title and
 * body on a phone nobody was signed into - "Approval waiting - invoice
 * INV-BR001-2026-0042, Rs 4,38,000, Sharma Traders" on the lock screen of a
 * phone in anybody's hand. Now the row is marked `signedOut` and the server
 * sends the knock with nothing in it.
 *
 * ITS OWN KEY, not a field on the session, for two reasons. The session is
 * cleared BEFORE the logout request goes out, so reading it from there would
 * come back empty at the one moment it matters. And this token belongs to the
 * PHONE, not to whoever is signed in on it - it outlives the session and is
 * the same token when the next person signs in.
 *
 * Its own FILE because `lib/push` imports `authed` from `lib/api`, and
 * `lib/api` needs this at sign-out: putting it in either one makes a cycle.
 */

const KEY = 'maalik.pushToken.v1';

export async function rememberPushToken(token: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(KEY, token).catch(() => undefined);
}

/** The token this phone registered, for the sign-out call. Null when never registered. */
export async function registeredPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(KEY).catch(() => null);
}
