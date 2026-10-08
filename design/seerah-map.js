(function () {
  if (customElements.get('seerah-map')) return;
  const TOPO = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
  // label offsets: [dx, dy, anchor]
  const P = {
    makkah: { c: [39.826, 21.4225], n: 'মক্কা', l: [-12, -6, 'end'] },
    thawr: { c: [39.8497, 21.3772], n: 'সাওর গুহা', l: [-10, 20, 'end'] },
    hira: { c: [39.8579, 21.4576], n: 'হেরা গুহা', l: [10, -6, 'start'] },
    madinah: { c: [39.6111, 24.4686], n: 'মদিনা', l: [12, 5, 'start'] },
    quba: { c: [39.6173, 24.4393], n: 'কুবা', l: [10, 14, 'start'] },
    banusad: { c: [40.6, 21.0], n: "বনু সা'দ", l: [10, 4, 'start'] },
    taif: { c: [40.4158, 21.2703], n: 'তায়েফ', l: [10, 4, 'start'] },
    sanaa: { c: [44.2067, 15.3694], n: 'সানআ', l: [10, 4, 'start'] },
    abwa: { c: [39.08, 23.08], n: 'আবওয়া', l: [-10, 4, 'end'] },
    badr: { c: [38.775, 23.73], n: 'বদর', l: [-10, 4, 'end'] },
    arafat: { c: [39.984, 21.355], n: 'আরাফাহ', l: [10, 14, 'start'] },
    quds: { c: [35.2355, 31.7767], n: 'বায়তুল মাকদিস', l: [10, 4, 'start'] },
    habasha: { c: [38.72, 14.13], n: 'হাবশা (আকসুম)', l: [10, 4, 'start'] }
  };
  const R = {
    hijrah: ['makkah', 'thawr', [39.55, 21.62], [39.33, 21.97], [39.2, 22.45], [39.1, 22.95], [39.08, 23.45], [39.28, 23.95], [39.5, 24.3], 'quba', 'madinah'],
    elephant: ['sanaa', [44.13, 17.49], [43.1, 18.8], [41.9, 19.9], [40.9, 20.8], 'taif', 'makkah'],
    halima: ['makkah', [40.2, 21.25], 'banusad'],
    abwa: ['madinah', [39.4, 24.0], [39.15, 23.5], 'abwa'],
    habasha: ['makkah', [39.3, 21.15], [39.0, 20.6], [38.7, 18.5], [38.8, 16.2], 'habasha'],
    isra: ['makkah', [37.2, 27.0], 'quds'],
    fath: ['madinah', [39.8, 23.6], [39.9, 22.6], [39.85, 21.9], 'makkah']
  };
  const F = {
    peninsula: [[34, 12.5], [60, 32]],
    south: [[38.5, 13.5], [47.5, 22.5]],
    hijaz: [[37.6, 20.8], [41.4, 25.0]],
    makkah: [[39.3, 20.95], [40.6, 21.85]],
    makkahwide: [[39.2, 20.4], [41.6, 22.2]],
    madinah: [[39.25, 24.15], [40.0, 24.75]],
    north: [[33.5, 20.5], [42.5, 32.5]],
    horn: [[36, 12.8], [42.5, 22.5]]
  };
  const SEAS = [
    { c: [38.1, 22.3], n: 'লোহিত সাগর', r: 56 },
    { c: [51.3, 27.2], n: 'পারস্য উপসাগর', r: 28 },
    { c: [62, 16.5], n: 'আরব সাগর', r: 0 }
  ];
  const co = k => (typeof k === 'string' ? P[k].c : k);
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const waitLibs = () => new Promise((res, rej) => {
    let n = 0;
    (function poll() {
      if (window.d3 && window.topojson) return res();
      if (++n > 300) return rej(new Error('d3/topojson not loaded'));
      setTimeout(poll, 50);
    })();
  });
  const getLand = () => window.__seerahLand || (window.__seerahLand = fetch(TOPO).then(r => r.json()).then(t => window.topojson.merge(t, t.objects.countries.geometries)));
  const ATTRS = ['view', 'route', 'places', 'highlight', 'height', 'motion'];

  class SeerahMap extends HTMLElement {
    static get observedAttributes() { return ATTRS; }
    constructor() { super(); this._v = {}; }
    connectedCallback() {
      Object.assign(this.style, { display: 'block', position: 'relative', width: '100%', overflow: 'hidden' });
      this.style.height = (this._get('height') || 300) + 'px';
      if (!this._started) { this._started = true; this._boot(); }
    }
    disconnectedCallback() { cancelAnimationFrame(this._anim); }
    attributeChangedCallback() { this._queue(); }
    _get(k) { return this._v[k] != null ? String(this._v[k]) : this.getAttribute(k); }
    _queue() {
      if (!this._ready) return;
      cancelAnimationFrame(this._q);
      this._q = requestAnimationFrame(() => this._render(true));
    }
    async _boot() {
      try { await waitLibs(); this._land = await getLand(); } catch (e) { console.warn('seerah-map', e); return; }
      const d3 = window.d3;
      this._grid = d3.geoGraticule().step([2, 2])();
      const svg = this._svg = d3.select(this).append('svg').attr('role', 'img').style('display', 'block').style('font-family', 'var(--f-ui)');
      this._sea = svg.append('rect').style('fill', 'var(--map-sea)');
      this._grat = svg.append('path').style('fill', 'none').style('stroke', 'var(--map-grid)').style('stroke-width', 1);
      this._landP = svg.append('path').style('fill', 'var(--map-land)').style('stroke', 'var(--map-coast)').style('stroke-width', 1).style('stroke-linejoin', 'round');
      this._seaG = svg.append('g');
      this._seaG.selectAll('text').data(SEAS).join('text').text(d => d.n)
        .attr('text-anchor', 'middle')
        .style('fill', 'var(--map-sea-ink)').style('font-size', '12px').style('font-weight', 500);
      this._routeBase = svg.append('path').style('fill', 'none').style('stroke', 'var(--map-route)').style('stroke-opacity', 0.16).style('stroke-width', 7).style('stroke-linecap', 'round').style('stroke-linejoin', 'round');
      this._routeP = svg.append('path').style('fill', 'none').style('stroke', 'var(--map-route)').style('stroke-width', 2.5).style('stroke-linecap', 'round').style('stroke-linejoin', 'round');
      this._mk = svg.append('g');
      this._ready = true;
      this._ro = new ResizeObserver(() => { if (this.clientWidth && this.clientWidth !== this._w) this._render(false); });
      this._ro.observe(this);
      this._render(true);
    }
    _fit(b, w, h) {
      const d3 = window.d3, pad = Math.max(28, Math.min(w, h) * 0.1);
      // top clears the view toggle, bottom clears the route legend
      const p = d3.geoMercator().fitExtent([[pad, 68], [w - pad, h - 52]], { type: 'MultiPoint', coordinates: b });
      return { k: p.scale(), c: p.invert([w / 2, h / 2]) };
    }
    _render(animate) {
      const d3 = window.d3, w = this.clientWidth || 360, h = +(this._get('height') || 300);
      this.style.height = h + 'px';
      const view = this._get('view') || 'peninsula', route = this._get('route') || '';
      const places = (this._get('places') || '').split(',').map(s => s.trim()).filter(k => P[k]);
      const hl = this._get('highlight') || '';
      const key = [view, route, places.join(), hl, w, h].join('|');
      if (key === this._key) return;
      const sizeChanged = w !== this._w || h !== this._h;
      this._key = key; this._w = w; this._h = h;
      this._svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`)
        .attr('aria-label', 'মানচিত্র: ' + places.map(p => P[p].n).join(', '));
      this._sea.attr('width', w).attr('height', h);
      const reduced = this._get('motion') === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
      const target = this._fit(F[view] || F.peninsula, w, h);
      const from = this._view && !sizeChanged ? this._view : (animate ? this._fit(F.peninsula, w, h) : target);
      this._setMarkers(places, hl, reduced);
      this._routeP.style('transition', 'none').style('opacity', 0);
      this._routeBase.style('transition', 'none').style('opacity', 0);
      cancelAnimationFrame(this._anim);
      const dur = reduced || !animate ? 0 : 1700;
      const same = Math.abs(from.k - target.k) < 1 && Math.abs(from.c[0] - target.c[0]) < 0.01 && Math.abs(from.c[1] - target.c[1]) < 0.01;
      if (!dur || same) { this._frame(target); this._drawRoute(route, !reduced && animate); return; }
      const t0 = performance.now(), lk0 = Math.log(from.k), lk1 = Math.log(target.k);
      const step = now => {
        const t = Math.min(1, (now - t0) / dur), e = ease(t);
        this._frame({ k: Math.exp(lk0 + (lk1 - lk0) * e), c: [from.c[0] + (target.c[0] - from.c[0]) * e, from.c[1] + (target.c[1] - from.c[1]) * e] });
        if (t < 1) this._anim = requestAnimationFrame(step); else this._drawRoute(route, true);
      };
      this._anim = requestAnimationFrame(step);
    }
    _frame(v) {
      const d3 = window.d3;
      this._view = v;
      const p = this._p = d3.geoMercator().scale(v.k).center(v.c).translate([this._w / 2, this._h / 2]);
      const path = d3.geoPath(p);
      this._landP.attr('d', path(this._land));
      this._grat.attr('d', path(this._grid));
      this._mk.selectAll('g.m').attr('transform', d => `translate(${p(d)})`);
      this._seaG.selectAll('text').attr('transform', d => `translate(${p(d.c)}) rotate(${d.r})`);
    }
    _setMarkers(places, hl, reduced) {
      this._mk.selectAll('*').remove();
      // non-highlighted first so the highlighted marker sits on top
      const order = places.filter(k => k !== hl).concat(places.filter(k => k === hl));
      order.forEach(k => {
        const pl = P[k], isH = k === hl;
        const g = this._mk.append('g').attr('class', 'm').datum(pl.c);
        if (isH) {
          const ring = g.append('circle').attr('r', 7).style('fill', 'none').style('stroke', 'var(--gold)').style('stroke-width', 1.5)
            .style('transform-box', 'fill-box').style('transform-origin', 'center');
          if (!reduced) ring.style('animation', 'seerahPulse 3.2s cubic-bezier(.2,0,0,1) infinite');
          g.append('circle').attr('r', 6).style('fill', 'var(--gold)').style('stroke', 'var(--map-halo)').style('stroke-width', 2);
        } else {
          g.append('circle').attr('r', 4.5).style('fill', 'var(--map-marker)').style('stroke', 'var(--map-halo)').style('stroke-width', 2);
        }
        g.append('text').text(pl.n).attr('x', pl.l[0]).attr('y', pl.l[1]).attr('text-anchor', pl.l[2])
          .style('fill', 'var(--ink)').style('font-size', isH ? '14px' : '13px').style('font-weight', isH ? 700 : 600)
          .style('paint-order', 'stroke').style('stroke', 'var(--map-halo)').style('stroke-width', '4px').style('stroke-linejoin', 'round');
      });
    }
    _drawRoute(route, animate) {
      const d3 = window.d3, pts = R[route] || [];
      if (pts.length < 2) return;
      const d = d3.line().curve(d3.curveCatmullRom.alpha(0.5))(pts.map(k => this._p(co(k))));
      this._routeBase.attr('d', d).style('transition', animate ? 'opacity 1s ease' : 'none').style('opacity', 1);
      const rp = this._routeP.attr('d', d).style('stroke-dasharray', null).style('stroke-dashoffset', null);
      if (route === 'isra') {
        rp.style('stroke-dasharray', '1 7').style('transition', animate ? 'opacity 1.4s ease' : 'none').style('opacity', 1);
        return;
      }
      if (!animate) { rp.style('opacity', 1); return; }
      const len = rp.node().getTotalLength();
      rp.style('transition', 'none').style('stroke-dasharray', `${len} ${len}`).style('stroke-dashoffset', len).style('opacity', 1);
      rp.node().getBoundingClientRect();
      rp.style('transition', 'stroke-dashoffset 2.8s cubic-bezier(.45,0,.2,1)').style('stroke-dashoffset', 0);
    }
  }
  ATTRS.forEach(k => Object.defineProperty(SeerahMap.prototype, k, {
    configurable: true,
    get() { return this._get(k); },
    set(v) { this._v[k] = v; this._queue(); }
  }));
  customElements.define('seerah-map', SeerahMap);
})();
