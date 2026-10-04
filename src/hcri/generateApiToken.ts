// src/hcri/generateApiToken.ts
//
// Lets Settings mint a brand-new hCRI.io API token from inside the app,
// instead of making someone copy one over by hand from Profile -> API on
// the website. Two calls, chained:
//
//   1. POST /api/auth/login   {email, password} -> a short-lived (7-day)
//      session JWT (see spd's api/auth/login.php -- "email" also accepts a
//      plain username, matched case-insensitively against users.name).
//   2. POST /api/tokens       Bearer <session JWT>, {name} -> a brand-new,
//      long-lived API token (api/tokens.php) -- the SAME kind of token
//      Profile -> API already issues, and the only thing this app has ever
//      actually used for uploads (see uploadToHcri.ts).
//
// The session JWT from step 1 is only ever held in a local variable here,
// just long enough to make step 2's one request -- it's never returned,
// logged, or stored anywhere. Same for the password: it's a parameter to
// this function and nothing else, never persisted, never included in any
// log line (see maskSecret usage below, same spirit as uploadToHcri.ts).

import { HCRI_API_BASE } from './apiConfig';
import { maskSecret } from '../utils/maskSecret';

const LOGIN_URL = `${HCRI_API_BASE}/index.php/api/auth/login`;
const TOKENS_URL = `${HCRI_API_BASE}/index.php/api/tokens`;

export interface GeneratedToken {
  /** The account's canonical name/email, as hCRI.io itself reports it -- not necessarily byte-identical to whatever was typed into the username/email field (case, email vs. display name, etc.). */
  username: string;
  /** The new API token's plaintext value -- shown by the server exactly once, at creation. */
  token: string;
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    // Not JSON -- most likely an HTML error page (a PHP fatal, a proxy
    // error page, etc.). Surface the raw text rather than a confusing
    // "Unexpected token <" parse error.
    throw new Error(text || `Unexpected response (${response.status})`);
  }
}

/**
 * Logs in with an hCRI.io username/email + password, then immediately uses
 * that session to mint a new, named API token. Throws with a message
 * that's safe to show directly in an Alert on any failure (wrong
 * password, disabled account, server unreachable, etc.).
 */
export async function generateApiToken(
  usernameOrEmail: string,
  password: string,
  tokenName: string,
  log?: (msg: string) => void
): Promise<GeneratedToken> {
  log?.(`POST ${LOGIN_URL} email="${usernameOrEmail}"`);

  const loginRes = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: usernameOrEmail, password }),
  });
  const loginData = await readJson(loginRes);
  if (!loginRes.ok) {
    throw new Error(loginData.error || `Login failed (${loginRes.status})`);
  }
  const sessionToken = loginData.token;
  if (!sessionToken) throw new Error('Login succeeded but no session token was returned.');

  // Prefer the server's own record of who this is -- login.php matches
  // email OR name case-insensitively, so what the person typed may not be
  // the canonical form (e.g. they typed their username in a different
  // case, or typed their email when the account's display name differs).
  const resolvedUsername: string = loginData.user?.name || loginData.user?.email || usernameOrEmail;

  log?.(`POST ${TOKENS_URL} name="${tokenName}" (as ${resolvedUsername})`);

  const tokenRes = await fetch(TOKENS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ name: tokenName }),
  });
  const tokenData = await readJson(tokenRes);
  if (!tokenRes.ok) {
    throw new Error(tokenData.error || `Could not create a token (${tokenRes.status})`);
  }
  const plainToken = tokenData.token;
  if (!plainToken) throw new Error('Token was created but the server did not return its value.');

  log?.(`Created token ${maskSecret(plainToken)} for ${resolvedUsername}`);

  return { username: resolvedUsername, token: plainToken };
}
