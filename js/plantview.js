// Vista da planta didática (tanque): cena animada + painel do operador (sinaleiros e botoeira).
// A mesma cena serve para o cartão pequeno da lateral (compact) e para a aba "Planta" (completa).
// Não guarda estado da simulação: só lê world.plant e os componentes.
const PlantView = (function () {
  const C = {
    bg: '#111923', panel: '#18212c', panel2: '#202c39', line: '#344456', tank: '#a9bccf', pipe: '#3d4f63', pipeIn: '#26323f',
    pipeFlow: '#2f78ab', accent: '#43c6ac', warn: '#f6c85f', danger: '#ff7777', text: '#c4d1de', muted: '#8397ab', white: '#eaf1f8', plc: '#8ca8f9'
  };
  const FONT = '"Segoe UI", Arial, sans-serif';
  const SW = 340, SH = 314;                                   // cena, em coordenadas lógicas
  const TANK = { x: 110, y: 50, w: 120, h: 190 };
  const PUMP = { x: 38, y: 215 }, VALVE = { x: 270, y: 266 };
  let last = { buttons: [] };                                 // retângulos clicáveis do último quadro (px do canvas)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const byType = (world, ...types) => world.parts.filter(p => types.includes(p.type));
  const hasPlant = world => Engine.hasPlantParts(world);

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function strokePts(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  function plen(pts) { let l = 0; for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return l; }
  function pointAt(pts, d) {
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (d <= l || i === pts.length - 2) { const k = l ? Math.min(1, d / l) : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; }
      d -= l;
    }
    return pts[0];
  }
  function text(ctx, s, x, y, size, color, align, bold, outline) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    if (outline) { ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,16,24,.85)'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }

  // Tubo com fluxo: pontos brancos andando quando há vazão.
  function pipe(ctx, pts, flowing, t) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = C.pipe; ctx.lineWidth = 10; strokePts(ctx, pts);
    ctx.strokeStyle = flowing ? C.pipeFlow : C.pipeIn; ctx.lineWidth = 6; strokePts(ctx, pts);
    if (flowing) {
      const L = plen(pts), gap = 16, off = (t / 1000 * 46) % gap;
      ctx.fillStyle = '#dff3ff';
      for (let d = off; d < L; d += gap) { const q = pointAt(pts, d); ctx.beginPath(); ctx.arc(q[0], q[1], 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.lineCap = 'butt';
  }

  function tankPath(ctx) {
    const { x, y, w, h } = TANK;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h - 14); ctx.quadraticCurveTo(x, y + h, x + 14, y + h);
    ctx.lineTo(x + w - 14, y + h); ctx.quadraticCurveTo(x + w, y + h, x + w, y + h - 14); ctx.lineTo(x + w, y);
  }

  // ---------- cena do tanque ----------
  function drawScene(ctx, o) {
    const { world, run, t, compact } = o, pl = world.plant;
    const pumps = byType(world, 'pump'), valves = byType(world, 'valve'), sensors = byType(world, 'level_sw');
    const pumping = run && pl.pumping, draining = run && pl.draining;
    const lv = clamp(pl.level, 0, 100), yTop = TANK.y + TANK.h * (1 - lv / 100), cx = TANK.x + TANK.w / 2;
    const fs = compact ? 1.25 : 1;

    // tubulação
    if (pumps.length) {
      pipe(ctx, [[4, PUMP.y], [PUMP.x - 17, PUMP.y]], pumping, t);
      pipe(ctx, [[PUMP.x, PUMP.y - 17], [PUMP.x, 26], [cx, 26], [cx, 64]], pumping, t);
    }
    if (valves.length) pipe(ctx, [[TANK.x + 90, TANK.y + TANK.h], [TANK.x + 90, VALVE.y], [322, VALVE.y], [322, 306]], draining, t);
    if (pumping) {                                              // fio de água caindo no tanque
      ctx.strokeStyle = 'rgba(120,200,250,.9)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, 66); ctx.lineTo(cx, Math.max(66, yTop)); ctx.stroke();
    }

    // corpo do tanque e água
    ctx.save(); tankPath(ctx); ctx.closePath(); ctx.fillStyle = '#0e1620'; ctx.fill(); ctx.clip();
    if (lv > 0) {
      const phase = run ? t / 260 : 0, amp = lv < 99.5 ? 2.4 : 0;
      ctx.beginPath(); ctx.moveTo(TANK.x, TANK.y + TANK.h);
      for (let x = TANK.x; x <= TANK.x + TANK.w + 2; x += 4) ctx.lineTo(x, yTop + Math.sin(x / 11 + phase) * amp);
      ctx.lineTo(TANK.x + TANK.w, TANK.y + TANK.h); ctx.closePath();
      const g = ctx.createLinearGradient(0, yTop, 0, TANK.y + TANK.h);
      g.addColorStop(0, 'rgba(99,189,245,.92)'); g.addColorStop(1, 'rgba(36,112,178,.95)');
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = C.tank; ctx.lineJoin = 'round'; tankPath(ctx); ctx.stroke();

    // escala de nível
    [0, 25, 50, 75, 100].forEach(v => {
      const y = TANK.y + TANK.h * (1 - v / 100);
      ctx.strokeStyle = 'rgba(169,188,207,.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(TANK.x - 6, y); ctx.lineTo(TANK.x, y); ctx.stroke();
      if (!compact || v % 50 === 0) text(ctx, String(v), TANK.x - 9, y + 3.5, 9 * fs, C.muted, 'right');
    });

    // sensores de nível: linha tracejada, marcador e rótulo
    sensors.forEach(p => {
      const thr = clamp(Number(p.value) || 0, 0, 100), y = TANK.y + TANK.h * (1 - thr / 100), on = !!p.closed, mx = TANK.x + TANK.w + 14;
      ctx.setLineDash([4, 3]); ctx.lineWidth = 1.3; ctx.strokeStyle = on ? C.accent : 'rgba(169,188,207,.55)';
      ctx.beginPath(); ctx.moveTo(TANK.x, y); ctx.lineTo(mx, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(mx, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? C.accent : '#111923'; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = on ? C.accent : C.muted; ctx.stroke();
      if (compact) text(ctx, String(p.name).split(' ')[0] + ' ' + thr + '%', mx + 10, y + 4, 10 * fs, on ? C.accent : C.text);
      else {
        text(ctx, p.name, mx + 10, y - 1, 11, on ? C.accent : C.text, 'left', true);
        text(ctx, 'nível ≥ ' + thr + '%', mx + 10, y + 11, 10, C.muted);
      }
    });

    // leitura do nível
    text(ctx, Math.round(lv) + '%', cx, TANK.y + TANK.h / 2 + 7, 22 * (compact ? 1.1 : 1), C.white, 'center', true, true);
    if (run && pl.overflow) text(ctx, 'TRANSBORDANDO', cx, 14, 11 * fs, C.danger, 'center', true);

    // bomba
    pumps.forEach((p, i) => {
      if (i > 0) return;
      const on = run && p.energized;
      ctx.beginPath(); ctx.arc(PUMP.x, PUMP.y, 17, 0, Math.PI * 2); ctx.fillStyle = on ? 'rgba(67,198,172,.2)' : '#111923'; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = on ? C.accent : C.tank; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PUMP.x - 6, PUMP.y - 8); ctx.lineTo(PUMP.x + 9, PUMP.y); ctx.lineTo(PUMP.x - 6, PUMP.y + 8); ctx.closePath();
      if (on) { ctx.fillStyle = 'rgba(67,198,172,.6)'; ctx.fill(); } ctx.stroke();
      if (on) {
        const a = t / 140; ctx.strokeStyle = C.accent; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(PUMP.x, PUMP.y, 23, a, a + 1.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(PUMP.x, PUMP.y, 23, a + Math.PI, a + Math.PI + 1.5); ctx.stroke();
      }
      if (!compact) {
        text(ctx, p.name, PUMP.x, PUMP.y + 40, 11, C.text, 'center');
        text(ctx, on ? 'LIGADA' : 'DESLIGADA', PUMP.x, PUMP.y + 54, 10, on ? C.accent : C.muted, 'center', true);
      }
    });

    // válvula de dreno
    valves.forEach((p, i) => {
      if (i > 0) return;
      const on = run && p.energized, x = VALVE.x, y = VALVE.y;
      ctx.lineWidth = 2.2; ctx.strokeStyle = on ? C.accent : C.tank;
      ctx.beginPath(); ctx.moveTo(x - 14, y - 11); ctx.lineTo(x + 14, y + 11); ctx.lineTo(x + 14, y - 11); ctx.lineTo(x - 14, y + 11); ctx.closePath();
      ctx.fillStyle = on ? 'rgba(67,198,172,.45)' : '#111923'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14); ctx.stroke(); ctx.strokeRect(x - 8, y - 24, 16, 10);
      if (!compact) {
        text(ctx, p.name, x, y + 27, 11, C.text, 'center');
        text(ctx, on ? 'ABERTA' : 'FECHADA', x, y + 40, 10, on ? C.accent : C.muted, 'center', true);
      }
    });
  }

  // ---------- painel do operador ----------
  const PANEL_W = 290;
  function panelLayout(world) {
    const lamps = byType(world, 'lamp'), pushes = byType(world, 'push_no', 'push_nc');
    let y = 62; const L = { lamps: [], pushes: [] };
    if (lamps.length) { L.lampLabel = y; y += 22; lamps.forEach(p => { L.lamps.push({ p, y: y + 10 }); y += 30; }); y += 12; }
    if (pushes.length) { L.pushLabel = y; y += 12; pushes.forEach(p => { L.pushes.push({ p, y }); y += 46; }); }
    L.hint = y + 14; L.bottom = y + 26;
    return L;
  }

  function drawPanel(ctx, o, L) {
    const { world, run, t } = o;
    text(ctx, 'PAINEL DO OPERADOR', 0, 14, 11, C.muted, 'left', true);
    const hasCpu = world.parts.some(p => p.type === 'plc_cpu');
    if (hasCpu) {
      const state = !run ? 'STOP' : (world.plcPowered === false ? 'SEM ALIM.' : 'RUN'), col = state === 'RUN' ? C.accent : (state === 'STOP' ? C.muted : C.danger);
      rrect(ctx, 0, 24, 92, 24, 12); ctx.fillStyle = C.panel2; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = C.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(14, 36, 4.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      text(ctx, 'CLP ' + state, 26, 40, 11, col, 'left', true);
    }
    if (L.lamps.length) {
      text(ctx, 'SINALEIROS', 0, L.lampLabel, 10, C.muted, 'left', true);
      L.lamps.forEach(({ p, y }) => {
        const on = run && Math.abs(p.simVoltage) > 2;
        if (on) { const g = ctx.createRadialGradient(12, y, 3, 12, y, 22); g.addColorStop(0, 'rgba(255,214,102,.7)'); g.addColorStop(1, 'rgba(255,214,102,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(12, y, 22, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.arc(12, y, 10, 0, Math.PI * 2); ctx.fillStyle = on ? '#ffd666' : '#111923'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = on ? '#ffe9a8' : C.muted; ctx.stroke();
        text(ctx, p.name, 32, y + 4, 12, on ? C.white : C.text, 'left', on);
      });
    }
    if (L.pushes.length) {
      text(ctx, 'BOTOEIRA', 0, L.pushLabel, 10, C.muted, 'left', true);
      L.pushes.forEach(({ p, y }) => {
        const nc = p.type === 'push_nc', col = nc ? '#e0736f' : C.accent;
        const pressed = nc ? !p.closed : p.closed, w = PANEL_W - 10, h = 36;
        rrect(ctx, 0, y, w, h, 9);
        ctx.fillStyle = pressed ? (nc ? 'rgba(224,115,111,.35)' : 'rgba(67,198,172,.35)') : C.panel2; ctx.fill();
        ctx.lineWidth = pressed ? 2.4 : 1.6; ctx.globalAlpha = run ? 1 : 0.5; ctx.strokeStyle = col; ctx.stroke();
        ctx.beginPath(); ctx.arc(20, y + h / 2, 9, 0, Math.PI * 2); ctx.fillStyle = pressed ? col : 'rgba(0,0,0,.25)'; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
        text(ctx, p.name, 40, y + h / 2 + 4.5, 13, C.white, 'left', true);
        text(ctx, nc ? 'NF' : 'NA', w - 12, y + h / 2 + 4, 10, C.muted, 'right');
        ctx.globalAlpha = 1;
        if (run && !o.everPressed) {                              // convite para apertar
          const k = 0.5 + 0.5 * Math.sin(t / 260);
          ctx.strokeStyle = 'rgba(67,198,172,' + (0.25 + 0.5 * k).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
          rrect(ctx, -3, y - 3, w + 6, h + 6, 11); ctx.stroke(); ctx.setLineDash([]);
        }
      });
    }
    text(ctx, run ? 'Segure o botão do mouse sobre um botão para acioná-lo.' : 'Clique em ▶ Simular para operar a planta.', 0, L.hint, 11, C.muted);
  }

  // ---------- quadro completo ----------
  function draw(ctx, W, H, dpr, st, compact) {
    const world = st.world, run = !!(st.running && world.sim.ok), t = st.time || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    last = { buttons: [] };
    if (!hasPlant(world)) {
      text(ctx, 'Este projeto não tem componentes de planta.', W / 2, H / 2 - 6, compact ? 11 : 15, C.text, 'center', true);
      text(ctx, compact ? 'Use o exemplo Tanque.' : 'Carregue o exemplo "Tanque" ou adicione sensor de nível, bomba e válvula pela paleta.', W / 2, H / 2 + (compact ? 10 : 16), compact ? 10 : 12, C.muted, 'center');
      return;
    }
    const o = { world, run, t, compact, everPressed: st.everPressed };
    if (compact) {
      const s = Math.min(W / SW, H / SH), ox = (W - SW * s) / 2, oy = (H - SH * s) / 2;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      drawScene(ctx, o);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return;
    }
    const L = panelLayout(world), LW = 20 + SW + 30 + PANEL_W + 20, LH = Math.max(20 + SH + 20, 20 + L.bottom + 20);
    const s = clamp(Math.min(W / LW, H / LH), 0.45, 1.8), ox = (W - LW * s) / 2, oy = (H - LH * s) / 2;
    const px = 20 + SW + 30, py = 20;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.save(); ctx.translate(20, 20 + Math.max(0, (LH - 40 - SH) / 2 * 0)); drawScene(ctx, o); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px - 15, 20); ctx.lineTo(px - 15, LH - 20); ctx.stroke();
    ctx.save(); ctx.translate(px, py); drawPanel(ctx, o, L); ctx.restore();
    L.pushes.forEach(({ p, y }) => {
      last.buttons.push({ id: p.id, x0: ox + px * s, y0: oy + (py + y) * s, x1: ox + (px + PANEL_W - 10) * s, y1: oy + (py + y + 36) * s });
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // id da botoeira sob o ponto (px do canvas), ou null
  function buttonAt(x, y) {
    const b = last.buttons.find(r => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
    return b ? b.id : null;
  }

  return { draw, buttonAt, hasPlant };
})();
