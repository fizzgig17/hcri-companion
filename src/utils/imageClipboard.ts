// src/utils/imageClipboard.ts
//
// Copy / save a PNG for the share card.
//  - iOS: the clipboard module's setImage (base64), and the share sheet's "Save Image" for saving.
//  - Android: the small native ImageClipboard module (android/.../ImageClipboardModule.kt): copyPng puts the image on
//    the clipboard through the app's FileProvider; savePng writes it to Pictures/hCRI through MediaStore.

import { NativeModules, Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';

const native: {
  copyPng(path: string): Promise<void>;
  savePng(path: string, name: string): Promise<string>;
} | undefined = Platform.OS === 'android' ? NativeModules.ImageClipboard : undefined;

/** Writes the PNG (base64) to the cache folder and returns its path. */
export async function writeCardPng(base64: string, name: string): Promise<string> {
  const path = `${RNFS.CachesDirectoryPath}/${name}`;
  await RNFS.writeFile(path, base64, 'base64');
  return path;
}

/** Puts the image on the clipboard. Throws if this build can't (an Android build without the native module). */
export async function copyCardImage(base64: string, name: string): Promise<void> {
  if (Platform.OS === 'ios') {
    Clipboard.setImage(base64);
    return;
  }
  if (!native) throw new Error('Copying images is not available in this build.');
  const path = await writeCardPng(base64, name);
  await native.copyPng(path);
}

/** "saved" = in the Pictures folder (Android); "shared" = went through the share sheet (iOS: Save Image there). */
export async function saveCardImage(base64: string, name: string): Promise<'saved' | 'shared' | 'cancelled'> {
  const path = await writeCardPng(base64, name);
  if (native) {
    try {
      await native.savePng(path, name);
      return 'saved';
    } catch {
      // Older Android: fall through to the share sheet.
    }
  }
  try {
    await RNShare.open({ url: `file://${path}`, type: 'image/png', filename: name });
    return 'shared';
  } catch (e: any) {
    if (String(e?.message ?? e).includes('did not share')) return 'cancelled';
    throw e;
  }
}
