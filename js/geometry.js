// Geometria do diagrama: posição dos pinos, roteamento ortogonal dos fios e áreas de clique.
// Não depende de DOM, então pode ser testado em Node.
const Geometry = (function () {
  const E = (typeof module !== 'undefined') ? require('./engine.js') : Engine;
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const EPS = 1e-6;
  const STUB = 12; // trecho reto que sai do pino antes de qualquer curva

  function cs(p) { const a = (p.rotation || 0) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; }

  // Pino i do componente p em coordenadas do mundo, com a direção de saída (dx,dy) já girada.
  function pinWorld(p, i) {
    const l = E.pinLocal(p)[i];
    if (!l) return null;
    const [c, s] = cs(p);
    return {
      x: r6(p.x + l.x * c - l.y * s), y: r6(p.y + l.x * s + l.y * c),
      dx: Math.round(l.dx * c - l.dy * s), dy: Math.round(l.dx * s + l.dy * c)
    };
  }
  function pinsWorld(p) { return E.pinLocal(p).map((_, i) => pinWorld(p, i)); }

  function simplify(pts) {
    const out = [];
    pts.forEach(p => {
      const q = out[out.length - 1];
      if (!q || Math.abs(q.x - p.x) > EPS || Math.abs(q.y - p.y) > EPS) out.push(p);
    });
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 1; i < out.length - 1; i++) {
        const a = out[i - 1], b = out[i], c = out[i + 1];
        if ((Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) || (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS)) {
          out.splice(i, 1); changed = true; break;
        }
      }
    }
    return out;
  }

  // Caminho só com segmentos horizontais e verticais entre dois pinos (cada um com sua direção de saída).
  function route(a, b) {
    const a1 = { x: a.x + a.dx * STUB, y: a.y + a.dy * STUB };
    const b1 = { x: b.x + b.dx * STUB, y: b.y + b.dy * STUB };
    const aH = a.dx !== 0, bH = b.dx !== 0;
    const pts = [{ x: a.x, y: a.y }, a1];
    if (aH && bH) { const mx = (a1.x + b1.x) / 2; pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y }); }
    else if (!aH && !bH) { const my = (a1.y + b1.y) / 2; pts.push({ x: a1.x, y: my }, { x: b1.x, y: my }); }
    else if (aH && !bH) pts.push({ x: b1.x, y: a1.y });
    else pts.push({ x: a1.x, y: b1.y });
    pts.push(b1, { x: b.x, y: b.y });
    return simplify(pts);
  }

  function partById(world, id) { return world.parts.find(p => p.id === id); }

  function wireRoute(world, wire) {
    const pa = partById(world, wire.a.id), pb = partById(world, wire.b.id);
    if (!pa || !pb) return null;
    const a = pinWorld(pa, wire.a.pin), b = pinWorld(pb, wire.b.pin);
    if (!a || !b) return null;
    return route(a, b);
  }

  function localRect(p) {
    switch (p.type) {
      case 'plc_cpu': return { x0: -E.CPU_W / 2, y0: -E.CPU_H / 2, x1: E.CPU_W / 2, y1: E.CPU_H / 2 };
      case 'rail_pos': case 'rail_neg': { const h = (Number(p.len) || 8) * 10 + 10; return { x0: -9, y0: -h, x1: 9, y1: h }; }
      case 'ground': return { x0: -16, y0: -8, x1: 16, y1: 20 };
      default: return { x0: -32, y0: -24, x1: 32, y1: 24 };
    }
  }

  function partHit(p, x, y) {
    const [c, s] = cs(p), dx = x - p.x, dy = y - p.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c, r = localRect(p);
    return lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1;
  }

  function partBounds(p) {
    const r = localRect(p), [c, s] = cs(p);
    const xs = [], ys = [];
    [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].forEach(([lx, ly]) => {
      xs.push(p.x + lx * c - ly * s); ys.push(p.y + lx * s + ly * c);
    });
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  function contentBounds(world) {
    let b = null;
    const add = r => { b = b ? { x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) } : r; };
    world.parts.forEach(p => {
      const r = partBounds(p);
      if (p.type === 'rail_pos' || p.type === 'rail_neg') { r.x0 -= 70; r.y0 -= 20; } // rótulo do trilho
      else { r.x0 -= 6; r.y0 -= 6; r.x1 += 90; r.y1 += 30; }                            // nome ao lado/abaixo
      add(r);
    });
    (world.zones || []).forEach(z => add({ x0: z.x, y0: z.y, x1: z.x + z.w, y1: z.y + z.h }));
    return b;
  }

  function nearestPin(world, x, y, radius) {
    let best = null, dist = radius;
    world.parts.forEach(p => {
      pinsWorld(p).forEach((q, i) => {
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < dist) { dist = d; best = { id: p.id, pin: i }; }
      });
    });
    return best;
  }

  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  function wireAt(world, x, y, tol) {
    for (let i = world.wires.length - 1; i >= 0; i--) {
      const pts = wireRoute(world, world.wires[i]);
      if (!pts) continue;
      for (let k = 0; k < pts.length - 1; k++) if (distToSeg(x, y, pts[k], pts[k + 1]) <= tol) return i;
    }
    return -1;
  }

  // ---------- ligações lógicas entre os módulos de E/S e as linhas de tag do bloco do CLP ----------
  const sortTags = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const isVert = p => Math.abs(Math.sin((p.rotation || 0) * Math.PI / 180)) > 0.5;

  function cpuRows(world) {
    const tags = t => [...new Set(world.parts.filter(p => p.type === t && p.tag).map(p => p.tag))].sort(sortTags);
    return { ins: tags('plc_input'), outs: tags('plc_output') };
  }
  function cpuAnchor(cpu, side, idx) {
    return { x: cpu.x + (side === 'in' ? -1 : 1) * (E.CPU_W / 2), y: cpu.y - E.CPU_H / 2 + 58 + idx * 20 };
  }

  // Caminho ortogonal do módulo até a linha da tag no CLP (o bloco mostra 4 linhas por lado; além disso, null).
  // Sai do lado do módulo que olha para o CLP, anda até a altura da linha e entra no bloco.
  // Entradas usam uma faixa vertical colada no CLP (a linha mais alta usa a faixa mais afastada, o que evita
  // cruzamentos). Saídas descem logo ao lado do módulo e cruzam as colunas vizinhas na altura da linha.
  function logicLink(world, m, rows) {
    const cpu = world.parts.find(p => p.type === 'plc_cpu');
    if (!cpu || !m.tag || (m.type !== 'plc_input' && m.type !== 'plc_output')) return null;
    rows = rows || cpuRows(world);
    const isIn = m.type === 'plc_input', idx = (isIn ? rows.ins : rows.outs).indexOf(m.tag);
    if (idx < 0 || idx > 3) return null;
    const nIn = Math.min(rows.ins.length, 4);
    const a = cpuAnchor(cpu, isIn ? 'in' : 'out', idx);
    const side = a.x >= m.x ? 1 : -1;                          // sentido do módulo para o CLP
    const s = { x: m.x + side * (isVert(m) ? 27 : 32), y: m.y };
    let lane = isIn ? a.x - 24 - 14 * (nIn - 1 - idx) : s.x + side * 18;
    if (side * (lane - s.x) < 8) lane = s.x + side * 18;       // módulo já está encostado no CLP
    if (!isIn && side * (a.x - lane) < 8) lane = a.x - side * 20;
    return simplify([s, { x: lane, y: s.y }, { x: lane, y: a.y }, a]);
  }

  return { pinWorld, pinsWorld, route, wireRoute, simplify, localRect, partHit, partBounds, contentBounds, nearestPin, wireAt, distToSeg,
           cpuRows, cpuAnchor, logicLink, STUB };
})();
if (typeof module !== 'undefined') module.exports = Geometry;
