// src/utils/shareCsv.ts
//
// Shares CSV content through the OS share sheet -- same approach as
// shareLog.ts (Share.share with plain text), not a real .csv FILE
// attachment. React Native's built-in Share API only supports attaching an
// actual file via a `url` on iOS; Android only gets `message` (plain text)
// through this same API, so keeping both platforms consistent means
// sharing the CSV as text rather than a binary attachment. That's enough
// for pasting into Drive/Notes/email/Messages, which covers the common
// "get this off my phone" case -- if you want a literal downloadable .csv
// file (so a Drive share shows up as an actual spreadsheet file object,
// not a text snippet), that needs a new native dependency
// (react-native-share, plus writing to the filesystem first) -- ask if you
// want it upgraded to that.

import { Share, Alert } from 'react-native';
import { MeterResult } from '../ble/parseResult';
import { buildCsv, buildCombinedCsv } from '../hcri/buildCsv';

function sanitizeFilename(label: string): string {
  return label.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'reading';
}

async function shareCsvText(csv: string, filenameHint: string): Promise<void> {
  const header = `(Suggested filename: ${filenameHint})\n\n`;
  try {
    await Share.share(
      { title: filenameHint, message: header + csv },
      {
        // iOS-only: pre-fills the subject line for mail apps that pick it up
        // from the share sheet. No effect on Android, harmless to include.
        subject: filenameHint,
      }
    );
  } catch (e: any) {
    Alert.alert('Could not share CSV', e.message ?? String(e));
  }
}

export async function shareSingleReadingCsv(result: MeterResult, label: string): Promise<void> {
  await shareCsvText(buildCsv(result), `${sanitizeFilename(label)}.csv`);
}

export async function shareAllReadingsCsv(
  readings: { label: string; savedAt: number; result: MeterResult }[]
): Promise<void> {
  if (readings.length === 0) {
    Alert.alert('No saved readings', 'Take a reading first -- it gets added to History automatically.');
    return;
  }
  await shareCsvText(buildCombinedCsv(readings), `hCRICompanion_history_${readings.length}readings.csv`);
}
