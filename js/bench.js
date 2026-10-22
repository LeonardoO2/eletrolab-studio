// Bancada de Ladder: entradas e saídas virtuais (sem circuito) + diagrama de tempo.
// O painel é montado a partir do próprio programa (PLC.ioMap): tags lidas e nunca escritas viram chaves,
// tags %Q viram lâmpadas, temporizadores e contadores viram barras. O diagrama registra só as mudanças.
const Bench = (function () {
  const C = { bg: '#111923', grid: '#243242', text: '#c4d1de', muted: '#8397ab', in: '#8ca8f9', out: '#43c6ac', mem: '#f6c85f', dn: '#c58af9', line: '#344456' };
  const FONT = '"Segoe UI", Arial, sans-serif', MAX_KEEP = 300000;
  let ioEl = null, canvas = null, getWorld = null, onStatus = null;
  let map = PLC.ioMap([]), sw = {}, pulse = {}, held = {}, seen = {}, hist = {}, win = 20000, rows = {}, running = false, lastDraw = 0;

  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const fmtS = ms => (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';

  function init(o) {
    ioEl = o.io; canvas = o.canvas; getWorld = o.getWorld; onStatus = o.onStatus || (() => {});
    // O pulso só termina depois de pelo menos uma varredura tê-lo visto (um clique rápido não pode passar em branco).
    window.addEventListener('mouseup', () => { Object.keys(pulse).forEach(t => { if (pulse[t]) { held[t] = false; if (seen[t] || !running) { pulse[t] = false; refreshInput(t); } } }); });
    rebuild();
  }

  // ---------- entradas virtuais ----------
  const value = t => !!(sw[t] || pulse[t]);
  function refreshInput(t) {
    const r = rows[t]; if (!r) return;
    r.row.classList.toggle('on', value(t));
    r.sw.setAttribute('aria-pressed', value(t) ? 'true' : 'false');
  }
  // Chamado antes de cada varredura: copia o estado das chaves para o mundo.
  function apply(world) {
    map.inputs.forEach(t => {
      world.vin[t] = value(t);
      if (pulse[t]) { seen[t] = true; if (!held[t]) { pulse[t] = false; seen[t] = false; refreshInput(t); } }
    });
  }

  // ---------- painel ----------
  function rebuild() {
    if (!ioEl) return;
    const world = getWorld();
    map = PLC.ioMap(world.program);
    rows = {};
    ioEl.innerHTML = '';
    const sec = (title, hint) => { const s = el('div', 'bn-sec'); s.appendChild(el('div', 'bn-title', title)); if (hint) s.appendChild(el('div', 'bn-hint', hint)); ioEl.appendChild(s); return s; };

    if (!world.program.length) {
      ioEl.appendChild(el('div', 'bn-empty', 'O programa está vazio. Crie um degrau no editor ao lado (＋ Novo degrau) ou carregue o exemplo "Bancada: pisca-pisca" no menu Exemplos.'));
      return;
    }
    const s1 = sec('Entradas', map.inputs.length ? 'Chave: clique para ligar/desligar. Pulso: vale só enquanto o mouse está pressionado.' : 'Nenhuma entrada: nenhum contato lê uma tag que o programa não escreva.');
    map.inputs.forEach(t => {
      const row = el('div', 'bn-row'), sb = el('button', 'bn-switch'), pb = el('button', 'bn-pulse', 'Pulso');
      sb.appendChild(el('i')); sb.title = 'Liga/desliga a entrada ' + t;
      sb.onclick = () => { sw[t] = !sw[t]; refreshInput(t); };
      pb.title = 'Mantém a entrada ligada enquanto o botão do mouse estiver pressionado';
      pb.onmousedown = e => { if (e.button === 0) { pulse[t] = true; held[t] = true; seen[t] = false; refreshInput(t); } };
      row.append(el('span', 'bn-tag', t), sb, pb); s1.appendChild(row);
      rows[t] = { row, sw: sb }; refreshInput(t);
    });
    const s2 = sec('Saídas');
    if (!map.outputs.length) s2.appendChild(el('div', 'bn-hint', 'Nenhuma saída %Q no programa.'));
    map.outputs.forEach(t => {
      const row = el('div', 'bn-row'), lamp = el('span', 'bn-lamp');
      row.append(lamp, el('span', 'bn-tag', t)); s2.appendChild(row); rows[t] = { row, lamp };
    });
    if (map.timers.length || map.counters.length) {
      const s3 = sec('Temporizadores e contadores');
      map.timers.forEach(tm => {
        const row = el('div', 'bn-row bn-bar'), bar = el('span', 'bn-fill'), txt = el('span', 'bn-val');
        const track = el('span', 'bn-track'); track.appendChild(bar);
        row.append(el('span', 'bn-tag', tm.name + ' ' + tm.type.toUpperCase()), track, txt); s3.appendChild(row);
        rows[tm.name] = { row, bar, txt, timer: tm };
      });
      map.counters.forEach(cn => {
        const row = el('div', 'bn-row bn-bar'), bar = el('span', 'bn-fill'), txt = el('span', 'bn-val');
        const track = el('span', 'bn-track'); track.appendChild(bar);
        row.append(el('span', 'bn-tag', cn.name + ' ' + cn.type.toUpperCase()), track, txt); s3.appendChild(row);
        rows[cn.name] = { row, bar, txt, counter: cn };
      });
    }
    if (map.memory.length) {
      const s4 = sec('Memórias');
      map.memory.forEach(t => {
        const row = el('div', 'bn-row'), lamp = el('span', 'bn-lamp mem');
        row.append(lamp, el('span', 'bn-tag', t)); s4.appendChild(row); rows[t] = { row, lamp };
      });
    }
    update(world, running);
  }

  function reset() { hist = {}; }
  function setRunning(r) { running = r; }

  // ---------- atualização a cada quadro ----------
  function update(world, isRunning) {
    running = isRunning;
    const tags = world.rt.tags;
    Object.keys(rows).forEach(t => {
      const r = rows[t];
      if (r.lamp) r.lamp.classList.toggle('on', isRunning && !!tags[t]);
      if (r.timer) {
        const acc = isRunning ? (Number(tags[t + '.ACC']) || 0) : 0, pre = Math.max(1, r.timer.preset);
        r.bar.style.width = Math.min(100, acc / pre * 100) + '%';
        r.txt.textContent = (acc / 1000).toFixed(2) + ' / ' + (r.timer.preset / 1000).toFixed(2) + ' s';
        r.row.classList.toggle('done', isRunning && !!tags[t + '.DN']);
      }
      if (r.counter) {
        const acc = isRunning ? (Number(tags[t + '.ACC']) || 0) : (r.counter.type === 'ctd' ? r.counter.preset : 0), pre = Math.max(1, r.counter.preset);
        r.bar.style.width = Math.min(100, (r.counter.type === 'ctd' ? pre - acc : acc) / pre * 100) + '%';
        r.txt.textContent = acc + ' / ' + r.counter.preset;
        r.row.classList.toggle('done', isRunning && !!tags[t + '.DN']);
      }
    });
    if (isRunning) record(world);
  }

  // ---------- diagrama de tempo ----------
  function record(world) {
    const t = world.simMs || 0;
    map.signals.forEach(sig => {
      const v = !!world.rt.tags[sig], a = hist[sig] || (hist[sig] = []);
      if (!a.length || a[a.length - 1][1] !== v) a.push([t, v]);
      while (a.length > 2 && a[1][0] < t - MAX_KEEP) a.shift();
    });
    hist.__t = t;
  }
  function setWindow(ms) { win = ms; }
  const colorOf = sig => /\.DN$/.test(sig) ? C.dn : /^%I/.test(sig) || map.inputs.includes(sig) ? C.in : /^%Q/.test(sig) ? C.out : C.mem;

  function paint() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    const d = window.devicePixelRatio || 1, W = r.width, H = r.height;
    if (canvas.width !== Math.round(W * d) || canvas.height !== Math.round(H * d)) { canvas.width = Math.round(W * d); canvas.height = Math.round(H * d); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const sigs = map.signals;
    if (!sigs.length) {
      ctx.fillStyle = C.muted; ctx.font = '12px ' + FONT; ctx.textAlign = 'center';
      ctx.fillText('O diagrama de tempo aparece quando o programa tiver entradas, saídas ou memórias.', W / 2, H / 2); return;
    }
    const LW = 96, top = 18, right = 10, plotW = W - LW - right, avail = H - top - 6;
    const rowH = Math.max(12, Math.min(26, avail / sigs.length)), shown = Math.min(sigs.length, Math.floor(avail / rowH));
    const now = hist.__t || 0, t1 = Math.max(now, win), t0 = t1 - win;
    const X = t => LW + (t - t0) / win * plotW;
    // grade de tempo
    const step = win <= 10000 ? 1000 : win <= 20000 ? 2000 : 10000;
    ctx.font = '10px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const x = X(t); ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, top - 4); ctx.lineTo(x, top + shown * rowH); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.fillText((t / 1000) + ' s', x, 11);
    }
    for (let i = 0; i < shown; i++) {
      const sig = sigs[i], y0 = top + i * rowH, hh = Math.min(rowH - 6, 16), yH = y0 + 3, yL = yH + hh, col = colorOf(sig);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(LW, y0 + rowH - 0.5); ctx.lineTo(W - right, y0 + rowH - 0.5); ctx.stroke();
      ctx.fillStyle = col; ctx.font = (rowH >= 16 ? '11px ' : '9px ') + 'Consolas, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(sig, LW - 8, yH + hh / 2);
      const a = hist[sig] || [];
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'miter'; ctx.beginPath();
      let started = false, lastV = false;
      const yOf = v => v ? yH : yL;
      // estado no início da janela
      let v0 = false, k = 0;
      while (k < a.length && a[k][0] <= t0) { v0 = a[k][1]; k++; }
      ctx.moveTo(LW, yOf(v0)); lastV = v0; started = true;
      for (; k < a.length; k++) { const x = X(a[k][0]); ctx.lineTo(x, yOf(lastV)); ctx.lineTo(x, yOf(a[k][1])); lastV = a[k][1]; }
      ctx.lineTo(X(Math.min(now, t1)), yOf(lastV)); ctx.stroke();
    }
    if (shown < sigs.length) { ctx.fillStyle = C.muted; ctx.font = '10px ' + FONT; ctx.textAlign = 'left'; ctx.fillText('+' + (sigs.length - shown) + ' sinais (aumente a área do diagrama)', LW, H - 4); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // cursor do tempo atual
    if (running) { const x = X(Math.min(now, t1)); ctx.strokeStyle = 'rgba(246,200,95,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, top - 4); ctx.lineTo(x, top + shown * rowH); ctx.stroke(); }
  }

  return { init, rebuild, apply, update, paint, reset, setWindow, setRunning, getMap: () => map };
})();
