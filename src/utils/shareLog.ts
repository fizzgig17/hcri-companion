// src/utils/shareLog.ts
//
// Gets the debug log (including any raw hex dumps takeMeasurement.ts/
// MeterConnection.ts logged, if Verbose Logging was turned on in Settings
// at the time -- see HomeScreen.tsx's appendLog) off the phone and to the
// developer, without assuming the phone has any particular app installed.
//
// Originally this opened a mailto: link, but that silently fails on any
// phone with no mail app configured (increasingly common -- lots of people
// only use email through a browser). Using the OS share sheet instead
// works everywhere: it hands the text to whatever the phone actually has
// (Messages, WhatsApp, Drive, Bluetooth, Gmail if it IS installed, or a
// plain "copy to clipboard" -- Android always offers that one), and the
// user picks whichever is easiest for them in the moment.

import { Share, Alert } from 'react-native';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';

const DEVELOPER_EMAIL = 'marc.getter@gmail.com';

// Only the text FALLBACK is capped now (see shareDebugLog): the normal path shares a .txt FILE, which has
// no size limit (the share Intent carries just a content:// URI). Sending the log as message text hit
// Android's ~1MB Binder limit and froze the app for minutes at ~300k characters, so the fallback stays at the
// 100k that always worked, and keeps the END of the log (the most recent lines matter most).
const MAX_BODY_CHARS = 100000;

// Files written by a previous share, deleted at the START of the next one (not right after sharing: the
// receiving app may still be reading it) -- same approach as shareCsv.ts.
const pendingCleanup = new Set<string>();

export async function shareDebugLog(log: string[], context?: { deviceName?: string }): Promise<void> {
  const header = [
    'hCRI Companion debug report',
    context?.deviceName ? `Device: ${context.deviceName}` : null,
    `Sent: ${new Date().toISOString()}`,
    `(Send to ${DEVELOPER_EMAIL} if using email)`,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  // Preferred: share the whole log as a .txt file.
  for (const stale of pendingCleanup) RNFS.unlink(stale).catch(() => {});
  pendingCleanup.clear();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `hCRICompanion_debug_log_${stamp}.txt`;
  const path = `${RNFS.CachesDirectoryPath}/${filename}`;
  try {
    await RNFS.writeFile(path, header + log.join('\n'), 'utf8');
    await RNShare.open({
      url: `file://${path}`,
      type: 'text/plain',
      filename, // iOS-only hint
      subject: 'hCRI Companion debug report',
      failOnCancel: false,
    });
    pendingCleanup.add(path);
    return;
  } catch (e: any) {
    RNFS.unlink(path).catch(() => {});
    if (e?.message && /cancel/i.test(e.message)) return; // user dismissed the share sheet
    // Anything else: fall through to sharing the (capped) text instead.
  }

  let body = header + log.join('\n');
  if (body.length > MAX_BODY_CHARS) {
    const omitted = body.length - MAX_BODY_CHARS;
    body = body.slice(-MAX_BODY_CHARS); // keep the END -- most recent lines matter most
    body = `[...${omitted} earlier characters truncated...]\n` + body;
  }

  try {
    await Share.share(
      {
        title: 'hCRI Companion debug report',
        message: body,
      },
      {
        // iOS-only: pre-fills the subject line for mail apps that pick it up
        // from the share sheet. No effect on Android, harmless to include.
        subject: 'hCRI Companion debug report',
      }
    );
  } catch (e: any) {
    Alert.alert('Could not share log', e.message ?? String(e));
  }
}
