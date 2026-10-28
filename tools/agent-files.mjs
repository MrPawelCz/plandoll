// What the site says about itself to programs, in three small pieces written from one source: llms.txt (what plandoll is and where its instructions are),
// sitemap.xml, and the JSON-LD description (schema.org WebApplication) that tools/build.mjs puts in the head of the page.
//   node tools/agent-files.mjs [--base ADDRESS] --out DIR     writes DIR/llms.txt and DIR/sitemap.xml for the site at ADDRESS (default: the GitHub Pages address)
// The page is served from more than one address (GitHub Pages, and a domain of its own), so each host gets the pieces with its own address and, if it wants,
// its own maker; the words are the same everywhere. Nothing here reads the clock or the machine, so two builds of one commit are the same bytes (the page
// that CI builds for GitHub Pages is compared with a local build). The text of llms.txt is plain ASCII on purpose: a host that sends text/plain with no
// charset (several do) would otherwise show other letters as nonsense to a program that decides for itself.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const REPO_URL = 'https://github.com/MrPawelCz/plandoll';
export const RAW_URL = 'https://raw.githubusercontent.com/MrPawelCz/plandoll/main/';
export const PAGES_URL = 'https://mrpawelcz.github.io/plandoll/';
export const SITE_URL = 'https://plandoll.com/';
// The maker that the repository itself names (README, LICENSE). A host can pass another one.
export const AUTHOR = { type: 'Person', name: 'Paweł Czerwiński', url: 'https://github.com/MrPawelCz' };

const MIT = 'https://spdx.org/licenses/MIT.html';
// Only what the page itself does: what happens to a picture or a copied link after the visitor sends it elsewhere is not the page's to promise.
const DESCRIPTION = 'PlanDoll turns a floor plan into a furnished, lit 3D miniature of the flat, in the browser. Free, with no account. The page makes no network requests and uses no cookies or browser storage.';
// What the page does, in the words of the README. No counts: a number here would go stale the day a piece is added.
const FEATURES = [
  'Reads a floor plan as a small JSON file (plan format v1) and builds a 3D miniature of the flat',
  'Furnishes every room by itself, by rules; the same plan always gives the same flat',
  'Lights the flat at a time of day the visitor moves, with three named moods: Day, Sunset and Night',
  'Turn, zoom and move the miniature; show one floor or all of them; open the outer walls like a dolls\' house',
  'Card of a piece with its size, and a list of rooms with their areas',
  'Editor (experimental): move, turn, resize, recolour, add and delete pieces, save the layout to a file',
  'Copy a link that carries the whole layout in the part of the address after the #, which a browser never sends to a server',
  'Save a picture (PNG) of the current view',
  'Works from a single HTML file: no account, no analytics, no network requests, no cookies or browser storage',
  'Interface in English and Polish',
];

const checkBase = (base) => {
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/(?:[A-Za-z0-9._~-]+\/)*$/.test(String(base))) throw new Error(`the address of the site must be an https address that ends with a slash, not "${base}"`);
  return base;
};
const checkMaker = (m) => {
  if (!m || !['Person', 'Organization'].includes(m.type) || !m.name || !/^https:\/\//.test(m.url ?? '')) throw new Error('the maker needs a type (Person or Organization), a name and an https address');
  return m;
};
const asciiOnly = (s, what) => {
  const at = [...s].findIndex((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n'));
  if (at >= 0) throw new Error(`${what} must be plain ASCII (character ${at}: "${[...s][at]}")`);
  return s;
};
// The other known addresses of the same page, for a host to name beside its own.
export const otherAddresses = (base) => [PAGES_URL, SITE_URL].filter((a) => a !== base);

// The description of the page for crawlers and programs. `base` is the address the page is served from; `image` is a picture of the result; `maker` is who made it
// (the repository names its author, a host can name itself); `also` lists the other addresses of the same page.
export function jsonLd({ base, version, maker = AUTHOR, also = otherAddresses(base), image = `${RAW_URL}docs/screenshot.jpg` } = {}) {
  checkBase(base); checkMaker(maker);
  if (!/^\d+\.\d+\.\d+/.test(String(version))) throw new Error(`the version must be a number like 1.2.3, not "${version}"`);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${base}#app`,
    name: 'PlanDoll',
    url: base,
    description: DESCRIPTION,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Any (runs in a web browser with WebGL 2)',
    browserRequirements: 'Requires JavaScript and WebGL 2',
    softwareVersion: version,
    inLanguage: ['en', 'pl'],
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: MIT,
    keywords: 'floor plan, 3D, dollhouse view, interior, furniture layout, flat, apartment, visualisation',
    featureList: FEATURES,
    image,
    creator: { '@type': maker.type, name: maker.name, url: maker.url },
    sameAs: [REPO_URL, ...also.map(checkBase)],
  };
}

// The block for the head of the page. A "<" inside a string is written as \u003c, so no text of ours can end the script element early.
export const jsonLdBlock = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
// How to find the block again in a page (the page of a host with its own address swaps the block for its own). The plain "<script>" that the overlay of
// plandoll.com looks for does not match it, because this one has an attribute.
export const JSON_LD_BLOCK = /<script type="application\/ld\+json">[\s\S]*?<\/script>/;

// llms.txt in the layout of llmstxt.org: a title, a short summary, some plain paragraphs and lists, then lists of links under headings.
export function llmsTxt({ base, maker = AUTHOR, also = otherAddresses(base) } = {}) {
  checkBase(base); checkMaker(maker);
  const own = maker.name === AUTHOR.name && maker.url === AUTHOR.url;
  const makerLine = own ? 'Source and author: MrPawelCz on GitHub, MIT licence.' : `Made by ${maker.name} (${maker.url}). The source is open, MIT licence.`;
  const alsoLines = also.map((a) => `- [The same page at another address](${checkBase(a)}): the same application, served from a second host`);
  const text = `# PlanDoll

> PlanDoll turns a floor plan into a furnished, lit 3D miniature of the flat, in the browser. It is one HTML page: free, no account, no analytics. The page makes no network requests and uses no cookies or browser storage. The plan is a small JSON file that an AI chat assistant able to read pictures writes from a photo, screenshot or PDF page of the floor plan.

PlanDoll runs entirely on the visitor's device and needs a browser with WebGL 2. It furnishes each room by rules, lights the flat at a time of day the visitor moves, and lets them turn, zoom and move the miniature, show one floor or all floors, and open the outer walls like a dolls' house. The visitor can edit the layout, save it to a file, save a picture, or copy a link that holds the whole layout after the "#" in the address (a browser never sends that part to a server). The interface is in English and Polish. ${makerLine}

To help a visitor who has a picture of a floor plan:

1. Ask for a photo, screenshot or PDF page of the floor plan. Walls, doors and windows should be visible; printed sizes or room areas help to find the scale. Suggest taking names and addresses off the picture first: it goes to the assistant they choose, and PlanDoll itself sends nothing anywhere.
2. Turn the picture into the plan by following the instruction linked below (English; there is a Polish one too). It says how to answer: the plan as JSON, in the plan format linked below.
3. The visitor presses Load plan on the page (Wczytaj plan in the Polish interface), pastes your whole answer and presses Load (Wczytaj). The page finds the plan inside the text and checks it. If it lists problems, the visitor copies the list back to you: correct the plan and answer again.
4. The visitor compares the model with the drawing. Plans read from pictures can lack a window or put a wall in the wrong place, so tell the visitor to check.

Parameters for a link to the page go after the "#" in the address, joined with "&". For example, ${base}#plan=duplex-1&amber&floor=0 opens the duplex at sunset, ground floor only. Such a link opens one of the two example plans: a plan of the visitor's own always goes in through Load plan (the Copy link button of the page writes the links that carry a layout, and a plan of the visitor's own with it). The parameters people use most:

- plan=flat-1 or plan=duplex-1: an example plan
- the mood, as a bare word or as preset=...: clear (Day), amber (Sunset) or lamplit (Night); t=0 to 1: the time of day
- floor=0, floor=1 or floor=all: the floor on show; lang=en or lang=pl: the language
- intro=0: no animation when the page opens; ui=0 hides all controls and btn=0 the row of buttons, Load plan included, so leave them out for a visitor who still has to load a plan
- every parameter is in the table of the README

## Use it

- [PlanDoll](${base}): the page; two example plans are built in (a flat and a duplex) and Load plan takes a plan of the visitor's own
${alsoLines.length ? `${alsoLines.join('\n')}\n` : ''}- [Source code and README](${REPO_URL}): what works today, every address parameter, how to build and test it

## Plans: instructions and format

- [Instruction for making a plan from a picture](${RAW_URL}docs/PROMPT.md): English; written to be given to an assistant together with the picture
- [The instruction in Polish](${RAW_URL}docs/PROMPT.pl.md): a little longer than the English one: it adds rules for Polish drawings and asks for the notes in Polish
- [Plan format v1](${RAW_URL}docs/plan-format.md): walls, openings, rooms, stairs and levels, with a small complete example
- [JSON Schema of a plan](${RAW_URL}schema/plan.v1.schema.json): the machine-readable definition
- [How different kinds of plans are read](${RAW_URL}docs/reading-plans.md): CAD and architect PDFs, brochure plans, hand sketches, plans with several floors
- [Example plan: a flat](${RAW_URL}examples/flat-1.plan.json)
- [Example plan: a duplex](${RAW_URL}examples/duplex-1.plan.json)

## Optional

- [Specification](${RAW_URL}docs/SPEC.md): coordinates, the plan format, geometry and validation in full
- [Design notes](${RAW_URL}docs/DESIGN.md): how the page is built
- [Licence](${RAW_URL}LICENSE): MIT
`;
  return asciiOnly(text, 'llms.txt');
}

// sitemap.xml: the page is one address (everything else lives after the "#"), so the list is short.
export function sitemapXml({ base } = {}) {
  checkBase(base);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${base}</loc></url>\n</urlset>\n`;
}

// The version of package.json: what softwareVersion says.
export const packageVersion = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// Run as a command, also by a path that goes through a symbolic link (the module itself is always known by its real path).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const usage = () => { console.error('usage: node tools/agent-files.mjs [--base ADDRESS] --out DIR'); process.exit(2); };
  // an option that is given needs its value: "--base" alone is a mistake, not a request for the default
  const arg = (name) => { const i = process.argv.indexOf(name); if (i < 0) return undefined; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? usage() : v; };
  const out = arg('--out'), base = arg('--base') ?? PAGES_URL;
  if (!out) usage();
  const dir = resolve(out);
  const files = { 'llms.txt': llmsTxt({ base }), 'sitemap.xml': sitemapXml({ base }) }; // both are made before anything is written: a bad address leaves nothing behind
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  console.log(`wrote ${join(dir, 'llms.txt')} and ${join(dir, 'sitemap.xml')} for ${base}`);
}
