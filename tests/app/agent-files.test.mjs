// What the site says about itself to programs (tools/agent-files.mjs): llms.txt, sitemap.xml and the JSON-LD block that tools/build.mjs puts in the head.
// The text is checked against the things it points to (the files of the repository, the README's table of address parameters, the parser of the page), so it
// cannot go stale on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHOR, JSON_LD_BLOCK, PAGES_URL, RAW_URL, REPO_URL, SITE_URL, jsonLd, jsonLdBlock, llmsTxt, otherAddresses, packageVersion, sitemapXml } from '../../tools/agent-files.mjs';
import { parseParams } from '../../src/app/params.js';
import { PRESET_NAMES, presetLabel } from '../../src/look/presets.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const MAKER = { type: 'Organization', name: 'Example Ltd', url: 'https://example.org/' };
const LONG_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');

test('jsonLd: a WebApplication with the address, the version of package.json and the other addresses of the same page', () => {
  const d = jsonLd({ base: PAGES_URL, version: packageVersion() });
  assert.equal(d['@context'], 'https://schema.org');
  assert.equal(d['@type'], 'WebApplication');
  assert.equal(d['@id'], `${PAGES_URL}#app`);
  assert.equal(d.url, PAGES_URL);
  assert.equal(d.name, 'PlanDoll');
  assert.equal(d.softwareVersion, pkg.version);
  assert.equal(d.isAccessibleForFree, true);
  assert.deepEqual(d.offers, { '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  assert.deepEqual(d.inLanguage, ['en', 'pl']);
  assert.deepEqual(d.sameAs, [REPO_URL, SITE_URL], 'the repository and the other address, never itself');
  assert.deepEqual(d.creator, { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url }, 'the repository names its author');
  assert.ok(d.featureList.length >= 5 && d.featureList.every((f) => typeof f === 'string' && f.length > 10 && f.length < 200));
  assert.ok(d.description.length > 60 && d.description.length < 300);
  assert.ok(d.applicationCategory && d.operatingSystem && d.browserRequirements);
});

test('jsonLd: a host names itself and its own address; every address in it is an absolute https address', () => {
  const d = jsonLd({ base: SITE_URL, version: '1.2.3', maker: MAKER, image: `${SITE_URL}og.jpg` });
  assert.equal(d.url, SITE_URL);
  assert.deepEqual(d.creator, { '@type': 'Organization', name: MAKER.name, url: MAKER.url });
  assert.deepEqual(d.sameAs, [REPO_URL, PAGES_URL]);
  assert.equal(d.image, `${SITE_URL}og.jpg`);
  for (const dd of [d, jsonLd({ base: PAGES_URL, version: '1.2.3' })]) {
    const urls = JSON.stringify(dd).match(/https?:\/\/[^"]+/g);
    assert.ok(urls.length >= 6);
    for (const u of urls) assert.match(u, /^https:\/\/[a-z0-9.-]+(\/|$)/, u);
  }
});

test('jsonLd: the words hold no long dash and nothing but the name of the author is outside ASCII; a bad address, maker or version stops it', () => {
  const text = JSON.stringify(jsonLd({ base: PAGES_URL, version: '0.0.1' })).replaceAll(AUTHOR.name, '');
  assert.ok(!LONG_DASH.test(text));
  assert.ok(![...text].some((c) => c.charCodeAt(0) > 126), 'plain ASCII');
  for (const base of ['http://plandoll.com/', 'https://plandoll.com', 'https://plandoll.com/?x=1', 'plandoll.com/', '', undefined, 'https://plandoll.com/#top']) {
    assert.throws(() => jsonLd({ base, version: '1.0.0' }), /address of the site/, String(base));
  }
  for (const maker of [null, { type: 'Robot', name: 'x', url: 'https://x.org/' }, { type: 'Person', name: '', url: 'https://x.org/' }, { type: 'Person', name: 'x', url: 'x.org' }]) {
    assert.throws(() => jsonLd({ base: SITE_URL, version: '1.0.0', maker }), /maker needs/);
  }
  for (const version of ['', undefined, 'x', '1.2']) assert.throws(() => jsonLd({ base: SITE_URL, version }), /not "/, String(version));
});

test('jsonLdBlock: one script element that no text of ours can end early, which reads back as the same data', () => {
  const data = { ...jsonLd({ base: SITE_URL, version: '1.0.0' }), description: 'a </script><script>alert(1)</script> b <!-- c' };
  const block = jsonLdBlock(data);
  assert.match(block, /^<script type="application\/ld\+json">/);
  assert.equal(block.split('</script>').length, 2, 'the block ends once, at its own end');
  assert.ok(!block.includes('<!--'));
  assert.deepEqual(JSON.parse(block.slice(block.indexOf('>') + 1, block.lastIndexOf('</script>'))), data);
  assert.equal(JSON_LD_BLOCK.exec(`<head>${block}</head>`)[0], block);
  assert.ok(!JSON_LD_BLOCK.test('<script>var a = 1;</script>'), 'a plain script is not a description');
});

test('llmsTxt: the layout of llmstxt.org (one title, a summary, headed lists of links), plain ASCII, short', () => {
  for (const text of [llmsTxt({ base: PAGES_URL }), llmsTxt({ base: SITE_URL, maker: MAKER })]) {
    assert.match(text, /^# PlanDoll\n\n> \S/);
    assert.equal(text.match(/^# /gm).length, 1, 'one title');
    assert.deepEqual(text.match(/^## .*/gm), ['## Use it', '## Plans: instructions and format', '## Optional']);
    assert.ok(![...text].some((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n')), 'plain ASCII, no tab or carriage return');
    assert.ok(text.endsWith('.\n') || text.endsWith('MIT\n'), 'ends with a newline');
    assert.ok(!LONG_DASH.test(text));
    assert.ok(Buffer.byteLength(text) < 6000, `${Buffer.byteLength(text)} bytes`);
    // under a heading every item of a list is a link with an optional note, which is what a parser of the format reads
    const items = text.split(/^## /m).slice(1).flatMap((section) => section.split('\n').filter((l) => l.startsWith('- ')));
    assert.ok(items.length >= 10);
    for (const l of items) assert.match(l, /^- \[[^\]]+\]\(https:\/\/[^\s)]+\)(: .+)?$/, l);
  }
});

test('llmsTxt: names the address it is served from and the other one, and the maker (the author of the repository unless the host passes its own)', () => {
  const own = llmsTxt({ base: PAGES_URL });
  assert.ok(own.includes(`- [PlanDoll](${PAGES_URL}):`));
  assert.ok(own.includes(`(${SITE_URL}): `), 'the other address');
  assert.ok(own.includes('Source and author: MrPawelCz on GitHub, MIT licence.'));
  assert.ok(own.includes(`${PAGES_URL}#plan=duplex-1&amber&floor=0`));
  const host = llmsTxt({ base: SITE_URL, maker: MAKER });
  assert.ok(host.includes(`- [PlanDoll](${SITE_URL}):`));
  assert.ok(host.includes(`(${PAGES_URL}): `));
  assert.ok(host.includes('Made by Example Ltd (https://example.org/). The source is open, MIT licence.'));
  assert.ok(!host.includes('MrPawelCz on GitHub'), 'the host is the maker, not the author');
  assert.ok(!host.includes(`(${SITE_URL}): the same page`), 'never itself as the other address');
  assert.deepEqual(otherAddresses(SITE_URL), [PAGES_URL]);
  assert.deepEqual(otherAddresses('https://example.org/'), [PAGES_URL, SITE_URL]);
});

test('llmsTxt: every link into the repository leads to a file that is there, and the files that matter are linked', () => {
  const text = llmsTxt({ base: PAGES_URL });
  const raw = [...text.matchAll(/\]\((https:\/\/raw\.githubusercontent\.com\/[^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(raw.length >= 8);
  for (const u of raw) {
    assert.ok(u.startsWith(RAW_URL), u);
    assert.ok(existsSync(join(root, u.slice(RAW_URL.length))), `${u} points at a file that is not in the repository`);
  }
  for (const f of ['docs/PROMPT.md', 'docs/PROMPT.pl.md', 'docs/plan-format.md', 'schema/plan.v1.schema.json', 'examples/flat-1.plan.json', 'examples/duplex-1.plan.json']) assert.ok(raw.includes(RAW_URL + f), f);
  assert.ok(text.includes(`(${REPO_URL})`));
});

test('llmsTxt: it does not call two instructions the same while their texts differ, and it says what a link cannot do', () => {
  const text = llmsTxt({ base: PAGES_URL });
  if (read('docs/PROMPT.md') !== read('docs/PROMPT.pl.md')) assert.ok(!/same instruction/i.test(text), 'the Polish instruction is not the English one translated line by line');
  assert.ok(/own always goes in through Load plan/.test(text), 'a plan of the visitor\'s own cannot be put in a link by hand');
  assert.ok(/ui=0 hides all controls and btn=0 the row of buttons, Load plan included/.test(text), 'the two parameters that take Load plan away say so');
  assert.equal(parseParams('plan=my-own-plan').plan.name, 'flat-1', 'a link names one of the examples only: anything else opens the first one');
});

test('llmsTxt: the example link and the parameters it names are the ones the page and the README have', () => {
  const text = llmsTxt({ base: PAGES_URL });
  const p = parseParams('plan=duplex-1&amber&floor=0');
  assert.equal(p.plan.name, 'duplex-1'); assert.equal(p.preset, 'amber'); assert.equal(p.floor, 0);
  assert.deepEqual(PRESET_NAMES.map((n) => presetLabel(n, 'en')), ['Day', 'Sunset', 'Night'], 'the moods in the order of the sentence');
  const moods = PRESET_NAMES.map((n) => `${n} (${presetLabel(n, 'en')})`);
  assert.ok(text.includes(`${moods.slice(0, -1).join(', ')} or ${moods.at(-1)}`), 'the moods with the names the page shows, in the order of the page');
  assert.equal(parseParams('preset=lamplit').preset, 'lamplit', 'preset= works as the text says');
  const readme = read('README.md');
  for (const name of ['plan', 'floor', 'lang', 'intro', 'ui', 'btn', 't']) {
    assert.ok(readme.includes(`| \`${name}\` |`), `the README has no row for ${name}`);
    assert.ok(new RegExp(`(^|[ ,])${name}=`, 'm').test(text), `the text does not use ${name}=`);
  }
  assert.equal(parseParams('intro=0&ui=0&btn=0&lang=pl').ui, false);
  assert.equal(parseParams('intro=0&lang=pl').lang, 'pl');
});

test('sitemapXml: one address, in the namespace of the protocol, and nothing else', () => {
  assert.equal(sitemapXml({ base: SITE_URL }), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://plandoll.com/</loc></url>\n</urlset>\n');
  assert.throws(() => sitemapXml({ base: 'http://plandoll.com/' }), /address of the site/);
  assert.throws(() => sitemapXml(), /address of the site/);
});

test('the tool writes both files for an address, refuses a bad one and says how it is used', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plandoll-agent-files-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [join(root, 'tools/agent-files.mjs'), ...args], { encoding: 'utf8' });
    let r = run('--base', 'https://example.org/play/', '--out', join(dir, 'a'));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(dir, 'a/llms.txt'), 'utf8'), llmsTxt({ base: 'https://example.org/play/' }));
    assert.equal(readFileSync(join(dir, 'a/sitemap.xml'), 'utf8'), sitemapXml({ base: 'https://example.org/play/' }));
    r = run('--out', join(dir, 'b'));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(dir, 'b/llms.txt'), 'utf8'), llmsTxt({ base: PAGES_URL }), 'GitHub Pages unless told otherwise');
    assert.notEqual(run('--base', 'http://example.org/', '--out', join(dir, 'c')).status, 0);
    assert.equal(existsSync(join(dir, 'c')), false, 'nothing is written for a bad address');
    r = run();
    assert.equal(r.status, 2); assert.match(r.stderr, /usage: node tools\/agent-files\.mjs/);
    r = run('--out', join(dir, 'd'), '--base');
    assert.equal(r.status, 2, '--base without its value is a mistake, not a request for the default'); assert.equal(existsSync(join(dir, 'd')), false);
    r = run('--base', '--out', join(dir, 'd'));
    assert.equal(r.status, 2, 'an option that swallows the next option is a mistake too');
    // by a path that goes through a symbolic link the command still does its work
    symlinkSync(join(root, 'tools/agent-files.mjs'), join(dir, 'link.mjs'));
    r = spawnSync(process.execPath, [join(dir, 'link.mjs'), '--out', join(dir, 'e')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(dir, 'e/llms.txt'), 'utf8'), llmsTxt({ base: PAGES_URL }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the built page carries the description once, in the head, before its only script, with the address of GitHub Pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plandoll-agent-build-'));
  try {
    const r = spawnSync(process.execPath, [join(root, 'tools/build.mjs'), '--out', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, 'plandoll.html'), 'utf8');
    assert.equal(html.split('type="application/ld+json"').length, 2, 'one description');
    const block = JSON_LD_BLOCK.exec(html)[0];
    assert.equal(block, jsonLdBlock(jsonLd({ base: PAGES_URL, version: pkg.version })));
    assert.ok(html.indexOf(block) < html.indexOf('</head>') && html.indexOf(block) < html.indexOf('<script>'), 'in the head, before the script');
    assert.equal((html.match(/<script>/g) ?? []).length, 1, 'still one plain script: the overlay of plandoll.com cuts the page at it');
    assert.ok(html.includes('<title>plandoll</title>') && html.includes('<link rel="icon" href="data:,">') && html.includes('img-src data: blob:'), 'the strings the overlay of plandoll.com needs');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the workflow of GitHub Pages writes the two files into the site, and the documents say where they come from', () => {
  assert.ok(/^\s+node tools\/agent-files\.mjs --out site$/m.test(read('.github/workflows/pages.yml')), 'pages.yml writes llms.txt and sitemap.xml into site/');
  assert.ok(read('README.md').includes('tools/agent-files.mjs'), 'the README says where llms.txt, sitemap.xml and the description come from');
  assert.ok(read('docs/DESIGN.md').includes('tools/agent-files.mjs'), 'the design notes say how they are made');
});
