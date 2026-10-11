(function () {
  var root = document.documentElement;

  // Theme toggle
  document.getElementById('themeBtn').addEventListener('click', function () {
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
  });


  // Hero background: a quiet swarm of agents, confined to the outer page gutters;
  // agents message each other (solid links), read/write shared memory hubs (dashed links),
  // and clicking an agent makes it broadcast.
  (function () {
    var hero = document.getElementById('about'), cv = document.getElementById('swarm');
    var ctx = cv.getContext('2d'), base = document.createElement('canvas'), bctx = base.getContext('2d');
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, dpr = 1, nodes = [], edges = [], packets = [], hover = null, C = {};
    var running = false, visible = true, raf, last = 0, clock = 0, nextEvt = 0, timers = [];
    var MEM = '#d08a1e', GUTTER = 130;

    function readColors() {
      var cs = getComputedStyle(root);
      ['accent', 'text-3', 'surface', 'bg'].forEach(function (k) { C[k] = cs.getPropertyValue('--' + k).trim(); });
    }
    function rgba(hex, a) {
      var n = parseInt(hex.replace('#', ''), 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    function rel(el, pad) {
      var h = hero.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { l: r.left - h.left - pad, t: r.top - h.top - pad, r: r.right - h.left + pad, b: r.bottom - h.top + pad };
    }
    // ---- layout: jittered grid
    function layout() {
      W = hero.clientWidth; H = hero.clientHeight;
      dpr = Math.min(devicePixelRatio || 1, 2);
      [cv, base].forEach(function (c) { c.width = W * dpr; c.height = H * dpr; });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Only the outer gutters: beyond GUTTER px from the content column on each side.
      var wrap = hero.querySelector('.wrap'), ws = getComputedStyle(wrap), wr = rel(wrap, 0);
      var L = wr.l + parseFloat(ws.paddingLeft) - GUTTER, R = wr.r - parseFloat(ws.paddingRight) + GUTTER;
      var step = 40;
      nodes = []; edges = []; packets = []; hover = null;
      timers.forEach(clearTimeout); timers = [];
      for (var gy = step / 2; gy < H; gy += step) for (var gx = step / 2; gx < W; gx += step) {
        if (Math.random() < .62) continue;
        var x = gx + (Math.random() - .5) * step * .8, y = gy + (Math.random() - .5) * step * .7;
        var out = Math.max(L - x, x - R);
        if (out < 0) continue;
        var fade = Math.min(1, .25 + out / 90) * Math.min(1, (H - y) / 60, y / 30);
        if (fade < .08) continue;
        nodes.push({ x: x, y: y, f: fade, act: 0, bar: Math.random() < .35, hub: false, adj: [], mem: [] });
      }
      // a few shared-memory hubs
      var hubCount = Math.max(2, Math.round(nodes.length / 45));
      for (var h = 0; h < hubCount; h++) { var c = nodes[Math.random() * nodes.length | 0]; if (c) c.hub = true; }
      // links: 2 nearest neighbours, plus a few long-range ties
      function addEdge(a, b, mem) {
        if (a === b || a.adj.indexOf(b) > -1 || a.mem.indexOf(b) > -1) return;
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), bend = (Math.random() - .5) * .35 * len;
        var e = { a: a, b: b, mem: mem, act: 0, len: len,
          cx: (a.x + b.x) / 2 - dy / len * bend, cy: (a.y + b.y) / 2 + dx / len * bend };
        edges.push(e);
        (mem ? a.mem : a.adj).push(b); (mem ? b.mem : b.adj).push(a);
      }
      function nearest(n, k, pred) {
        return nodes.filter(function (m) { return m !== n && pred(m); })
          .sort(function (p, q) { return Math.hypot(p.x - n.x, p.y - n.y) - Math.hypot(q.x - n.x, q.y - n.y); })
          .slice(0, k);
      }
      nodes.forEach(function (n) {
        if (n.hub) nearest(n, 4, function (m) { return !m.hub; }).forEach(function (m) { addEdge(n, m, true); });
        else nearest(n, 2, function (m) { return !m.hub; }).forEach(function (m) { addEdge(n, m, false); });
      });
      for (var i = 0; i < nodes.length / 7; i++) {
        var a = nodes[Math.random() * nodes.length | 0], b = nodes[Math.random() * nodes.length | 0];
        if (a && b && !a.hub && !b.hub && Math.hypot(a.x - b.x, a.y - b.y) < 300) addEdge(a, b, false);
      }
      drawBase(); draw();
    }

    function edgeOf(a, b) { for (var i = 0; i < edges.length; i++) { var e = edges[i]; if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e; } }
    function pt(e, from, t) { // point on the quadratic link, travelling away from `from`
      if (from !== e.a) t = 1 - t;
      var u = 1 - t;
      return { x: u * u * e.a.x + 2 * u * t * e.cx + t * t * e.b.x, y: u * u * e.a.y + 2 * u * t * e.cy + t * t * e.b.y };
    }
    function alphaOf(e) { return Math.min(e.a.f, e.b.f); }

    // ---- static layer
    function rect(c, x, y, w, h) { c.beginPath(); c.rect(Math.round(x - w / 2) + .5, Math.round(y - h / 2) + .5, w, h); }
    function drawBase() {
      bctx.clearRect(0, 0, W, H);
      edges.forEach(function (e) {
        bctx.setLineDash(e.mem ? [3, 4] : []);
        bctx.strokeStyle = rgba(C['text-3'], (e.mem ? .32 : .22) * alphaOf(e));
        bctx.lineWidth = 1;
        bctx.beginPath(); bctx.moveTo(e.a.x, e.a.y); bctx.quadraticCurveTo(e.cx, e.cy, e.b.x, e.b.y); bctx.stroke();
      });
      bctx.setLineDash([]);
      nodes.forEach(function (n) {
        var w = n.hub ? 24 : 18, h = n.hub ? 11 : 8;
        bctx.fillStyle = C.bg; rect(bctx, n.x, n.y, w, h); bctx.fill();
        bctx.strokeStyle = n.hub ? rgba(MEM, .55 * n.f) : rgba(C['text-3'], .45 * n.f); bctx.lineWidth = 1; bctx.stroke();
        if (n.hub) { bctx.fillStyle = rgba(MEM, .45 * n.f); bctx.fillRect(n.x - 7, n.y - 1.5, 14, 3); }
        else if (n.bar) { bctx.fillStyle = rgba(C['text-3'], .4 * n.f); bctx.fillRect(n.x - 6, n.y - 1, 4, 2); }
      });
    }

    // ---- dynamic layer
    function draw() {
      if (!W || !H) return; // hero not laid out yet (or hidden)
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0, W, H);
      edges.forEach(function (e) {
        var hot = hover && (e.a === hover || e.b === hover);
        if (e.act < .02 && !hot) return;
        var c = e.mem ? MEM : C.accent, a = alphaOf(e);
        ctx.setLineDash(e.mem ? [3, 4] : []);
        ctx.strokeStyle = rgba(c, (Math.max(e.act * .85, hot ? .5 : 0)) * a);
        ctx.lineWidth = 1.1 + e.act * 1;
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.quadraticCurveTo(e.cx, e.cy, e.b.x, e.b.y); ctx.stroke();
      });
      ctx.setLineDash([]);
      packets.forEach(function (k) {
        var c = k.mem ? MEM : C.accent, a = alphaOf(k.e), t = ease(k.t);
        ctx.strokeStyle = rgba(c, .7 * a); ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        for (var s = 0; s <= 8; s++) { var q = pt(k.e, k.from, Math.max(0, t - .25 + s * .25 / 8)); s ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
        ctx.stroke();
        var p = pt(k.e, k.from, t);
        ctx.fillStyle = rgba(c, .95 * a);
        if (k.mem) ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); }
      });
      nodes.forEach(function (n) {
        var on = n === hover;
        if (n.act < .02 && !on) return;
        var c = n.hub ? MEM : C.accent, a = Math.min(1, Math.max(n.act * 1.3, on ? .9 : 0)) * n.f;
        var w = n.hub ? 24 : 18, h = n.hub ? 11 : 8;
        if (n.act > .02) { // halo
          ctx.fillStyle = rgba(c, .06 * n.act * n.f); ctx.strokeStyle = rgba(c, .35 * n.act * n.f); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(n.x, n.y, 14 + (1 - n.act) * 6, 0, 7); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = rgba(c, .16 * a); rect(ctx, n.x, n.y, w, h); ctx.fill();
        ctx.strokeStyle = rgba(c, .9 * a); ctx.lineWidth = 1.4; ctx.stroke();
        ctx.fillStyle = rgba(c, .85 * a); ctx.fillRect(n.x - (w / 2 - 4), n.y - 1.5, w - 8, 3);
      });
    }
    function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    // ---- events
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function send(from, to, then) {
      var e = edgeOf(from, to); if (!e) return;
      e.act = 1; from.act = Math.max(from.act, .7);
      packets.push({ e: e, from: from, to: to, mem: e.mem, t: 0, dur: 450 + e.len * 4, then: then });
    }
    function pick(a) { return a[Math.random() * a.length | 0]; }
    function relay(from, to, hops) {
      send(from, to, function () {
        var next = to.adj.filter(function (n) { return n !== from; });
        if (hops > 0 && next.length && Math.random() < .65) later(function () { relay(to, pick(next), hops - 1); }, 140);
        else if (Math.random() < .3) later(function () { send(to, from); }, 180); // reply
      });
    }
    function writeMem(a) {
      var hub = pick(a.mem);
      send(a, hub, function () {
        var readers = hub.mem.filter(function (n) { return n !== a; });
        if (readers.length && Math.random() < .7) later(function () { send(hub, pick(readers)); }, 200);
      });
    }
    function broadcast(a) {
      a.act = 1;
      a.adj.forEach(function (n) { send(a, n); });
      a.mem.forEach(function (n) { send(a, n); });
    }
    function randomEvent() {
      var agents = nodes.filter(function (n) { return !n.hub; }); if (!agents.length) return;
      var r = Math.random(), withMem = agents.filter(function (n) { return n.mem.length; });
      if (r < .2 && withMem.length) writeMem(pick(withMem));
      else if (r < .95) { var a = pick(agents); if (a.adj.length) relay(a, pick(a.adj), 3); }
      else broadcast(pick(agents));
    }

    function update(dt) {
      clock += dt;
      if (clock > nextEvt) { randomEvent(); nextEvt = clock + (130 + Math.random() * 220) * Math.max(.6, Math.min(1.6, 120 / Math.max(nodes.length, 1))); }
      packets = packets.filter(function (k) {
        k.t += dt / k.dur;
        if (k.t >= 1) { k.to.act = 1; if (k.then) k.then(); return false; }
        return true;
      });
      var d = dt / 1000;
      edges.forEach(function (e) { e.act = Math.max(0, e.act - d * .45); });
      nodes.forEach(function (n) { n.act = Math.max(0, n.act - d * .32); });
    }
    function frame(ts) {
      var dt = last ? Math.min(ts - last, 50) : 16; last = ts;
      update(dt); draw(); raf = requestAnimationFrame(frame);
    }
    function sync() {
      var go = visible && !document.hidden && !reduce;
      if (go && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
      else if (!go && running) { running = false; cancelAnimationFrame(raf); }
    }

    // ---- interaction (events arrive via the hero, since the content layer sits above the canvas)
    function nodeAt(e) {
      var r = hero.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 16;
      nodes.forEach(function (n) { var d = Math.hypot(n.x - x, n.y - y); if (d < bd && n.f > .3) { bd = d; best = n; } });
      return best;
    }
    hero.addEventListener('pointermove', function (e) {
      var n = e.target.closest('a, button') ? null : nodeAt(e);
      if (n !== hover) { hover = n; hero.style.cursor = n && !n.hub ? 'pointer' : ''; if (!running) draw(); }
    });
    hero.addEventListener('pointerleave', function () { hover = null; hero.style.cursor = ''; if (!running) draw(); });
    hero.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      var n = nodeAt(e);
      if (n && !n.hub) { broadcast(n); if (!running) draw(); }
    });

    var rt;
    new ResizeObserver(function () {
      if (Math.abs(hero.clientWidth - W) < 2 && Math.abs(hero.clientHeight - H) < 2) return;
      clearTimeout(rt); rt = setTimeout(layout, 120);
    }).observe(hero);
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; sync(); }).observe(hero);
    document.addEventListener('visibilitychange', sync);
    function retheme() { readColors(); drawBase(); draw(); }
    new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
    readColors(); layout(); sync();
  })();

  // Mobile menu
  var menuBtn = document.getElementById('menuBtn'), links = document.getElementById('navLinks');
  menuBtn.addEventListener('click', function () {
    var open = links.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open);
  });
  links.addEventListener('click', function (e) { if (e.target.tagName === 'A') links.classList.remove('open'); });

  // Nav border on scroll
  var nav = document.getElementById('nav');
  addEventListener('scroll', function () { nav.classList.toggle('scrolled', scrollY > 8); }, { passive: true });

  // Scroll spy
  var navAs = links.querySelectorAll('a');
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      navAs.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id); });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['about', 'news', 'publications', 'experience', 'service'].forEach(function (id) { spy.observe(document.getElementById(id)); });

  // Reveal on scroll (once)
  var rev = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); rev.unobserve(en.target); } });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(function (el) { rev.observe(el); });

  // News expand
  var newsBtn = document.getElementById('newsBtn'), newsList = document.getElementById('newsList');
  if (newsBtn) newsBtn.addEventListener('click', function () {
    var ex = newsList.classList.toggle('expanded');
    newsBtn.setAttribute('aria-expanded', ex);
    newsBtn.querySelector('span').textContent = ex ? 'Show less' : 'Show all news';
  });

  // Publication filters
  var chips = document.querySelectorAll('#filters .chip'), pubs = document.querySelectorAll('.pub, .prow');
  var others = document.getElementById('others'), otherRows = others ? others.querySelectorAll('.prow') : [];
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      chips.forEach(function (x) { x.classList.toggle('on', x === c); });
      var f = c.dataset.f;
      pubs.forEach(function (p) {
        var show = f === 'all' || p.dataset.tags.split(' ').indexOf(f) > -1;
        p.classList.toggle('hidden', !show);
        if (show) { p.style.animation = 'none'; p.offsetHeight; p.style.animation = 'fadeUp .35s ease both'; }
      });
      if (others) others.classList.toggle('hidden', ![].some.call(otherRows, function (r) { return !r.classList.contains('hidden'); }));
    });
  });

  // Abstract drawers
  document.querySelectorAll('.act.abs, .plinks .abs').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = b.closest('[data-tags]').querySelector('.drawer');
      var open = d.classList.toggle('open');
      b.setAttribute('aria-expanded', open);
    });
  });

  // BibTeX copy
  var toast = document.getElementById('toast'), tt;
  function showToast(msg) {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(tt); tt = setTimeout(function () { toast.classList.remove('show'); }, 1800);
  }
  document.querySelectorAll('.act.bib, .plinks .bib').forEach(function (b) {
    b.addEventListener('click', function () {
      var text = b.dataset.bib;
      var done = function () { showToast('BibTeX copied to clipboard'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
      } else { fallback(text); done(); }
    });
  });
  function fallback(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
})();
