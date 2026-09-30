// src/utils/shareLog.ts
//
// Gets the debug log (including any raw hex dumps takeMeasurement.ts
// logged) off the phone and to the developer, without assuming the phone
// has any particular app installed.
//
// Originally this opened a mailto: link, but that silently fails on any
// phone with no mail app configured (increasingly common -- lots of people
// only use email through a browser). Using the OS share sheet instead
// works everywhere: it hands the text to whatever the phone actually has
// (Messages, WhatsApp, Drive, Bluetooth, Gmail if it IS installed, or a
// plain "copy to clipboard" -- Android always offers that one), and the
// user picks whichever is easiest for them in the moment.

import { Share, Alert } from 'react-native';

const DEVELOPER_EMAIL = 'marc.getter@gmail.com';

// Android's share intent (ACTION_SEND) can carry far more than a mailto:
// URL ever could -- the real ceiling is the OS's ~1MB binder transaction
// limit for the whole Intent, not anything share-sheet-specific. Some
// individual targets (SMS in particular) cap much lower and will just
// truncate or reject a huge message themselves, but that's on them to
// handle, same as it would be for a photo or any other oversized share --
// it's not something to pre-truncate down to a few thousand chars for
// every target. 100k safely leaves enormous headroom under the binder
// limit while comfortably fitting even a very large multi-reading debug
// log with several hex dumps in it.
const MAX_BODY_CHARS = 100000;

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
