// Shared by the tests that start Chrome: finds a browser and decides whether those tests can run here.
// Without Chrome, or without the global WebSocket (Node 22 and newer), they skip with a reason. When PLANDOLL_REQUIRE_CHROME=1
// (CI sets it on Node 22 and newer) a missing browser is an error instead, so a CI run can never pass by skipping them.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ...['google-chrome', 'chromium', 'chromium-browser'].map((c) => (spawnSync('which', [c]).status === 0 ? c : null))]
  .filter(Boolean).find((c) => !c.includes('/') || existsSync(c));

// Returns false when the Chrome tests can run, otherwise the reason to skip them; throws instead when `required`.
export function chromeSkipReason({ chrome: found, webSocket, required }) {
  const reason = !found ? 'Chrome or Chromium not found' : !webSocket ? 'Node 22 or newer is needed for the global WebSocket' : false;
  if (reason && required) throw new Error(`PLANDOLL_REQUIRE_CHROME=1, but the Chrome tests cannot run here: ${reason}`);
  return reason;
}

export const chromeSkip = chromeSkipReason({ chrome, webSocket: typeof WebSocket !== 'undefined', required: process.env.PLANDOLL_REQUIRE_CHROME === '1' });
