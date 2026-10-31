// src/utils/fileName.ts
//
// A file name made from a title that may hold accented letters (Kōsen, Müller): the accents are dropped (ō -> o) rather than
// the whole letter turning into an underscore, and anything else that is not safe in a file name becomes an underscore.
export function asciiFileName(title: string, keep = '._-'): string {
  let t = title;
  try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch { /* older engines: just the plain replace below */ }
  return t.replace(new RegExp(`[^a-zA-Z0-9${keep.replace(/[-\\\]]/g, '\\$&')}]+`, 'g'), '_');
}
