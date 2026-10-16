import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Text } from './ui';
import { Icon } from './Icon';
import { radius, space } from '@/theme/tokens';
import { shrinkPhoto } from '@/lib/shrink';

/**
 * The camera, in two modes: reading a barcode / QR / serial label (`code`),
 * or taking one photo for AI reading of an invoice or visiting card
 * (`photo`). `continuous` keeps the camera open for scanning many serials in
 * a row - each new code is reported once, with a tap on the phone.
 *
 * `facing` and `quality` exist for the attendance selfie (F2.5, D14): the
 * front camera, and a smaller file because that photo may sit in the offline
 * queue for hours before it can be sent. Reused rather than copied so the
 * permission prompt, the Hindi strings and the shutter behave identically
 * everywhere the camera opens.
 */

const TYPES: BarcodeType[] = ['qr', 'code128', 'code39', 'code93', 'ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'datamatrix', 'pdf417', 'codabar'];

export function Scanner({ visible, mode, title, continuous = false, facing = 'back', quality = 0.6, prompt, onCode, onPhoto, onClose, onDeny, count }: {
  visible: boolean; mode: 'code' | 'photo'; title: string; continuous?: boolean;
  facing?: 'back' | 'front'; quality?: number;
  /** What the phone is asking for, when it has to ask for the camera. */
  prompt?: string;
  onCode?: (code: string) => void;
  /** `uri`: the picture on the phone (13 Oct 2026), for uploading it as a file. */
  onPhoto?: (base64: string, uri?: string) => void; onClose: () => void;
  /** The camera was refused. Attendance uses it to clock in anyway, without a photo. */
  onDeny?: () => void;
  count?: number;
}) {
  const { t } = useT();
  const { c } = useTheme();
  const [perm, request] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const seen = useRef<Set<string>>(new Set());
  const last = useRef(0);
  const [busy, setBusy] = useState(false);

  const scanned = (data: string) => {
    const code = data.trim();
    if (!code || Date.now() - last.current < 700) return;
    if (seen.current.has(code)) return;
    seen.current.add(code);
    last.current = Date.now();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    onCode?.(code);
    if (!continuous) { seen.current.clear(); onClose(); }
  };

  const shoot = async () => {
    if (!cam.current || busy) return;
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ base64: true, quality, skipProcessing: false });
      // Made small before anyone gets it (16 Oct 2026) - a full-size photo can be
      // over the website's 4.5 MB limit; if shrinking fails, the original goes.
      const small = pic?.uri ? await shrinkPhoto(pic.uri, { base64: true }) : null;
      const base64 = small?.base64 ?? pic?.base64;
      if (base64) { onPhoto?.(base64, small?.uri ?? pic?.uri); onClose(); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { seen.current.clear(); onClose(); }} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {!perm?.granted ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: c.bg }}>
            <Icon name="camera" size={40} color={c.brand} />
            <Text weight="semibold" align="center">{prompt ?? t('Allow the camera to scan.')}</Text>
            <Button label={t('Allow camera')} onPress={() => void request()} />
            <Button label={t('Cancel')} variant="ghost" onPress={onDeny ?? onClose} />
          </View>
        ) : (
          <>
            <CameraView
              ref={cam}
              style={StyleSheet.absoluteFill}
              facing={facing}
              barcodeScannerSettings={mode === 'code' ? { barcodeTypes: TYPES } : undefined}
              onBarcodeScanned={mode === 'code' ? (r) => scanned(r.data) : undefined}
            />
            <View style={{ position: 'absolute', top: 48, left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Pressable
                accessibilityRole="button" accessibilityLabel={t('Close')}
                onPress={() => { seen.current.clear(); onClose(); }}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="x" size={22} color="#fff" />
              </Pressable>
              <Text weight="semibold" color="#fff" style={{ flex: 1 }}>{title}</Text>
              {continuous && typeof count === 'number' && (
                <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.brand }}>
                  <Text weight="bold" color={c.brandInk}>{count}</Text>
                </View>
              )}
            </View>
            {mode === 'code' ? (
              <View pointerEvents="none" style={{ position: 'absolute', top: '32%', left: '10%', right: '10%', height: 180, borderRadius: radius.lg, borderWidth: 3, borderColor: '#FFFFFFCC' }} />
            ) : (
              <View style={{ position: 'absolute', bottom: 56, left: 0, right: 0, alignItems: 'center' }}>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={t('Take photo')}
                  disabled={busy} onPress={shoot}
                  style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: '#fff', backgroundColor: busy ? '#999' : 'rgba(255,255,255,0.3)' }}
                />
              </View>
            )}
            {mode === 'code' && continuous && (
              <View style={{ position: 'absolute', bottom: 48, left: space.lg, right: space.lg }}>
                <Button label={t('Done')} onPress={() => { seen.current.clear(); onClose(); }} />
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}
