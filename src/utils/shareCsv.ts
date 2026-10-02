// src/utils/shareCsv.ts
//
// Shares CSV content as a real .csv FILE through the OS share sheet, via
// react-native-share + react-native-fs.
//
// Used to share as plain text (Share.share({ message })) instead -- simpler
// (no extra native deps), but that routes the entire CSV through the share
// Intent's extras on Android, which hits the Binder transaction size limit
// (~1MB, shared across everything in that transaction, so it bites well
// before 1MB of actual text). Past that limit the OS just fails to launch
// the chooser -- no JS exception, no native crash visible to the user,
// Share.share's promise never rejects -- it just silently does nothing.
// That's exactly what "Share All as CSV" hit once history had enough
// readings in it (single-reading shares stayed small enough to not usually
// trip it, but could in principle too). Writing to a temp file and sharing
// *that* sidesteps the limit entirely -- the share Intent only ever carries
// a content:// URI, never the payload itself -- and as a bonus actually
// produces a real downloadable/saveable .csv file instead of a pasted text
// blob.
//
// react-native-fs needs native linking (autolinked on RN >= 0.60, but a
// fresh `npm install` here still means: run `pod install` under ios/ before
// the next iOS build; Android just needs a rebuild, no extra step).

import { Alert } from 'react-native';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';
import { MeterResult } from '../ble/parseResult';
import { buildCsv, buildCombinedCsv } from '../hcri/buildCsv';

function sanitizeFilename(label: string): string {
  return label.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'reading';
}

// Paths written by a previous call, cleaned up at the START of the next
// call rather than right after sharing. RNShare.open's promise resolves as
// soon as the share sheet Intent is launched on Android, NOT once the
// receiving app (Gmail, Drive, whatever the person picks) has actually
// finished reading the file -- deleting it in a `finally` right after that
// resolve raced the receiving app and could hand it a file that's already
// gone. Deleting it just before the NEXT export instead guarantees whatever
// app the person shared to already had plenty of time to read it.
const pendingCleanup = new Set<string>();

async function shareCsvFile(csv: string, filename: string): Promise<void> {
  for (const stale of pendingCleanup) {
    RNFS.unlink(stale).catch(() => {});
  }
  pendingCleanup.clear();

  // RNFS.CachesDirectoryPath, not DocumentDirectoryPath -- this is a
  // throwaway export file, not app data worth backing up or keeping around;
  // the OS is free to clear it under storage pressure.
  const path = `${RNFS.CachesDirectoryPath}/${filename}`;
  try {
    await RNFS.writeFile(path, csv, 'utf8');
    await RNShare.open({
      url: `file://${path}`, // react-native-share accepts a file:// path on both platforms
      type: 'text/csv',
      filename, // iOS-only hint; Android derives the name from the file:// path itself
      failOnCancel: false, // user dismissing the share sheet isn't an error
    });
    pendingCleanup.add(path);
  } catch (e: any) {
    // RNShare.open rejects when the user cancels too (unless failOnCancel
    // suppresses that specific case, which it does above) -- anything that
    // still reaches here is a real failure (e.g. couldn't write the temp
    // file), so it's worth surfacing.
    if (e?.message && !/cancel/i.test(e.message)) {
      Alert.alert('Could not share CSV', e.message ?? String(e));
    }
    // Still clean up this attempt's file -- nothing could have read it if
    // we got here.
    RNFS.unlink(path).catch(() => {});
  }
}

export async function shareSingleReadingCsv(result: MeterResult, label: string): Promise<void> {
  await shareCsvFile(buildCsv(result), `${sanitizeFilename(label)}.csv`);
}

export async function shareAllReadingsCsv(
  readings: { label: string; savedAt: number; result: MeterResult }[]
): Promise<void> {
  if (readings.length === 0) {
    Alert.alert('No saved readings', 'Take a reading first -- it gets added to History automatically.');
    return;
  }
  await shareCsvFile(buildCombinedCsv(readings), `hCRICompanion_history_${readings.length}readings.csv`);
}
