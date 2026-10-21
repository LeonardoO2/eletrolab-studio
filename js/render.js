// Desenho do diagrama no canvas: seções, trilhos, fios ortogonais coloridos pela tensão,
// bloco do CLP com ligações lógicas, acoplamento dos relés, realce de rede e legenda.
const Render = (function () {
  const G = Geometry;
  const C = {
    bg: '#111923', grid: '#18232f', gridMajor: '#213040',
    neutral: '#8aa0b6', pos: '#ffb454', posDim: '#c2845a', neg: '#4aa3ff', negDim: '#4a82b8',
    plc: '#8ca8f9', accent: '#43c6ac', warn: '#f6c85f', part: '#d8e3ef', text: '#aebdcb', muted: '#8397ab', danger: '#ff7777'
  };

  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function mix(c1, c2, t) {
    const a = hex(c1), b = hex(c2);
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')';
  }
  function voltColor(v, vs) {
    const t = Math.max(0, Math.min(1, v / Math.max(1, vs)));
    return t < 0.03 ? C.neg : (t > 0.97 ? C.pos : mix(C.neg, C.pos, t));
  }
  const isRail = p => p.type === 'rail_pos' || p.type === 'rail_neg';
  const isPush = p => p.type === 'push_no' || p.type === 'push_nc' || p.type === 'estop' || p.type === 'thermal' || p.type === 'sensor_ind';
  const isVertical = p => Math.abs(Math.sin((p.rotation || 0) * Math.PI / 180)) > 0.5;
  const sortTags = (a, b) => a.localeCompare(b, undefined, { numeric: true });

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function strokePoly(ctx, pts, rad) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const r = Math.min(rad, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / 2, Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) / 2);
      ctx.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }
  function polyLen(pts) { let l = 0; for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); return l; }
  function pointAt(pts, d) {
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (d <= l || i === pts.length - 2) { const t = l ? Math.min(1, d / l) : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }; }
      d -= l;
    }
    return pts[0];
  }

  // ---------- contexto de um quadro ----------
  function makeCtx(ctx, W, H, st) {
    const world = st.world;
    const nets = Solver.analyzeNets(world.parts, world.wires);
    const deg = {};
    world.wires.forEach(w => [w.a, w.b].forEach(e => { const k = e.id + ':' + e.pin; deg[k] = (deg[k] || 0) + 1; }));
    const run = !!(st.running && world.sim.ok);
    return { ctx, W, H, st, world, nets, deg, run, vs: (world.sim && world.sim.V) || 24, t: st.time || 0, byId: Object.fromEntries(world.parts.map(p => [p.id, p])) };
  }

  function netColor(o, key) {
    const root = o.nets.netOf[key];
    if (o.run && o.world.pinV && key in o.world.pinV) return voltColor(o.world.pinV[key], o.vs);
    const role = o.nets.role[root];
    return role === 'pos' ? C.posDim : (role === 'neg' ? C.negDim : C.neutral);
  }

  // ---------- grade e seções ----------
  function drawGrid(o) {
    const { ctx, st } = o, v = st.view;
    if (!st.showGrid || v.s < 0.4) return;
    const x0 = -v.ox / v.s, y0 = -v.oy / v.s, x1 = x0 + o.W / v.s, y1 = y0 + o.H / v.s;
    ctx.lineWidth = 1 / v.s;
    for (let pass = 0; pass < 2; pass++) {
      const step = pass ? 100 : 20;
      ctx.strokeStyle = pass ? C.gridMajor : C.grid;
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    }
  }

  function drawZone(o, z, sel, ghost) {
    const ctx = o.ctx;
    rrect(ctx, z.x, z.y, z.w, z.h, 14);
    ctx.fillStyle = 'rgba(120,150,190,0.045)'; ctx.fill();
    ctx.setLineDash(sel ? [] : [7, 5]); ctx.lineWidth = sel ? 2 : 1.4; ctx.strokeStyle = sel ? C.accent : '#2f4258'; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = sel ? C.accent : C.muted; ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px';
    ctx.fillText(String(z.label || '').toUpperCase(), z.x + 12, z.y + 19);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  // ---------- ligações lógicas (CLP) e acoplamento mecânico (relé) ----------
  const cpuRows = world => G.cpuRows(world);
  const cpuAnchor = (cpu, side, idx) => G.cpuAnchor(cpu, side, idx);

  function bez(ctx, a, c1, c2, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); ctx.stroke(); }

  function drawLinks(o) {
    const { ctx, world, st } = o;
    // acoplamento mecânico: bobina ↔ contatos do mesmo relé
    world.parts.filter(p => p.type === 'relay_coil').forEach(c => {
      world.parts.filter(k => (k.type === 'relay_no' || k.type === 'relay_nc') && k.ref === c.name).forEach(k => {
        const on = o.run && c.energized, mx = (c.x + k.x) / 2;
        ctx.strokeStyle = C.warn; ctx.globalAlpha = on ? 0.95 : 0.4; ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]); ctx.lineDashOffset = on ? -o.t / 60 : 0;
        if (Math.abs(c.x - k.x) < 1) { ctx.beginPath(); ctx.moveTo(c.x + 14, c.y); ctx.lineTo(k.x + 14, k.y); ctx.stroke(); }
        else bez(ctx, { x: c.x + 18, y: c.y }, { x: mx, y: c.y }, { x: mx, y: k.y }, { x: k.x - 18, y: k.y });
        ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
      });
    });
    // ligações lógicas: módulo de E/S ↔ linha da tag no bloco do CLP
    const cpu = world.parts.find(p => p.type === 'plc_cpu');
    if (!cpu) return;
    const rows = cpuRows(world);
    // traços ortogonais (roteamento em Geometry.logicLink, coberto por teste)
    world.parts.filter(p => (p.type === 'plc_input' || p.type === 'plc_output') && p.tag).forEach(m => {
      const pts = G.logicLink(world, m, rows);
      if (!pts) return;
      const isIn = m.type === 'plc_input';
      const val = o.run && !!world.rt.tags[m.tag];
      const focus = st.selected === m.id || st.hoverPart === m.id || (st.hoverTag && m.tag === st.hoverTag);
      ctx.strokeStyle = C.plc; ctx.lineWidth = val || focus ? 2 : 1.3; ctx.lineJoin = 'round';
      ctx.globalAlpha = val || focus ? 0.95 : 0.34;
      // o traço vai do módulo ao CLP; o sinal anda nesse sentido nas entradas e no oposto nas saídas
      ctx.setLineDash([6, 5]); ctx.lineDashOffset = val ? (isIn ? -o.t / 50 : o.t / 50) : 0;
      strokePoly(ctx, pts, 8);
      ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
    });
  }

  // ---------- trilhos ----------
  function drawRail(o, p, ghost) {
    const { ctx } = o, pins = G.pinsWorld(p), a = pins[0], b = pins[pins.length - 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const pos = p.type === 'rail_pos', key = p.id + ':0';
    const col = o.run ? voltColor(o.world.pinV[key] || 0, o.vs) : (pos ? C.pos : C.neg);
    const hot = o.st.hoverRoot && o.nets.netOf[key] === o.st.hoverRoot;
    const sel = p.id === o.st.selected;
    ctx.lineCap = 'round';
    if (hot || sel) { ctx.strokeStyle = sel ? 'rgba(67,198,172,.35)' : 'rgba(246,200,95,.35)'; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(a.x - ux * 10, a.y - uy * 10); ctx.lineTo(b.x + ux * 10, b.y + uy * 10); ctx.stroke(); }
    ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(a.x - ux * 10, a.y - uy * 10); ctx.lineTo(b.x + ux * 10, b.y + uy * 10); ctx.stroke();
    ctx.lineCap = 'butt';
    // marcas dos pontos de ligação
    pins.forEach((q, i) => {
      const k = p.id + ':' + i, used = (o.deg[k] || 0) > 0;
      ctx.beginPath(); ctx.arc(q.x, q.y, used ? 4.5 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = used ? '#10161e' : 'rgba(10,16,22,.55)'; ctx.fill();
      if (used) { ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); }
    });
    // rótulo
    const vert = Math.abs(uy) > 0.5, lx = Math.min(a.x, b.x), ly = Math.min(a.y, b.y);
    ctx.fillStyle = col; ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif'; ctx.textBaseline = 'middle';
    const tx = vert ? lx : lx - 16, ty = vert ? ly - 24 : Math.min(a.y, b.y);
    ctx.textAlign = vert ? 'center' : 'right';
    ctx.fillText(p.name, tx, ty - (vert ? 0 : 6));
    ctx.fillStyle = C.muted; ctx.font = '10px "Segoe UI", Arial, sans-serif';
    ctx.fillText(pos ? 'alimentação' : 'referência', tx, ty + (vert ? 12 : 8));
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- fios ----------
  function drawWires(o) {
    const { ctx, world, st } = o, routes = [];
    world.wires.forEach((w, i) => {
      const pts = G.wireRoute(world, w);
      routes.push(pts);
      if (!pts) return;
      const key = w.a.id + ':' + w.a.pin;
      const col = netColor(o, key);
      const hot = st.hoverRoot && o.nets.netOf[key] === st.hoverRoot;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (hot) { ctx.strokeStyle = 'rgba(246,200,95,.38)'; ctx.lineWidth = 8; strokePoly(ctx, pts, 7); }
      if (i === st.selectedWire) { ctx.strokeStyle = 'rgba(246,200,95,.6)'; ctx.lineWidth = 8; strokePoly(ctx, pts, 7); }
      ctx.strokeStyle = col; ctx.lineWidth = 2.6; strokePoly(ctx, pts, 7);
      if (o.run && w.flow) {
        const L = polyLen(pts), gap = 26, off = (o.t / 1000 * 55) % gap;
        ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9;
        for (let d = off; d < L; d += gap) {
          const q = pointAt(pts, w.flow > 0 ? d : L - d);
          ctx.beginPath(); ctx.arc(q.x, q.y, 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    });
    o.routes = routes;
  }

  // Numeração automática de fios: um número por rede (equipotencial), da esquerda para a direita.
  // Redes dos trilhos (+24V e 0V) já têm nome e não recebem número.
  function wireNumbers(o) {
    const { world } = o, nets = {};
    world.wires.forEach((w, i) => {
      const pts = o.routes && o.routes[i]; if (!pts) return;
      const net = o.nets.netOf[w.a.id + ':' + w.a.pin];
      if (!net || o.nets.role[net]) return;
      const n = nets[net] || (nets[net] = { net, minX: Infinity, minY: Infinity, best: null, bestLen: 0 });
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
        n.minX = Math.min(n.minX, a.x, b.x); n.minY = Math.min(n.minY, a.y, b.y);
        if (len > n.bestLen) { n.bestLen = len; n.best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      }
    });
    return Object.values(nets).sort((a, b) => a.minX - b.minX || a.minY - b.minY).map((n, i) => Object.assign(n, { num: i + 1 }));
  }
  function drawWireNums(o) {
    if (!o.st.showWireNums) return;
    const { ctx } = o;
    wireNumbers(o).forEach(n => {
      if (!n.best || n.bestLen < 30) return;
      const t = String(n.num), w = 8 + t.length * 6.4;
      ctx.fillStyle = 'rgba(17,25,35,.92)'; ctx.strokeStyle = 'rgba(131,151,171,.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(n.best.x - w / 2, n.best.y - 7, w, 14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.text; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t, n.best.x, n.best.y + 0.5); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    });
  }

  // pinos dos componentes + pontos de junção
  function drawPins(o) {
    const { ctx, world, st } = o;
    world.parts.forEach(p => {
      if (isRail(p)) return;
      const lab = Engine.DEFAULTS[p.type].labels || [];
      G.pinsWorld(p).forEach((q, i) => {
        const k = p.id + ':' + i, n = o.deg[k] || 0, col = netColor(o, k);
        const hot = st.hoverRoot && o.nets.netOf[k] === st.hoverRoot;
        const hoverPin = st.hoverPin && st.hoverPin.id === p.id && st.hoverPin.pin === i;
        ctx.beginPath(); ctx.arc(q.x, q.y, n >= 2 ? 4.2 : 3.4, 0, Math.PI * 2);
        if (n > 0) { ctx.fillStyle = col; ctx.fill(); } else { ctx.fillStyle = '#111923'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = C.neutral; ctx.stroke(); }
        if (hot || hoverPin) { ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = C.warn; ctx.stroke(); }
        if (st.showLabels && lab[i]) {
          ctx.fillStyle = C.muted; ctx.font = '9px "Segoe UI", Arial, sans-serif';
          if (q.dx !== 0) { ctx.textAlign = 'center'; ctx.fillText(lab[i], q.x - q.dx * 10, q.y - 7); }
          else { ctx.textAlign = 'left'; ctx.fillText(lab[i], q.x + 8, q.y - q.dy * 9 + 3); }
        }
      });
    });
    // junções: pino de um componente com 2+ fios (já desenhado maior); pinos de trilho ligados têm anel próprio
  }

  // ---------- componentes ----------
  // Módulos de E/S e bobinas já trazem o próprio nome dentro do símbolo; o rótulo ao lado só aparece
  // quando o usuário deu um nome diferente do automático (senão só atrapalha os vizinhos).
  function autoName(p) {
    if (p.type === 'plc_input') return 'Entrada ' + String(p.tag).replace('%', '');
    if (p.type === 'plc_output') return 'Saída ' + String(p.tag).replace('%', '');
    return null;
  }
  function labelOf(o, p) {
    const lines = [];
    const selfLabeled = p.type === 'relay_coil' || (autoName(p) !== null && p.name === autoName(p));
    if (p.name && !selfLabeled) lines.push({ t: p.name, c: p.id === o.st.selected ? C.accent : C.text, f: '12px "Segoe UI", Arial, sans-serif' });
    if (p.type === 'source') lines.push({ t: (Number(p.value) || 0) + ' V', c: C.muted, f: '10px Consolas, monospace' });
    if (p.type === 'level_sw') lines.push({ t: '≥ ' + (Number(p.value) || 0) + '%', c: p.closed && o.run ? C.accent : C.muted, f: '10px Consolas, monospace' });
    if (o.run && ['lamp', 'motor_load', 'relay_coil', 'pump', 'valve'].includes(p.type)) {
      lines.push({ t: (p.simVoltage || 0).toFixed(1) + ' V', c: Math.abs(p.simVoltage) > 2 ? C.accent : C.muted, f: '10px Consolas, monospace' });
    }
    const xr = crossRef(o.world, p);
    if (xr) lines.push({ t: xr, c: C.muted, f: '10px "Segoe UI", Arial, sans-serif' });
    return lines;
  }
  // Referência cruzada: a bobina lista as seções dos seus contatos; o contato indica a seção da bobina.
  function zoneName(world, p) {
    const z = world.zones.find(q => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h);
    return z ? z.label : '';
  }
  const short = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  function crossRef(world, p) {
    if (p.type === 'relay_coil') {
      const cs = world.parts.filter(q => (q.type === 'relay_no' || q.type === 'relay_nc') && q.ref === p.name);
      if (!cs.length) return '';
      const zs = [...new Set(cs.map(q => zoneName(world, q)).filter(Boolean))];
      return '→ ' + (zs.length ? short(zs.join(', '), 11) : cs.length + ' contato' + (cs.length > 1 ? 's' : ''));
    }
    if (p.type === 'relay_no' || p.type === 'relay_nc') {
      const coil = world.parts.find(q => q.type === 'relay_coil' && q.name === p.ref);
      if (!coil) return '⚠ sem bobina';
      const z = zoneName(world, coil);
      return '← ' + short(z || coil.name, 11);
    }
    return '';
  }

  function drawLabel(o, p) {
    if (!o.st.showLabels) return;
    const ctx = o.ctx, lines = labelOf(o, p), vert = isVertical(p);
    // na bobina a leitura de tensão desce um pouco, para não ficar sob a linha tracejada do acoplamento do relé
    const x = vert ? p.x + 32 : p.x, y0 = vert ? p.y - (lines.length - 1) * 7 + (p.type === 'relay_coil' ? 16 : 0) : p.y + (p.type === 'ground' ? 28 : 40);
    ctx.textAlign = vert ? 'left' : 'center'; ctx.textBaseline = 'alphabetic';
    lines.forEach((l, i) => { ctx.fillStyle = l.c; ctx.font = l.f; ctx.fillText(l.t, x, y0 + i * 14 * (o.k || 1) + (vert ? 4 : 0)); });
  }

  function leads(ctx, a, b) {
    ctx.beginPath(); ctx.moveTo(-38, 0); ctx.lineTo(-a, 0); ctx.moveTo(38, 0); ctx.lineTo(b, 0); ctx.stroke();
  }

  const LAMP_RGB = { '': '255,214,102', yellow: '255,214,102', red: '255,90,90', green: '90,220,130' };
  function drawSwitch(ctx, closed, push, accent) {
    leads(ctx, 12, 12);
    ctx.beginPath(); ctx.arc(-12, 0, 3, 0, Math.PI * 2); ctx.moveTo(15, 0); ctx.arc(12, 0, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    if (closed) { ctx.strokeStyle = accent; ctx.lineWidth = 3; }
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(closed ? 12 : 10, closed ? 0 : -14); ctx.stroke();
    ctx.restore();
    if (push) { ctx.beginPath(); ctx.moveTo(0, closed ? -4 : -9); ctx.lineTo(0, -26); ctx.moveTo(-7, -26); ctx.lineTo(7, -26); ctx.stroke(); }
  }

  function drawPart(o, p, ghost) {
    const ctx = o.ctx, T = p.type, sel = p.id === o.st.selected;
    const plc = T === 'plc_input' || T === 'plc_output';
    const col = sel ? (plc ? '#b3c7fb' : C.accent) : (plc ? C.plc : C.part);
    const rot = (p.rotation || 0) * Math.PI / 180, vert = isVertical(p);
    const R = Geometry.localRect(p);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (sel) { ctx.save(); ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(67,198,172,.6)'; ctx.strokeRect(R.x0 - 4, R.y0 - 4, R.x1 - R.x0 + 8, R.y1 - R.y0 + 8); ctx.restore(); }

    if (T === 'source') {
      leads(ctx, 15, 15); ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
    } else if (T === 'ground') {
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.moveTo(-12, 5); ctx.lineTo(12, 5); ctx.moveTo(-8, 10); ctx.lineTo(8, 10); ctx.moveTo(-4, 15); ctx.lineTo(4, 15); ctx.stroke();
    } else if (T === 'push_no' || T === 'push_nc') {
      drawSwitch(ctx, p.closed, true, C.accent);
    } else if (T === 'estop') {
      drawSwitch(ctx, p.closed, true, C.accent);
      ctx.beginPath(); ctx.arc(0, -29, 8, Math.PI, 0); ctx.closePath(); ctx.fillStyle = p.closed ? '#c0392b' : '#7b2a22'; ctx.fill(); ctx.stroke();
    } else if (T === 'thermal') {
      drawSwitch(ctx, p.closed, false, C.accent);
      ctx.beginPath(); ctx.moveTo(-8, -22); ctx.lineTo(-4, -28); ctx.lineTo(0, -22); ctx.lineTo(4, -28); ctx.lineTo(8, -22); ctx.stroke();
      if (!p.closed) { ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(14, -26, 3.5, 0, Math.PI * 2); ctx.fill(); }
    } else if (T === 'sensor_ind') {
      drawSwitch(ctx, p.closed, false, C.accent);
      ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(8, -25); ctx.lineTo(0, -18); ctx.lineTo(-8, -25); ctx.closePath();
      if (p.closed) { ctx.fillStyle = 'rgba(67,198,172,.55)'; ctx.fill(); } ctx.stroke();
    } else if (T === 'relay_no' || T === 'relay_nc') {
      drawSwitch(ctx, p.closed, false, C.accent);
    } else if (T === 'relay_coil') {
      leads(ctx, 20, 20); ctx.beginPath(); ctx.rect(-20, -12, 40, 24); ctx.stroke();
      if (p.energized) { ctx.fillStyle = C.accent; ctx.fillRect(-16, -8, 32, 16); }
    } else if (T === 'lamp') {
      leads(ctx, 15, 15);
      if (o.run && Math.abs(p.simVoltage) > 2) {
        const lc = LAMP_RGB[p.color] || LAMP_RGB[''];
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 30); g.addColorStop(0, 'rgba(' + lc + ',.75)'); g.addColorStop(1, 'rgba(' + lc + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.moveTo(-9, -9); ctx.lineTo(9, 9); ctx.moveTo(9, -9); ctx.lineTo(-9, 9); ctx.stroke();
    } else if (T === 'motor_load') {
      leads(ctx, 17, 17); ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
    } else if (T === 'level_sw') {
      drawSwitch(ctx, p.closed, false, C.accent);
      // boia sobre o contato: preenchida quando o nível alcança o sensor
      ctx.beginPath(); ctx.ellipse(0, -23, 9, 4.5, 0, 0, Math.PI * 2);
      if (p.closed) { ctx.fillStyle = 'rgba(67,198,172,.55)'; ctx.fill(); }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-9, -30); ctx.quadraticCurveTo(-4.5, -33, 0, -30); ctx.quadraticCurveTo(4.5, -27, 9, -30); ctx.stroke();
    } else if (T === 'pump') {
      leads(ctx, 17, 17); ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(9, 0); ctx.lineTo(-6, 8); ctx.closePath();
      if (p.energized) { ctx.fillStyle = 'rgba(67,198,172,.5)'; ctx.fill(); }
      ctx.stroke();
    } else if (T === 'valve') {
      leads(ctx, 13, 13);
      ctx.beginPath(); ctx.moveTo(-13, -10); ctx.lineTo(13, 10); ctx.lineTo(13, -10); ctx.lineTo(-13, 10); ctx.closePath();
      if (p.energized) { ctx.fillStyle = 'rgba(67,198,172,.45)'; ctx.fill(); }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -14); ctx.stroke();                 // haste do atuador (solenoide)
      ctx.strokeRect(-7, -23, 14, 9);
    } else if (plc) {
      const half = vert ? 17 : 26;
      leads(ctx, half, half);
    }
    ctx.restore();

    // textos e corpos que ficam sempre em pé
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.textBaseline = 'alphabetic';
    if (isPush(p) && o.run && !o.st.everPressed) {          // convite para apertar o botão
      const k = 0.5 + 0.5 * Math.sin(o.t / 260);
      ctx.strokeStyle = 'rgba(67,198,172,' + (0.35 + 0.55 * k).toFixed(2) + ')'; ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(0, 0, 25 + 3 * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (T === 'source') {
      const [c, s] = [Math.cos(rot), Math.sin(rot)], at = (lx, ly) => [lx * c - ly * s, lx * s + ly * c];
      ctx.fillStyle = C.accent; ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center';
      const m = at(-7, 0), pl = at(7, 0);
      ctx.fillText('−', m[0], m[1] + 5); ctx.fillText('+', pl[0], pl[1] + 5);
    } else if (T === 'relay_coil') {
      ctx.fillStyle = p.energized ? '#06221d' : C.part; ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.name || 'K', 0, 4);
    } else if (T === 'motor_load') {
      ctx.fillStyle = C.part; ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('M', 0, 5);
      if (o.run && Math.abs(p.simVoltage) > 5) {
        const a = o.t / 160; ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath();
        ctx.arc(0, 0, 11, a, a + 1.5); ctx.stroke();
      }
    } else if (T === 'pump') {
      if (o.run && p.energized) {                                                     // anel girando em volta da bomba
        const a = o.t / 140; ctx.strokeStyle = C.accent; ctx.lineWidth = 2.2; ctx.beginPath();
        ctx.arc(0, 0, 22, a, a + 1.6); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 22, a + Math.PI, a + Math.PI + 1.6); ctx.stroke();
      }
    } else if (plc) {
      const w = 62, h = 34, isIn = T === 'plc_input';
      const lit = o.run && (isIn ? !!o.world.rt.tags[p.tag] : !!p.outOn);
      if (o.st.hoverTag && p.tag === o.st.hoverTag) {       // tag em foco no Ladder (ou sob o mouse)
        ctx.save(); ctx.shadowColor = C.warn; ctx.shadowBlur = 14;
        rrect(ctx, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 8); ctx.lineWidth = 2.2; ctx.strokeStyle = C.warn; ctx.stroke(); ctx.restore();
      }
      rrect(ctx, -w / 2, -h / 2, w, h, 6);
      ctx.fillStyle = lit ? C.plc : '#111923'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = sel ? '#b3c7fb' : C.plc; ctx.stroke();
      // texto preso à caixa do módulo: usa o contexto sem a ampliação de fontes
      const rc = o.raw || ctx;
      rc.fillStyle = lit ? '#10151d' : C.plc; rc.textAlign = 'center';
      rc.font = 'bold 10px "Segoe UI", Arial, sans-serif'; rc.fillText(isIn ? 'ENTRADA' : 'SAÍDA', 0, -3);
      rc.font = '10px Consolas, monospace'; rc.fillText((p.tag || '?').replace('%', ''), 0, 10);
    }
    ctx.restore();
    drawLabel(o, p);
  }

  function drawCPU(o, p) {
    const { ctx, world } = o, W = Engine.CPU_W, H = Engine.CPU_H, x = p.x - W / 2, y = p.y - H / 2;
    const sel = p.id === o.st.selected;
    const powered = world.plcPowered !== false;
    const state = !o.st.running ? 'STOP' : (powered ? 'RUN' : 'SEM ALIM.');
    const scol = state === 'RUN' ? C.accent : (state === 'STOP' ? C.muted : C.danger);

    rrect(ctx, x, y, W, H, 12); ctx.fillStyle = '#141d29'; ctx.fill();
    ctx.lineWidth = sel ? 2.5 : 2; ctx.strokeStyle = sel ? '#b3c7fb' : C.plc; ctx.stroke();
    // cabeçalho
    ctx.save(); rrect(ctx, x, y, W, 28, 12); ctx.clip();
    ctx.fillStyle = 'rgba(140,168,249,.16)'; ctx.fillRect(x, y, W, 28); ctx.restore();
    ctx.fillStyle = C.plc; ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(p.name || 'CLP', x + 12, y + 14);
    ctx.textAlign = 'right'; ctx.fillStyle = scol; ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
    ctx.fillText(state, x + W - 24, y + 14);
    ctx.beginPath(); ctx.arc(x + W - 13, y + 14, 4.5, 0, Math.PI * 2); ctx.fillStyle = scol; ctx.fill();

    const rows = cpuRows(world);
    ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = C.muted;
    ctx.textAlign = 'left'; ctx.fillText('ENTRADAS', x + 12, y + 42);
    ctx.textAlign = 'right'; ctx.fillText('SAÍDAS', x + W - 12, y + 42);
    const draw = (list, isIn) => {
      list.slice(0, 4).forEach((tag, i) => {
        const a = cpuAnchor(p, isIn ? 'in' : 'out', i), on = o.run && !!world.rt.tags[tag];
        const lx = isIn ? a.x + 14 : a.x - 14;
        if (o.st.hoverTag === tag) {
          rrect(ctx, isIn ? a.x + 3 : a.x - 93, a.y - 10, 90, 20, 7);
          ctx.fillStyle = 'rgba(246,200,95,.18)'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = C.warn; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(lx, a.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = on ? C.plc : '#111923'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.plc; ctx.stroke();
        ctx.fillStyle = on ? '#e3ebff' : C.text; ctx.font = '12px Consolas, monospace'; ctx.textAlign = isIn ? 'left' : 'right';
        ctx.fillText(tag, isIn ? lx + 10 : lx - 10, a.y);
        ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fillStyle = C.plc; ctx.fill();
      });
      if (list.length > 4) { ctx.fillStyle = C.muted; ctx.font = '10px "Segoe UI", Arial, sans-serif'; ctx.textAlign = isIn ? 'left' : 'right'; ctx.fillText('+' + (list.length - 4) + ' mais', isIn ? x + 26 : x + W - 26, y + 58 + 4 * 20); }
    };
    draw(rows.ins, true); draw(rows.outs, false);
    // temporizadores
    const timers = world.program.filter(r => r.out && (r.out.type === 'ton' || r.out.type === 'tof')).map(r => r.out).slice(0, 2);
    timers.forEach((t, i) => {
      const ty = y + 150 + i * 20, rt = world.rt.timers && world.rt.timers[t.tag], acc = o.run && rt ? rt.acc : 0, pre = Math.max(1, Number(t.preset) || 1);
      const frac = Math.min(1, acc / pre), done = o.run && rt && rt.dn;
      ctx.fillStyle = C.muted; ctx.font = '11px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(t.tag + ' ' + t.type.toUpperCase(), x + 12, ty);
      rrect(ctx, x + 66, ty - 5, 90, 10, 4); ctx.fillStyle = '#0e151e'; ctx.fill();
      if (frac > 0) { rrect(ctx, x + 66, ty - 5, Math.max(6, 90 * (t.type === 'tof' ? 1 - frac : frac)), 10, 4); ctx.fillStyle = done ? C.accent : C.plc; ctx.fill(); }
      ctx.fillStyle = C.text; ctx.font = '9px Consolas, monospace'; ctx.textAlign = 'right';
      ctx.fillText((acc / 1000).toFixed(1) + '/' + (pre / 1000).toFixed(1) + 's', x + W - 10, ty);
    });
    ctx.textBaseline = 'alphabetic';
    drawLabelCPU(o, p);
  }
  function drawLabelCPU() { /* o nome já aparece no cabeçalho */ }

  function drawAnyPart(o, p) {
    if (isRail(p)) drawRail(o, p); else if (p.type === 'plc_cpu') drawCPU(o, p); else drawPart(o, p);
  }

  // ---------- sobreposições ----------
  function drawOverlays(o) {
    const { ctx, st, world } = o;
    if (st.placing) {
      const m = st.mouseSnap;
      ctx.save(); ctx.globalAlpha = 0.6;
      if (st.placing === 'zone') drawZone(o, { x: m.x, y: m.y, w: 260, h: 200, label: 'Seção' }, false);
      else {
        const d = Engine.DEFAULTS[st.placing];
        const g = Engine.createWorld(); const gp = Engine.makePart(g, st.placing, m.x, m.y, { rotation: st.placingRot, name: d.name, len: d.len || 0 });
        const o2 = Object.assign({}, o, { world: g, deg: {}, run: false, st: Object.assign({}, st, { selected: null, hoverRoot: null }) });
        drawAnyPart(o2, gp);
      }
      ctx.restore();
    }
    if (st.pendingPin) {
      const p = o.byId[st.pendingPin.id], a = p && G.pinWorld(p, st.pendingPin.pin);
      if (a) {
        const m = st.mouse, tgt = st.hoverPin ? G.pinWorld(o.byId[st.hoverPin.id], st.hoverPin.pin) : null;
        const pts = tgt ? G.route(a, tgt) : G.simplify([{ x: a.x, y: a.y }, { x: a.x + a.dx * G.STUB, y: a.y + a.dy * G.STUB },
          a.dx !== 0 ? { x: m.x, y: a.y + a.dy * G.STUB } : { x: a.x, y: m.y }, { x: m.x, y: m.y }]);
        ctx.strokeStyle = C.warn; ctx.lineWidth = 2.2; ctx.setLineDash([6, 4]); ctx.lineJoin = 'round'; strokePoly(ctx, pts, 7); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.stroke();
      }
    }
    if (st.mode === 'wire' && st.hoverPin) {
      const q = G.pinWorld(o.byId[st.hoverPin.id], st.hoverPin.pin);
      if (q) { ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = C.accent; ctx.stroke(); }
    }
  }

  function drawLegend(ctx, W, H, st) {
    if (!st.showLegend) return;
    const items = [
      { c: C.pos, t: '+24V (alimentação)', k: 'line' }, { c: C.neg, t: '0V (referência)', k: 'line' },
      { c: C.plc, t: 'sinal lógico do CLP', k: 'dash' }, { c: C.warn, t: 'acoplamento do relé', k: 'dash' }
    ];
    // Faixa horizontal embaixo (o diagrama é enquadrado acima dela); em janela estreita vira coluna.
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    const icon = 28, gap = 20, pad = 12, widths = items.map(it => icon + 8 + ctx.measureText(it.t).width);
    const rowW = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1) + pad * 2;
    const stacked = rowW > W - 28;
    const x = 14, w = stacked ? 170 : rowW, h = stacked ? items.length * 18 + 14 : 26, y = H - h - (stacked ? 14 : 6);
    rrect(ctx, x, y, w, h, 8); ctx.fillStyle = 'rgba(16,22,30,.86)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#2a394b'; ctx.stroke();
    let cx = x + pad;
    items.forEach((it, i) => {
      const yy = stacked ? y + 16 + i * 18 : y + h / 2, lx = stacked ? x + 10 : cx;
      ctx.strokeStyle = it.c; ctx.lineWidth = 2.4; ctx.setLineDash(it.k === 'dash' ? [5, 3] : []);
      ctx.beginPath(); ctx.moveTo(lx, yy); ctx.lineTo(lx + icon, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(it.t, lx + icon + 8, yy);
      cx += widths[i] + gap;
    });
    ctx.textBaseline = 'alphabetic';
  }

  // Em zoom baixo o texto ficaria ilegível: as fontes crescem até 20% para manter cerca de 9 px na tela.
  function scaledCtx(ctx, k) {
    return new Proxy(ctx, {
      get(t, key) { const v = t[key]; return typeof v === 'function' ? v.bind(t) : v; },
      set(t, key, val) {
        if (key === 'font') val = String(val).replace(/(\d+(?:\.\d+)?)px/, (m, n) => (n * k).toFixed(1) + 'px');
        t[key] = val; return true;
      }
    });
  }

  // ---------- quadro completo ----------
  function draw(ctx, W, H, dpr, st) {
    const v = st.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const k = Math.max(1, Math.min(1.2, 9.5 / (10 * v.s)));
    const o = makeCtx(k > 1.01 ? scaledCtx(ctx, k) : ctx, W, H, st); o.k = k; o.raw = ctx;
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy);
    drawGrid(o);
    st.world.zones.forEach(z => drawZone(o, z, z.id === st.selectedZone));
    drawLinks(o);
    st.world.parts.filter(isRail).forEach(p => drawRail(o, p));
    drawWires(o);
    drawWireNums(o);
    st.world.parts.filter(p => !isRail(p) && p.type !== 'plc_cpu').forEach(p => drawPart(o, p));
    st.world.parts.filter(p => p.type === 'plc_cpu').forEach(p => drawCPU(o, p));
    drawPins(o);
    drawOverlays(o);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLegend(ctx, W, H, st);
    return o.nets;
  }

  return { draw, voltColor, C, crossRef, wireNumbers };
})();
