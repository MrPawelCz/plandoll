// The address that follows the layout. A reload (the Edit button, Done, the browser's own) builds the page again from its address, so a change that is not in the address when
// the page reloads is lost, a changed colour among them. changed() says that the layout changed; a moment after the last change (a drag, a turn and a colour in a row are one write)
// the address takes the layout. flush() writes at once what is still waiting and says whether the address now holds the layout of the last change; the page awaits it before it reloads.
// build() makes what is to be written (an object with ok: true) and write(made) puts it in the address; write returns false when it could not. Either may fail, and then flush() says
// no and pending stays true: the page falls back to asking for a file. Builds never overlap; every flush tries again what is still pending (a write that was refused a moment ago,
// by a browser that limits how often the address may change, can go through at the next tap).
// The default timers are wrapped, not copied: a browser throws 'Illegal invocation' when setTimeout is called as a method of any object but the window, which Node does not.
export function createAddressSync({ build, write, delay = 400, timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) } }) {
  let seq = 0, written = 0, timer = null, tail = Promise.resolve();
  async function attempt() {
    if (seq === written) return;
    const at = seq; // what the build sees may be newer; the older number is the one that counts as written
    let ok = false;
    try { const made = await build(); ok = !!made && made.ok !== false && write(made) !== false; } catch { ok = false; }
    if (ok) written = at;
  }
  const enqueue = () => (tail = tail.then(attempt));
  return {
    changed() {
      seq += 1;
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { timer = null; enqueue(); }, delay);
    },
    async flush() {
      if (timer !== null) { timers.clearTimeout(timer); timer = null; }
      await enqueue();
      return seq === written;
    },
    get pending() { return seq !== written; },
  };
}

// What Done does once the address has taken the last change: 'go' leaves the editor, 'file' says that the layout could not be put in the address (so a file is the only way to keep
// it), 'lost' says that pieces which stand outside every room do not come through the address (the reader leaves them out). The second tap, after a word, always goes.
// unsaved: changes that the address does not hold (and that no file holds); lost: how many pieces of the written layout the reader will leave out.
export function leaveAdvice({ unsaved = false, lost = 0, warned = false } = {}) {
  if (warned) return 'go';
  if (unsaved) return 'file';
  if (lost > 0) return 'lost';
  return 'go';
}
