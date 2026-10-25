// Size limits shared by the validator and the page.
// The longest text, in characters (UTF-16 code units), that planstage reads as a plan or a layout, whether it was pasted, typed or read from a chosen
// file; 2 million characters is about 2 MB of plain text. The validator, the layout reader and the file helpers all use this one value.
export const MAX_PLAN_CHARS = 2000000;
