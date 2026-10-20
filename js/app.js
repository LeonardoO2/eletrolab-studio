// Interface: edição do diagrama (canvas), zoom/pan, propriedades, abas e ciclo de simulação.
(() => {
const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d'), tooltip = $('tooltip');
const statusEl = $('status'), tagsView = $('tagsView'), ladderView = $('ladderView'), views = $('views');
const world = Engine.createWorld();
const DEFAULTS = Engine.DEFAULTS, G = Geometry;

const st = {
  world, view: { s: 1, ox: 0, oy: 0 },
  selected: null, selectedWire: null, selectedZone: null,
  mode: 'select', pendingPin: null, running: false,
  showGrid: true, showLabels: true, showLegend: true, showWireNums: true,
  placing: null, placingRot: 0, mouse: { x: 0, y: 0 }, mouseSnap: { x: 0, y: 0 },
  hoverRoot: null, hoverPin: null, hoverPart: null, hoverTag: null, hoverSource: null, everPressed: false, time: 0
};
let currentView = 'circuit', drag = null, pan = null, rafPending = false, lastFrame = 0;
let cw = 0, ch = 0, dpr = 1, didFit = false, needFit = false, lastPowered = true;

const snap = v => Math.round(v / 20) * 20;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function setStatus(s, isErr) { statusEl.textContent = s; statusEl.classList.toggle('err', !!isErr); }
const isPLCModule = p => p.type === 'plc_input' || p.type === 'plc_output';
const isRail = p => p.type === 'rail_pos' || p.type === 'rail_neg';
const isLatch = p => Engine.LATCH_TYPES.includes(p.type);
const isPush = p => p.type === 'push_no' || p.type === 'push_nc' || isLatch(p);
const hasValue = p => ['source', 'relay_coil', 'lamp', 'motor_load', 'plc_input', 'plc_cpu', 'pump', 'valve', 'level_sw'].includes(p.type);
const defaultRotation = t => (t === 'ground' || t === 'plc_cpu') ? 0 : 90;

// ---------- vista (zoom e pan) ----------
function toWorld(e) {
  const r = canvas.getBoundingClientRect(), v = st.view, sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { x: (sx - v.ox) / v.s, y: (sy - v.oy) / v.s, sx, sy };
}
function updateZoomLabel() { $('zoomLbl').textContent = Math.round(st.view.s * 100) + '%'; }
function zoomAt(f, sx, sy) {
  const v = st.view, ns = clamp(v.s * f, 0.25, 2.5), k = ns / v.s;
  v.ox = sx - (sx - v.ox) * k; v.oy = sy - (sy - v.oy) * k; v.s = ns;
  updateZoomLabel(); requestDraw();
}
function fitView() {
  const r = canvas.getBoundingClientRect(), b = G.contentBounds(world);
  if (!r.width || !r.height) return;
  const v = st.view;
  if (!b) { v.s = 1; v.ox = 60; v.oy = 60; updateZoomLabel(); requestDraw(); return; }
  const padX = 30, padY = 20, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const ah = r.height - (st.showLegend ? 32 : 0);          // a faixa da legenda fica fora do enquadramento
  v.s = clamp(Math.min((r.width - 2 * padX) / bw, (ah - 2 * padY) / bh), 0.3, 1.6);
  v.ox = (r.width - bw * v.s) / 2 - b.x0 * v.s; v.oy = (ah - bh * v.s) / 2 - b.y0 * v.s;
  updateZoomLabel(); requestDraw();
}

// ---------- desenho ----------
const plantCanvas = $('plantCanvas'), plantMini = $('plantMini');
function fitCanvas(c) {
  const r = c.getBoundingClientRect(); if (!r.width || !r.height) return null;
  const d = window.devicePixelRatio || 1, w = Math.round(r.width * d), h = Math.round(r.height * d);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w: r.width, h: r.height, d };
}
let plantShown = null;
function syncPlantFields() {
  const pl = world.plant, set = (id, v) => { const e = $(id); if (document.activeElement !== e) e.value = v; };
  set('plInit', pl.initial); set('plFill', pl.fillRate); set('plDrain', pl.drainRate);
}
function drawPlants() {
  const has = Engine.hasPlantParts(world);
  if (has !== plantShown) { plantShown = has; $('plantSection').style.display = has ? '' : 'none'; if (has) syncPlantFields(); }
  if (currentView === 'plant') {
    const f = fitCanvas(plantCanvas); if (f) PlantView.draw(plantCanvas.getContext('2d'), f.w, f.h, f.d, st, false);
  } else if (has) {
    const f = fitCanvas(plantMini); if (f) PlantView.draw(plantMini.getContext('2d'), f.w, f.h, f.d, st, true);
  }
}
function draw() { if (currentView !== 'plant' && cw && ch) Render.draw(ctx, cw, ch, dpr, st); drawPlants(); }
function requestDraw() {
  if (st.running || rafPending) return;
  rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); });
}
function resize() {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  dpr = window.devicePixelRatio || 1; cw = r.width; ch = r.height;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  if (!didFit || needFit) { didFit = true; needFit = false; fitView(); }
  draw();
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

// ---------- criação de componentes ----------
function nextTag(prefix, type) {
  const used = new Set(world.parts.filter(p => p.type === type).map(p => p.tag));
  let n = 0; while (used.has(prefix + n)) n++;
  return prefix + n;
}
function nextRelayName() {
  let n = 1; while (world.parts.some(p => p.type === 'relay_coil' && p.name === 'K' + n)) n++;
  return 'K' + n;
}
const PLANT_NAMES = { level_sw: 'Sensor B', pump: 'Bomba P', valve: 'Válvula Y', estop: 'Emergência E', thermal: 'Térmico F', sensor_ind: 'Sensor indutivo B' };
function addPart(type, x, y) {
  if (type === 'zone') {
    const z = Engine.makeZone(world, x, y, 260, 200, 'Seção');
    st.selected = null; st.selectedWire = null; st.selectedZone = z.id; st.placing = null; syncPalette();
    renderProperties(); requestDraw(); setStatus('Seção adicionada. Arraste pelo título para mover junto com os componentes.');
    return;
  }
  const o = { rotation: st.placingRot };
  if (type === 'plc_input') { o.tag = nextTag('%I0.', type); o.name = 'Entrada ' + o.tag.replace('%', ''); }
  else if (type === 'plc_output') { o.tag = nextTag('%Q0.', type); o.name = 'Saída ' + o.tag.replace('%', ''); }
  else if (type === 'relay_coil') o.name = nextRelayName();
  else if (PLANT_NAMES[type]) { let n = 1; while (world.parts.some(q => q.name === PLANT_NAMES[type] + n)) n++; o.name = PLANT_NAMES[type] + n; }
  else if (type === 'relay_no' || type === 'relay_nc') {
    const coil = world.parts.find(p => p.type === 'relay_coil');
    o.ref = coil ? coil.name : 'K1'; o.name = o.ref + (type === 'relay_no' ? ' (NA)' : ' (NF)');
  }
  const p = Engine.makePart(world, type, x, y, o);
  st.selected = p.id; st.selectedWire = null; st.selectedZone = null; st.placing = null; syncPalette();
  renderProperties(); requestDraw(); setStatus(p.name + ' adicionado.');
}
function syncPalette() {
  document.querySelectorAll('.part').forEach(el => el.classList.toggle('on', el.dataset.type === st.placing));
}

// ---------- propriedades ----------
const HINTS = {
  source: 'Pino de cima = + e pino de baixo = − quando girada a 270°. Ligue o + ao trilho +24V e o − ao trilho 0V.',
  plc_input: 'I = sinal (+24 V quando o botão fecha) e 0V = comum. Nível alto a partir de 12 V.',
  plc_output: 'Contato de saída: L+ recebe a alimentação e Q vai para a carga. Fecha quando a tag do CLP é verdadeira.',
  plc_cpu: 'Ligue L+ ao trilho +24V e M ao trilho 0V. Sem 18 V ou mais de alimentação o CLP não executa o programa.',
  relay_coil: 'A1/A2. Energiza com 12 V ou mais. Os contatos K com o mesmo nome em "Bobina associada" acompanham.',
  relay_no: 'Contato NA: fecha quando a bobina indicada em "Bobina associada" está energizada.',
  relay_nc: 'Contato NF: abre quando a bobina indicada em "Bobina associada" está energizada.',
  push_no: 'Na simulação, mantenha o botão do mouse pressionado sobre ele.',
  push_nc: 'Na simulação, mantenha o botão do mouse pressionado sobre ele.',
  level_sw: 'Contato NA que fecha quando o nível do tanque chega ao valor indicado. Ligue ao 24 V e a uma entrada do CLP.',
  pump: 'Carga de 24 V (≥ 12 V liga). Enche o tanque com a vazão definida no cartão Planta.',
  valve: 'Válvula solenoide de 24 V (≥ 12 V abre). Esvazia o tanque com a vazão definida no cartão Planta.',
  estop: 'Botão cogumelo NF com trava: na simulação, clique para acionar (abre o circuito) e clique de novo para rearmar.',
  thermal: 'Contato NF 95-96 do relé térmico. Clique na simulação para simular uma sobrecarga (abre) e clique de novo para rearmar.',
  sensor_ind: 'Sensor indutivo simplificado, contato NA. Clique na simulação para aproximar/afastar o metal.',
  rail_pos: 'Todos os pontos do trilho são a mesma rede. Ligue a fonte e os componentes a qualquer ponto.',
  rail_neg: 'Referência de 0 V. É a mesma rede de qualquer símbolo de Terra.'
};

function renderProperties() {
  const el = $('properties'), p = world.parts.find(x => x.id === st.selected), z = world.zones.find(x => x.id === st.selectedZone);
  if (!p && !z) {
    el.textContent = st.selectedWire !== null && world.wires[st.selectedWire] ? 'Fio selecionado. Pressione Delete para remover.' : 'Selecione um elemento para editar.';
    return;
  }
  el.innerHTML = '';
  const subject = p || z;
  const title = document.createElement('div'); title.style.fontWeight = '700';
  title.textContent = p ? p.name : z.label; el.appendChild(title);

  function field(label, val, apply, type) {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const l = document.createElement('label'); l.textContent = label;
    const input = document.createElement('input'); input.type = type || 'text'; input.value = val;
    input.addEventListener('change', () => {
      const err = apply(input.value);
      if (err) { setStatus(err, true); input.value = val; }
      else { val = input.value; title.textContent = p ? p.name : z.label; setStatus('Propriedade atualizada.'); }
      requestDraw();
    });
    wrap.append(l, input); el.appendChild(wrap);
  }

  if (z) {
    field('Nome da seção', z.label, v => { if (!v.trim()) return 'O nome não pode ficar vazio.'; z.label = v.trim(); });
    field('Largura', z.w, v => { const n = Number(v); if (!(n >= 60)) return 'A largura mínima é 60.'; z.w = Math.round(n); }, 'number');
    field('Altura', z.h, v => { const n = Number(v); if (!(n >= 60)) return 'A altura mínima é 60.'; z.h = Math.round(n); }, 'number');
    const n = document.createElement('div'); n.className = 'note'; n.textContent = 'Arraste o título da seção para mover a seção junto com os componentes dentro dela.'; el.appendChild(n);
    return;
  }

  field('Nome', p.name, v => {
    const nv = v.trim(); if (!nv) return 'O nome não pode ficar vazio.';
    if (p.type === 'relay_coil') world.parts.forEach(q => { if ((q.type === 'relay_no' || q.type === 'relay_nc') && q.ref === p.name) q.ref = nv; });
    p.name = nv;
  });
  if (isPLCModule(p)) {
    field('Endereço (tag)', p.tag, v => {
      const nv = v.trim(), re = p.type === 'plc_input' ? /^%I\d+\.\d+$/ : /^%Q\d+\.\d+$/;
      if (!re.test(nv)) return p.type === 'plc_input' ? 'Entrada deve ser do tipo %I0.0.' : 'Saída deve ser do tipo %Q0.0.';
      p.tag = nv; p.name = (p.type === 'plc_input' ? 'Entrada ' : 'Saída ') + nv.replace('%', '');
    });
  }
  if (p.type === 'relay_no' || p.type === 'relay_nc') {
    field('Bobina associada (ex.: K1)', p.ref, v => {
      const nv = v.trim(); if (!nv) return 'Informe o nome da bobina.';
      p.ref = nv; p.name = nv + (p.type === 'relay_no' ? ' (NA)' : ' (NF)');
    });
  }
  if (isRail(p)) {
    field('Comprimento (segmentos de 20 px)', p.len, v => {
      let n = Math.round(Number(v)); if (!(n >= 2 && n <= 80)) return 'Use um valor entre 2 e 80.';
      if (n % 2) n += 1;
      const old = p.len, keep = world.wires.length;
      p.len = n;
      world.wires = world.wires.filter(w => !(w.a.id === p.id && w.a.pin > n) && !(w.b.id === p.id && w.b.pin > n));
      if (world.wires.length < keep) setStatus('Fios ligados aos pontos removidos do trilho foram excluídos.');
      return '';
    }, 'number');
  }
  if (hasValue(p)) {
    const unit = DEFAULTS[p.type].unit;
    field(p.type === 'level_sw' ? 'Aciona quando o nível ≥ (%)' : 'Valor (' + unit + ')', p.value, v => {
      const n = Number(v); if (!isFinite(n)) return 'Digite um número.';
      if (unit === 'Ω' && n < 1) return 'A resistência deve ser de pelo menos 1 Ω.';
      if (unit === 'V' && n < 0) return 'A tensão não pode ser negativa.';
      if (unit === '%' && (n < 0 || n > 100)) return 'Use um valor entre 0 e 100.';
      p.value = n; if (p.type === 'level_sw') { Engine.updateSensors(world); requestDraw(); }
    }, 'number');
  }
  if (HINTS[p.type]) { const n = document.createElement('div'); n.className = 'note'; n.textContent = HINTS[p.type]; el.appendChild(n); }
  if (p.type !== 'ground') {
    const rot = document.createElement('button'); rot.textContent = 'Girar 90° (R)'; rot.style.width = '100%'; rot.style.marginTop = '10px';
    rot.onclick = () => rotateSelected(); el.appendChild(rot);
  }
}

function rotateSelected() {
  if (st.placing) { st.placingRot = (st.placingRot + 90) % 360; requestDraw(); return; }
  const p = world.parts.find(x => x.id === st.selected);
  if (p) { p.rotation = ((p.rotation || 0) + 90) % 360; requestDraw(); }
}

// ---------- hover, dicas ----------
function showTip(cx, cy, text) {
  tooltip.style.whiteSpace = 'pre-line'; tooltip.textContent = text;
  tooltip.style.display = 'block'; tooltip.style.left = (cx + 14) + 'px'; tooltip.style.top = (cy + 14) + 'px';
}
function pinCaption(p, i) { const l = (DEFAULTS[p.type].labels || [])[i]; return l ? 'terminal ' + l : 'terminal ' + (i + 1); }
const fmtV = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2) + ' V';

// Destaque cruzado: passar o mouse numa tag do Ladder (ou num módulo de E/S no diagrama) acende o outro lado.
// Vindo do Ladder, também realça a rede ligada ao módulo (o fio que sai do botão ou vai para a bobina).
function setHoverTag(tag, source) {
  tag = tag || null;
  if (tag === st.hoverTag && (!tag || st.hoverSource === source)) return;
  st.hoverTag = tag; st.hoverSource = tag ? source : null;
  LadderUI.highlightTag(tag);
  if (source === 'ladder') {
    const mod = tag && world.parts.find(p => isPLCModule(p) && p.tag === tag);
    st.hoverRoot = mod ? Solver.analyzeNets(world.parts, world.wires).netOf[mod.id + ':' + (mod.type === 'plc_input' ? 0 : 1)] : null;
  }
  requestDraw();
}

function updateHover(e, m) {
  const nets = Solver.analyzeNets(world.parts, world.wires), r = 10 / st.view.s;
  const pin = G.nearestPin(world, m.x, m.y, r);
  let root = null, tip = null;
  const part = [...world.parts].reverse().find(p => !isRail(p) && G.partHit(p, m.x, m.y)) || [...world.parts].reverse().find(p => G.partHit(p, m.x, m.y));
  if (pin) {
    root = nets.netOf[pin.id + ':' + pin.pin];
    const pp = world.parts.find(p => p.id === pin.id), role = nets.role[root];
    tip = pp.name + ' · ' + pinCaption(pp, pin.pin);
    if (st.running && world.sim.ok && world.pinV[pin.id + ':' + pin.pin] !== undefined) tip += '\nTensão da rede: ' + fmtV(world.pinV[pin.id + ':' + pin.pin]);
    else tip += '\n' + (role === 'pos' ? 'Rede do trilho +' : role === 'neg' ? 'Rede de 0 V (referência)' : 'Rede sem trilho');
  } else {
    const wi = G.wireAt(world, m.x, m.y, 6 / st.view.s);
    if (wi >= 0) {
      const w = world.wires[wi]; root = nets.netOf[w.a.id + ':' + w.a.pin];
      tip = 'Fio';
      if (st.running && world.sim.ok && w.v != null) tip += ' · ' + fmtV(w.v);
      else { const role = nets.role[root]; tip += role === 'pos' ? ' · rede do trilho +' : role === 'neg' ? ' · rede de 0 V' : ''; }
    } else if (part && st.running && world.sim.ok) {
      tip = part.name + '\nTensão: ' + fmtV(part.simVoltage || 0);
      if (!isRail(part) && part.type !== 'ground') tip += '\nCorrente: ' + (Math.abs(part.simCurrent || 0) * 1000).toFixed(1) + ' mA';
      if (isLatch(part)) tip += '\nClique para alternar (trava)';
      else if (isPush(part)) tip += '\nSegure o botão do mouse para acionar';
    }
  }
  st.hoverPin = pin; st.hoverRoot = root; st.hoverPart = part ? part.id : null;
  setHoverTag(part && isPLCModule(part) && part.tag ? part.tag : null, 'canvas');
  canvas.style.cursor = (st.running && part && isPush(part)) ? 'pointer' : '';
  if (tip && !drag && !pan) showTip(e.clientX, e.clientY, tip); else tooltip.style.display = 'none';
}

// ---------- mouse ----------
function partAtTop(x, y) {
  for (let i = world.parts.length - 1; i >= 0; i--) { const p = world.parts[i]; if (!isRail(p) && G.partHit(p, x, y)) return p; }
  for (let i = world.parts.length - 1; i >= 0; i--) { const p = world.parts[i]; if (isRail(p) && G.partHit(p, x, y)) return p; }
  return null;
}
function zoneAt(x, y) {
  for (let i = world.zones.length - 1; i >= 0; i--) {
    const z = world.zones[i];
    if (x < z.x - 4 || x > z.x + z.w + 4 || y < z.y - 4 || y > z.y + z.h + 4) continue;
    if (y <= z.y + 26 || x <= z.x + 4 || x >= z.x + z.w - 4 || y >= z.y + z.h - 4) return z;
  }
  return null;
}
function startPan(e) { pan = { x: e.clientX, y: e.clientY, ox: st.view.ox, oy: st.view.oy, moved: false }; canvas.classList.add('pan'); }

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || e.button === 2) { startPan(e); e.preventDefault(); return; }
  if (e.button !== 0 || st.placing || st.mode === 'wire') return;
  const m = toWorld(e), p = partAtTop(m.x, m.y);
  if (p) {
    st.selected = p.id; st.selectedWire = null; st.selectedZone = null; renderProperties();
    if (st.running && isLatch(p)) { p.closed = !p.closed; st.everPressed = true; }
    else if (st.running && isPush(p)) { p.closed = (p.type === 'push_no'); st.everPressed = true; }
    else drag ={ kind: 'part', id: p.id, dx: m.x - p.x, dy: m.y - p.y };
    requestDraw(); return;
  }
  const wi = G.wireAt(world, m.x, m.y, 6 / st.view.s);
  if (wi >= 0) { st.selected = null; st.selectedZone = null; st.selectedWire = wi; renderProperties(); requestDraw(); return; }
  const z = zoneAt(m.x, m.y);
  if (z) {
    st.selected = null; st.selectedWire = null; st.selectedZone = z.id; renderProperties();
    // os trilhos atravessam várias seções, então não acompanham o movimento de nenhuma delas
    const members = world.parts.filter(q => !isRail(q) && q.x >= z.x && q.x <= z.x + z.w && q.y >= z.y && q.y <= z.y + z.h).map(q => ({ p: q, ox: q.x - z.x, oy: q.y - z.y }));
    drag = { kind: 'zone', id: z.id, dx: m.x - z.x, dy: m.y - z.y, members };
    requestDraw(); return;
  }
  st.selected = null; st.selectedWire = null; st.selectedZone = null; renderProperties();
  startPan(e); requestDraw();
});

window.addEventListener('mousemove', e => {
  const m = toWorld(e);
  st.mouse = { x: m.x, y: m.y }; st.mouseSnap = { x: snap(m.x), y: snap(m.y) };
  if (pan) {
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) pan.moved = true;
    st.view.ox = pan.ox + dx; st.view.oy = pan.oy + dy; requestDraw(); return;
  }
  if (drag) {
    if (drag.kind === 'part') { const p = world.parts.find(q => q.id === drag.id); if (p) { p.x = snap(m.x - drag.dx); p.y = snap(m.y - drag.dy); } }
    else {
      const z = world.zones.find(q => q.id === drag.id);
      if (z) { z.x = snap(m.x - drag.dx); z.y = snap(m.y - drag.dy); drag.members.forEach(k => { k.p.x = z.x + k.ox; k.p.y = z.y + k.oy; }); }
    }
    requestDraw(); return;
  }
  if (e.target === canvas) updateHover(e, m);
  else {
    st.hoverPin = null; st.hoverPart = null; tooltip.style.display = 'none';
    if (st.hoverSource !== 'ladder') st.hoverRoot = null;            // o realce vindo do Ladder é dele
    if (st.hoverSource === 'canvas') setHoverTag(null, 'canvas');
  }
  requestDraw();
});
canvas.addEventListener('mouseleave', () => {
  tooltip.style.display = 'none'; st.hoverRoot = null; st.hoverPin = null; st.hoverPart = null; canvas.style.cursor = '';
  if (st.hoverSource === 'canvas') setHoverTag(null, 'canvas');
  requestDraw();
});

plantCanvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || !st.running) return;
  const r = plantCanvas.getBoundingClientRect(), id = PlantView.buttonAt(e.clientX - r.left, e.clientY - r.top);
  const p = id && world.parts.find(q => q.id === id);
  if (p) { p.closed = (p.type === 'push_no'); st.everPressed = true; }
});
plantCanvas.addEventListener('mousemove', e => {
  const r = plantCanvas.getBoundingClientRect();
  plantCanvas.style.cursor = st.running && PlantView.buttonAt(e.clientX - r.left, e.clientY - r.top) ? 'pointer' : '';
});
plantMini.addEventListener('click', () => showView('plant'));
[['plInit', 'initial'], ['plFill', 'fillRate'], ['plDrain', 'drainRate']].forEach(([id, key]) => {
  $(id).onchange = () => {
    const n = Number($(id).value);
    if (!isFinite(n)) { syncPlantFields(); return; }
    world.plant[key] = clamp(n, 0, 100); $(id).value = world.plant[key];
    if (key === 'initial' && !st.running) { world.plant.level = world.plant.initial; Engine.updateSensors(world); }
    requestDraw();
  };
});
function syncSheetFields() { [['shTitle', 'title'], ['shAuthor', 'author'], ['shRev', 'rev']].forEach(([id, k]) => { $(id).value = world.sheet[k]; }); }
[['shTitle', 'title'], ['shAuthor', 'author'], ['shRev', 'rev']].forEach(([id, k]) => { $(id).oninput = () => { world.sheet[k] = $(id).value; }; });
$('exportSel').onchange = e => {
  const k = e.target.value; e.target.value = '';
  if (!k) return;
  try { (k === 'png' ? SheetExport.exportPNG : SheetExport.exportPDF)(world, st); setStatus('Folha exportada (' + k.toUpperCase() + ').'); }
  catch (err) { setStatus('Não foi possível exportar: ' + err.message, true); }
};
function releaseButtons() {
  world.parts.forEach(p => {
    if (p.type === 'push_no' && p.closed) p.closed = false;
    if (p.type === 'push_nc' && !p.closed) p.closed = true;
  });
}
window.addEventListener('mouseup', () => {
  if (drag) { drag = null; renderProperties(); }
  if (pan) { pan = null; canvas.classList.remove('pan'); }
  releaseButtons(); requestDraw();
});

canvas.addEventListener('click', e => {
  const m = toWorld(e);
  if (st.placing) { addPart(st.placing, snap(m.x), snap(m.y)); return; }
  if (st.mode === 'wire') {
    const pin = G.nearestPin(world, m.x, m.y, 12 / st.view.s);
    if (!pin) return;
    if (!st.pendingPin) { st.pendingPin = pin; setStatus('Terminal selecionado. Clique no terminal de destino (Esc cancela).'); }
    else {
      const a = st.pendingPin, same = a.id === pin.id && a.pin === pin.pin;
      const dup = world.wires.some(w => (w.a.id === a.id && w.a.pin === a.pin && w.b.id === pin.id && w.b.pin === pin.pin) || (w.b.id === a.id && w.b.pin === a.pin && w.a.id === pin.id && w.a.pin === pin.pin));
      if (same) setStatus('Escolha um terminal diferente.');
      else if (dup) setStatus('Esses dois terminais já estão ligados.');
      else { world.wires.push({ a, b: pin, v: null, flow: 0 }); setStatus('Fio conectado.'); }
      st.pendingPin = null;
    }
    requestDraw();
  }
});
canvas.addEventListener('dblclick', e => {
  const m = toWorld(e), p = partAtTop(m.x, m.y);
  if (p && p.type === 'plc_cpu' && currentView === 'circuit') showView('split');
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const m = toWorld(e);
  zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, m.sx, m.sy);
}, { passive: false });

window.addEventListener('keydown', e => {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (e.key === 'Escape') { st.placing = null; st.pendingPin = null; syncPalette(); setModeHint(); requestDraw(); setStatus('Ação cancelada.'); }
  if (typing || e.ctrlKey || e.metaKey) return;
  if (e.key === 'f' || e.key === 'F') { toggleFocus(); return; }
  if (currentView === 'ladder' || currentView === 'plant' || ladderView.contains(document.activeElement)) return;   // atalhos do diagrama não valem no Ladder
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'r' || e.key === 'R') rotateSelected();
  else if (e.key === 'w' || e.key === 'W') setMode('wire');
  else if (e.key === 'v' || e.key === 'V') setMode('select');
});

document.querySelectorAll('.part').forEach(el => el.addEventListener('click', () => {
  ensureCircuit();
  st.placing = el.dataset.type; st.placingRot = defaultRotation(st.placing); st.mode = 'select'; st.pendingPin = null;
  syncPalette(); setModeHint();
  const nm = st.placing === 'zone' ? 'Seção' : DEFAULTS[st.placing].name;
  setStatus('Clique no diagrama para inserir: ' + nm + ' (R gira, Esc cancela).');
  requestDraw();
}));
function setMode(m) { st.mode = m; st.pendingPin = null; st.placing = null; syncPalette(); setModeHint(); requestDraw(); }
function setModeHint() {
  $('modeHint').textContent = 'Modo: ' + (st.mode === 'wire' ? 'conectar fios' : 'selecionar');
  $('wireBtn').classList.toggle('active', st.mode === 'wire');
  $('selectBtn').classList.toggle('active', st.mode === 'select');
  canvas.classList.toggle('wire', st.mode === 'wire');
}
$('wireBtn').onclick = () => { ensureCircuit(); setMode('wire'); };
$('selectBtn').onclick = () => { ensureCircuit(); setMode('select'); };

function deleteSelected() {
  if (st.selected !== null) {
    const id = st.selected;
    world.parts = world.parts.filter(p => p.id !== id);
    world.wires = world.wires.filter(w => w.a.id !== id && w.b.id !== id);
    st.selected = null; setStatus('Componente excluído.');
  } else if (st.selectedZone !== null) {
    world.zones = world.zones.filter(z => z.id !== st.selectedZone); st.selectedZone = null; setStatus('Seção excluída (os componentes ficam).');
  } else if (st.selectedWire !== null && world.wires[st.selectedWire]) {
    world.wires.splice(st.selectedWire, 1); st.selectedWire = null; setStatus('Fio excluído.');
  } else return;
  renderProperties(); requestDraw();
}
$('deleteBtn').onclick = deleteSelected;

// ---------- abas e vista ----------
// circuit = só o diagrama; split = diagrama em cima e Ladder embaixo; ladder = só o editor de degraus.
function showView(v) {
  currentView = v;
  const circ = v === 'circuit' || v === 'split';
  views.className = 'views ' + v;
  $('tabPlant').classList.toggle('active', v === 'plant');
  $('tabCircuit').classList.toggle('active', v === 'circuit');
  $('tabSplit').classList.toggle('active', v === 'split');
  $('tabLadder').classList.toggle('active', v === 'ladder');
  $('circuitTools').style.display = circ ? 'contents' : 'none';
  $('modeHint').style.display = circ ? '' : 'none';
  tooltip.style.display = 'none';
  if (st.hoverTag) setHoverTag(null, st.hoverSource);
  if (v === 'ladder' || v === 'split') LadderUI.render();
  if (circ) { needFit = true; resize(); } else requestDraw();
}
function ensureCircuit() { if (currentView === 'ladder' || currentView === 'plant') showView('split'); }
$('tabCircuit').onclick = () => showView('circuit');
$('tabSplit').onclick = () => showView('split');
$('tabLadder').onclick = () => showView('ladder');
$('tabPlant').onclick = () => showView('plant');

// Foco: esconde os painéis laterais e o diagrama ganha a largura toda.
function toggleFocus() {
  const on = !$('mainGrid').classList.contains('focus');
  $('mainGrid').classList.toggle('focus', on); $('focusBtn').classList.toggle('active', on);
  needFit = true; resize();
}
$('focusBtn').onclick = toggleFocus;

// Divisória entre o diagrama e o Ladder (vista dividida): arraste para dar mais espaço a um dos lados.
let splitDrag = false;
$('splitter').addEventListener('mousedown', e => { e.preventDefault(); splitDrag = true; $('splitter').classList.add('drag'); document.body.style.cursor = 'row-resize'; });
window.addEventListener('mousemove', e => {
  if (!splitDrag) return;
  const r = views.getBoundingClientRect();
  views.style.setProperty('--split', clamp((e.clientY - r.top) / r.height * 100, 25, 80).toFixed(1) + '%');
});
window.addEventListener('mouseup', () => {
  if (!splitDrag) return;
  splitDrag = false; $('splitter').classList.remove('drag'); document.body.style.cursor = '';
  needFit = true; resize();
});
$('zoomIn').onclick = () => zoomAt(1.2, cw / 2, ch / 2);
$('zoomOut').onclick = () => zoomAt(1 / 1.2, cw / 2, ch / 2);
$('fitBtn').onclick = fitView;
$('gridBtn').onclick = e => { st.showGrid = !st.showGrid; e.currentTarget.classList.toggle('active', st.showGrid); requestDraw(); };
$('labelsBtn').onclick = e => { st.showLabels = !st.showLabels; e.currentTarget.classList.toggle('active', st.showLabels); requestDraw(); };
$('wireNumBtn').onclick = e => { st.showWireNums = !st.showWireNums; e.currentTarget.classList.toggle('active', st.showWireNums); requestDraw(); };
$('legendBtn').onclick = e => { st.showLegend = !st.showLegend; e.currentTarget.classList.toggle('active', st.showLegend); requestDraw(); };

// ---------- simulação ----------
function updateMetrics() {
  const ok = st.running && world.sim.ok;
  $('simState').textContent = st.running ? 'Executando' : 'Parado';
  $('simState').className = 'value ' + (st.running ? 'good' : '');
  const hasCpu = world.parts.some(p => p.type === 'plc_cpu');
  const plc = $('plcState');
  if (!st.running) { plc.textContent = '—'; plc.className = 'value'; }
  else if (!world.plcPowered) { plc.textContent = 'Sem alimentação'; plc.className = 'value bad'; }
  else { plc.textContent = hasCpu ? 'RUN' : 'RUN (sem bloco CLP)'; plc.className = 'value good'; }
  $('voltage').textContent = ok ? world.sim.V.toFixed(2) + ' V' : '— V';
  $('current').textContent = ok ? world.sim.I.toFixed(4) + ' A' : '— A';
  let s = '';
  if (st.running) Object.keys(world.rt.tags).sort().forEach(t => {
    const v = world.rt.tags[t];
    s += t + ': ' + (typeof v === 'number' ? v : (v ? 'TRUE' : 'FALSE')) + '\n';
  });
  tagsView.textContent = s || (st.running ? 'Vazio' : '—');
}

function loop(t) {
  if (!st.running) return;
  const dt = Math.min(0.1, Math.max(0, (t - lastFrame) / 1000)); lastFrame = t; st.time = t;
  try {
    const info = Engine.step(world, dt * 1000);
    LadderUI.paint(info);
    if (world.plcPowered !== lastPowered) {
      lastPowered = world.plcPowered;
      if (!lastPowered) setStatus('CLP sem alimentação: ligue L+ e M do bloco do CLP aos trilhos +24V e 0V.', true);
      else setStatus('CLP em modo RUN.');
    }
    updateMetrics();
  } catch (err) {
    stopSim();
    setStatus('Simulação interrompida: ' + err.message, true);
    return;
  }
  draw();
  requestAnimationFrame(loop);
}
function startSim() {
  if (st.running) return;
  try { Engine.start(world); } catch (err) { setStatus('Erro: ' + err.message, true); return; }
  st.running = true; st.everPressed = false; lastFrame = performance.now(); lastPowered = world.plcPowered;
  setStatus(lastPowered ? 'CLP em modo RUN.' + (world.parts.some(isPush) ? ' Segure o mouse sobre um botão (anel pulsante) para acioná-lo.' : '')
    : 'CLP sem alimentação: ligue L+ e M do bloco do CLP aos trilhos +24V e 0V.', !lastPowered);
  requestAnimationFrame(loop);
}
function stopSim() {
  st.running = false; Engine.stop(world);
  LadderUI.paint(null); updateMetrics(); tooltip.style.display = 'none'; requestDraw();
}
$('simBtn').onclick = startSim;
$('stopBtn').onclick = () => { if (st.running) { stopSim(); setStatus('CLP em modo STOP.'); } };

// ---------- projeto ----------
function afterLoad(msg, isErr) {
  st.selected = null; st.selectedWire = null; st.selectedZone = null; st.pendingPin = null; st.placing = null; syncPalette();
  renderProperties(); LadderUI.render(); updateMetrics(); plantShown = null; syncPlantFields(); syncSheetFields(); fitView(); requestDraw(); setStatus(msg, isErr);
}
const EXAMPLE_MSG = {
  partida: 'Exemplo carregado. Clique em ▶ Simular e mantenha o mouse pressionado sobre S1; veja também a aba Ladder.',
  motor: 'Exemplo do motor com proteção carregado. Clique em ▶ Simular e segure S1; depois clique no térmico F1 ou na emergência E0 para simular a falha e use S1 para reconhecer.',
  contador: 'Exemplo de contagem carregado. Simule, segure S1 para ligar a esteira e clique no sensor B3 para contar peças (5 completam o lote); veja os degraus na aba Ladder.',
  tanque: 'Exemplo do tanque carregado. Clique em ▶ Simular, aperte S1 e use S2 para consumir água; veja a aba Planta.'
};
$('exampleSel').onchange = e => {
  const k = e.target.value; e.target.value = '';
  if (!Engine.EXAMPLES[k]) return;
  if (st.running) stopSim();
  Engine.EXAMPLES[k](world);
  afterLoad(EXAMPLE_MSG[k]);
};
$('newBtn').onclick = () => {
  if (!confirm('Limpar circuito e programa Ladder?')) return;
  if (st.running) stopSim();
  Engine.clear(world); afterLoad('Novo projeto criado.');
};
$('saveBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(Engine.serialize(world), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'projeto-eletrolab.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  setStatus('Projeto exportado.');
};
$('loadBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (st.running) stopSim();
      const warnings = Engine.loadProject(world, data);
      afterLoad('Projeto aberto: ' + f.name + (warnings.length ? ' — ' + warnings.join(' ') : ''), warnings.length > 0);
    } catch (err) { setStatus('Não foi possível abrir: ' + err.message, true); }
  };
  rd.onerror = () => setStatus('Erro ao ler o arquivo.', true);
  rd.readAsText(f);
};

// ---------- início ----------
// A versão vem do próprio programa (package.json) quando roda no Electron; no navegador a etiqueta fica vazia.
if (window.electronAPI && window.electronAPI.version) {
  window.electronAPI.version().then(v => { $('appVer').textContent = '• v' + v; document.title = 'EletroLab Studio v' + v + ' - CLP & Ladder'; }).catch(() => {});
}
Engine.loadExample(world);
LadderUI.init({ container: ladderView, getProgram: () => world.program, onStatus: setStatus, onHoverTag: t => setHoverTag(t, 'ladder') });
setModeHint(); updateMetrics(); updateZoomLabel(); showView('split');
if (window.__EL_TEST__) window.__el = { world, st, G, fitView, zoomAt, showView, setHoverTag, toScreen: (x, y) => { const r = canvas.getBoundingClientRect(), v = st.view; return { x: r.left + x * v.s + v.ox, y: r.top + y * v.s + v.oy }; } };
})();
