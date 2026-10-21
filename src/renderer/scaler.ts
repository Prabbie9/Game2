// Dynamic quality scaler: watches the wall-clock frame time and trades render resolution, then population (traffic,
// crowd), to hold the tier's frame budget. Steps down after 1.5 s over budget (x1.15), steps back up after 4 s well under
// it (x0.75): population is restored first, then resolution. Active on tiers with dynamicRes (Lite, Low, Medium).
export interface ScalerHooks { setResScale: (s: number) => void; setPopulation: (k: number) => void }
export class QualityScaler {
  res = 1; pop = 1; ema = 0; over = 0; under = 0; steps: { t: number; dir: 'down' | 'up'; res: number; pop: number; ms: number }[] = []; t = 0;
  forcedMs: number | null = null; // test hook: pretend every frame took this long
  constructor(public budgetMs: number, public hooks: ScalerHooks, public enabled = true) {}
  update(wallMs: number) {
    if (!this.enabled) return; const ms = this.forcedMs ?? Math.min(wallMs, 250); this.t += ms / 1000;
    this.ema = this.ema ? this.ema * 0.9 + ms * 0.1 : ms;
    if (this.ema > this.budgetMs * 1.15) { this.over += ms / 1000; this.under = 0; } else if (this.ema < this.budgetMs * 0.75) { this.under += ms / 1000; this.over = 0; } else { this.over = 0; this.under = 0; }
    if (this.over > 1.5) { this.over = 0; if (this.res > 0.5) this.set(this.res - 0.1, this.pop, 'down'); else if (this.pop > 0.25) this.set(this.res, this.pop - 0.25, 'down'); }
    else if (this.under > 4) { this.under = 0; if (this.pop < 1) this.set(this.res, this.pop + 0.25, 'up'); else if (this.res < 1) this.set(this.res + 0.1, this.pop, 'up'); }
  }
  private set(res: number, pop: number, dir: 'down' | 'up') {
    res = Math.round(Math.min(1, Math.max(0.5, res)) * 10) / 10; pop = Math.min(1, Math.max(0.25, pop));
    if (res !== this.res) this.hooks.setResScale(res); if (pop !== this.pop) this.hooks.setPopulation(pop);
    this.res = res; this.pop = pop; this.steps.push({ t: +this.t.toFixed(1), dir, res, pop, ms: +this.ema.toFixed(1) });
  }
}
