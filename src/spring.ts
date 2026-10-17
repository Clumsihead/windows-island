/**
 * Drives the island's width / height / corner radius / "ear" size with a damped spring.
 * It writes straight to the element (no React re-render per frame) and the window itself
 * never resizes, so the morph is one box being repainted.
 *
 * `e` is the size of the concave fillets where the island meets the top edge of the screen.
 */
export type Box = { w: number; h: number; r: number; e: number };
export type SpringCfg = { k: number; c: number };

const KEYS = ["w", "h", "r", "e"] as const;
const ZERO: Box = { w: 0, h: 0, r: 0, e: 0 };

export class SpringBox {
  private cur: Box;
  private vel: Box = { ...ZERO };
  private target: Box;
  private cfg: SpringCfg = { k: 300, c: 28 };
  private raf = 0;
  private last = 0;

  constructor(private el: HTMLElement, init: Box) {
    this.cur = { ...init };
    this.target = { ...init };
    this.paint();
  }

  to(target: Box, cfg: SpringCfg, instant = false) {
    this.target = { ...target };
    this.cfg = cfg;
    if (instant) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.cur = { ...target };
      this.vel = { ...ZERO };
      this.paint();
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (t: number) => {
    const dt = Math.min(0.033, (t - this.last) / 1000);
    this.last = t;
    const steps = 4;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const k of KEYS) {
        const a = -this.cfg.k * (this.cur[k] - this.target[k]) - this.cfg.c * this.vel[k];
        this.vel[k] += a * h;
        this.cur[k] += this.vel[k] * h;
      }
    }
    this.paint();
    const settled = KEYS.every((k) => Math.abs(this.cur[k] - this.target[k]) < 0.05 && Math.abs(this.vel[k]) < 0.5);
    if (settled) {
      this.cur = { ...this.target };
      this.vel = { ...ZERO };
      this.paint();
      this.raf = 0;
    } else {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private paint() {
    const { w, h, r, e } = this.cur;
    const s = this.el.style;
    s.width = `${Math.max(0, w)}px`;
    s.height = `${Math.max(0, h)}px`;
    s.setProperty("--r", `${Math.max(0, r)}px`);
    s.setProperty("--ear", `${Math.max(0, e)}px`);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }
}

// Slight overshoot opening, critically damped closing (so it never bounces into the screen edge).
export const OPEN: SpringCfg = { k: 240, c: 24 };
export const RETAB: SpringCfg = { k: 300, c: 31 };
export const CLOSE: SpringCfg = { k: 380, c: 39 };
