// The same flat as it comes out of different chats and editors, for the extractJson unit tests and the paste end to end test.
import { readFileSync } from 'node:fs';

export const plan = JSON.parse(readFileSync(new URL('../../examples/flat-1.plan.json', import.meta.url), 'utf8'));
export const bare = JSON.stringify(plan, null, 2);
const quoted = (open, close) => { let on = false; return bare.replace(/"/g, () => ((on = !on) ? open : close)); };

// What people actually paste: the same plan wrapped the way chats and editors wrap it.
export const variants = {
  'bare JSON': bare,
  'fenced block': `\`\`\`json\n${bare}\n\`\`\``,
  'fenced block with notes before and after': `Here is the plan I read from your drawing.\n\n\`\`\`json\n${bare}\n\`\`\`\n\nNotes: the kitchen door is a guess, check it.`,
  'leading json line': `json\n${bare}`,
  'tilde fence without a language': `~~~\n${bare}\n~~~`,
  'typographic quotes as delimiters': quoted('“', '”'),
  'Polish quotes as delimiters': quoted('„', '”'),
  '// comments': bare.replace(/,\n/g, ', // next\n').replace(/\{\n/, '{ // the plan\n'),
  '/* */ comments': `/* floor plan */\n${bare.replace(/,\n/g, ', /* next */\n')}`,
  'trailing commas': bare.replace(/(\S)(\n\s*[}\]])/g, '$1,$2'),
  'byte order mark and zero width characters': `\ufeff\u200b${bare.replace('"version"', '"ver\u200bsion"')}`,
  'non-breaking spaces as indentation': bare.replace(/\n {2}/g, '\n\u00a0\u00a0'),
  'everything at once': `Sure! Here you go:\n\n\`\`\`json\n${quoted('“', '”').replace(/,\n/g, ', // x\n').replace(/(\S)(\n\s*[}\]])/g, '$1,$2')}\n\`\`\`\n\nAnything else?`,
};
