// Draw scheduling for the page. The first `frames` frames are drawn one after the other (tools wait for them); after that a frame
// is drawn only when something asked for one, and nothing is queued while the page is idle. With live = true even the first frame
// waits for a request. Pure logic: the browser's requestAnimationFrame is passed in, so it is tested in Node with a fake one.
//   draw(n) is called with the number of the frame being drawn (1 for the first).
export function createLoop({ draw, frames = 4, live = false, request = (f) => requestAnimationFrame(f) }) {
  let drawn = 0, dirty = true, queued = false;
  const wanted = () => dirty || (!live && drawn < frames);
  function schedule() { if (!queued) { queued = true; request(tick); } }
  function tick() {
    queued = false;
    if (!wanted()) return;
    dirty = false; // cleared before drawing, so a request made during the draw is kept
    draw(++drawn);
    if (wanted()) schedule();
  }
  return {
    start: schedule,
    invalidate() { dirty = true; schedule(); }, // many calls before the next animation frame make one frame
    get drawn() { return drawn; },
    get idle() { return !queued && !wanted(); },
  };
}
