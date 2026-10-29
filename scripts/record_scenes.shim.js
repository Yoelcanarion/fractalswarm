// The page's frame clock, for the recorder (scripts/record_scenes.mjs, "frames" mode). It is added to the page before
// any of the page's own scripts run, and replaces what a browser does by itself with a clock the recorder turns by hand:
//
//   requestAnimationFrame / cancelAnimationFrame   callbacks wait until `__vt.advance()`
//   performance.now()                              the virtual time: 0 at the start, +1/60 s per advance
//   CSS transitions and animations                 paused, then set to the virtual time since they began
//
// so a take of the director (web/src/director) is drawn one frame at a time, however long the machine takes to draw one,
// and every library that animates from requestAnimationFrame and performance.now (React Flow's d3 transitions, the
// `motion` package, the counters' count-up) moves with the take and not with the wall clock. Timers (setTimeout) are
// left alone: what the page loads, and the recorder's own waits, run in real time.
//
// Plain ES2020 with no imports: it is evaluated as it is in the page, and in a vm in web/src/director/shim.test.ts.

(() => {
  if (window.__vt) return;

  const FRAME_MS = 1000 / 60;
  let now = 0;
  let frames = 0;
  let nextId = 1;
  let queue = new Map();
  /** The virtual time each animation was first seen at: its own zero. */
  const born = new WeakMap();

  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  performance.now = () => now;

  /** One frame: the callbacks asked for before it run, in the order they were asked for, all with the same time. Those
   * they ask for in turn wait for the next. Between callbacks the microtasks run, as they do in a browser, so what React
   * renders from one callback's store write is there for the next. */
  async function advance(dt = FRAME_MS) {
    now += dt;
    frames += 1;
    const due = [...queue.values()];
    queue = new Map();
    for (const callback of due) {
      try {
        callback(now);
      } catch (error) {
        console.error("[record shim] a frame callback threw:", error);
      }
      await Promise.resolve();
    }
  }

  const turn = () =>
    new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });

  /** Let what the last frame started finish: React's scheduler runs on message channels, and effects on timers. */
  async function settle() {
    await turn();
    await turn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Put every CSS animation and transition at the virtual time since it was first seen, paused there, so a frame shows
   * the animations as they are at that frame and not as they have got to in real time. */
  function syncAnimations() {
    for (const animation of document.getAnimations()) {
      let start = born.get(animation);
      if (start === undefined) {
        start = now;
        born.set(animation, start);
        animation.pause();
      }
      animation.currentTime = now - start;
    }
  }

  /** What the recorder asks for between two screenshots. */
  async function frame(dt = FRAME_MS) {
    await advance(dt);
    await settle();
    syncAnimations();
    await settle();
  }

  window.__vt = {
    FRAME_MS,
    advance,
    settle,
    syncAnimations,
    frame,
    now: () => now,
    frames: () => frames,
    waiting: () => queue.size,
  };
})();
