import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { AxiosInstance } from 'axios';
import { registerPushToken, unregisterPushToken } from './eatsApi';

// Foreground display: without this, a push that arrives while the app is
// open and focused is delivered silently with no banner/sound -- the OS
// only shows it for you automatically when the app is backgrounded/closed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensurePushPermissionAndGetToken(): Promise<string | null> {
  // TEMPORARY diagnostic logging while bringing push notifications up --
  // these show in the Metro/terminal output of `expo run:ios`/`expo
  // start`, since there's no in-app UI yet showing registration status.
  // Safe to strip once push is confirmed working end-to-end.
  if (!Device.isDevice) {
    console.log('[push] skipped -- running on a simulator/emulator, not a physical device');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  console.log('[push] existing permission status:', existingStatus);
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    console.log('[push] requested permission, result:', status);
  }
  if (finalStatus !== 'granted') {
    console.log('[push] skipped -- permission not granted (check Settings > ADAR Eats > Notifications on the device)');
    return null;
  }

  // getExpoPushTokenAsync needs the app's EAS project id (app.json's
  // expo.extra.eas.projectId) to mint a token.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  console.log('[push] EAS projectId from app config:', projectId);
  if (!projectId || projectId === 'REPLACE_WITH_EAS_PROJECT_ID') {
    console.log('[push] skipped -- no real EAS project id configured yet');
    return null;
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  console.log('[push] got Expo push token:', tokenResponse.data);
  return tokenResponse.data;
}

/** Registers this device for order-status push notifications while
 *  `accessToken` is set, and unregisters it again when the caller
 *  unmounts (HomeScreen unmounts on sign-out, so this doubles as
 *  sign-out cleanup -- see HomeScreen.tsx). Best-effort throughout: any
 *  failure (permission denied, no EAS project configured yet, network
 *  error) is swallowed so push is additive and never blocks the app. */
export function usePushRegistration(client: AxiosInstance, accessToken: string | undefined) {
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    (async () => {
      try {
        const expoToken = await ensurePushPermissionAndGetToken();
        if (!expoToken || cancelled) return;
        tokenRef.current = expoToken;
        await registerPushToken(client, accessToken, expoToken, Platform.OS);
        console.log('[push] registered token with backend successfully');
      } catch (err) {
        // Best-effort only -- see note above -- but log it (temporary,
        // see note above) since a swallowed error here is otherwise
        // invisible and looks identical to "nothing happened".
        console.log('[push] registration failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      const expoToken = tokenRef.current;
      if (expoToken) {
        unregisterPushToken(client, accessToken, expoToken).catch(() => {});
      }
    };
  }, [client, accessToken]);
}
