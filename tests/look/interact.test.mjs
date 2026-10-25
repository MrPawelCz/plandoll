// The built page keeps answering after its first frames: a tap on a mood button and a drag of the time-of-day slider change the
// picture (tools/interact.mjs: headless Chrome with a phone screen and touch input, software GL, so this takes a minute or two).
// It starts a browser, so it only runs on request: PLANDOLL_BROWSER_TESTS=1 (and PLANDOLL_REQUIRE_CHROME=1 makes a missing
// browser an error instead of a skip). Run one browser at a time on a small machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chrome, chromeSkip } from '../helpers/chrome.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const skip = process.env.PLANDOLL_BROWSER_TESTS === '1' ? chromeSkip : 'set PLANDOLL_BROWSER_TESTS=1 to run the browser check';

test('taps and the slider change the picture after the first frames', { skip, timeout: 900_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'plandoll-interact-'));
  try {
    const built = spawnSync(process.execPath, [join(root, 'tools/build.mjs'), '--out', dir], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const args = [join(root, 'tools/interact.mjs'), '--html', join(dir, 'plandoll.html'), '--size', '360x640', '--scale', '2', '--hash', 'frames=2', '--timeout', '300'];
    const res = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24, timeout: 800_000, env: { ...process.env, CHROME: chrome } });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`.slice(-3000));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
