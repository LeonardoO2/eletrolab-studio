// Engine: junta o solver elétrico, o motor Ladder e o ciclo de varredura do CLP.
// Não depende de DOM, então pode ser testado em Node.
const Engine = (function () {
  const S = (typeof module !== 'undefined') ? require('./solver.js') : Solver;
  const P = (typeof module !== 'undefined') ? require('./plc.js') : PLC;
  const VERSION = '0.13.0', SCHEMA = 2;
  const INPUT_ON = 12;   // V mínimos para nível alto em entrada do CLP
  const COIL_ON = 12;    // V mínimos para energizar bobina de relé
  const LOAD_ON = 12;    // V mínimos para a bomba funcionar e a válvula abrir
  const CPU_ON = 18;     // V mínimos de alimentação para o CLP funcionar
  const CPU_W = 220, CPU_H = 180;

  // labels = nomes dos terminais (estilo de diagrama de comando)
  const DEFAULTS = {
    source:     { name: 'Fonte 24V',    value: 24,   unit: 'V', labels: ['−', '+'] },
    ground:     { name: 'Terra',        value: 0,    unit: '',  labels: [''] },
    rail_pos:   { name: '+24V',         value: 0,    unit: '',  labels: [], len: 8 },
    rail_neg:   { name: '0V',           value: 0,    unit: '',  labels: [], len: 8 },
    push_no:    { name: 'Botão S1',     value: 0,    unit: '',  labels: ['3', '4'] },
    push_nc:    { name: 'Botão S0',     value: 0,    unit: '',  labels: ['1', '2'], nc: true },
    relay_coil: { name: 'K1',           value: 100,  unit: 'Ω', labels: ['A1', 'A2'] },
    relay_no:   { name: 'K1 (NA)',      value: 0,    unit: '',  labels: ['13', '14'] },
    relay_nc:   { name: 'K1 (NF)',      value: 0,    unit: '',  labels: ['21', '22'], nc: true },
    lamp:       { name: 'Sinaleiro H1', value: 120,  unit: 'Ω', labels: ['X1', 'X2'] },
    motor_load: { name: 'Motor M1',     value: 50,   unit: 'Ω', labels: ['M1', 'M2'] },
    plc_input:  { name: 'Entrada',      value: 3000, unit: 'Ω', labels: ['I', '0V'] },
    plc_output: { name: 'Saída',        value: 0,    unit: '',  labels: ['L+', 'Q'] },
    plc_cpu:    { name: 'CLP',          value: 1200, unit: 'Ω', labels: ['L+', 'M'] },
    // proteção e sensores: acionamento com trava (clique alterna na simulação)
    estop:      { name: 'Emergência E0', value: 0,   unit: '',  labels: ['11', '12'], nc: true },
    thermal:    { name: 'Térmico F1',   value: 0,    unit: '',  labels: ['95', '96'], nc: true },
    sensor_ind: { name: 'Sensor indutivo B3', value: 0, unit: '', labels: ['3', '4'] },
    // planta didática (tanque): value do sensor = nível (%) em que o contato fecha
    level_sw:   { name: 'Sensor de nível', value: 50, unit: '%', labels: ['1', '2'] },
    pump:       { name: 'Bomba P1',     value: 48,   unit: 'Ω', labels: ['M1', 'M2'] },
    valve:      { name: 'Válvula Y1',   value: 120,  unit: 'Ω', labels: ['A1', 'A2'] }
  };
  const LATCH_TYPES = ['estop', 'thermal', 'sensor_ind'];
  const PLANT_TYPES = ['level_sw', 'pump', 'valve'];
  const LAMP_COLORS = ['red', 'yellow', 'green'];
  // Tipo de planta didática do projeto: 'tank' (sensor, bomba ou válvula), 'traffic' (sinaleiros vermelho e verde) ou null.
  function plantKind(w) {
    if (w.parts.some(p => PLANT_TYPES.includes(p.type))) return 'tank';
    const cs = w.parts.filter(p => p.type === 'lamp').map(p => p.color);
    return cs.includes('red') && cs.includes('green') ? 'traffic' : null;
  }
  const hasPlantParts = w => plantKind(w) !== null;

  // Planta didática: um tanque. Níveis e vazões em % (do tanque cheio) e % por segundo.
  const defaultPlant = () => ({ initial: 10, fillRate: 5, drainRate: 7, level: 10, pumping: false, draining: false, overflow: false });
  function sanitizePlant(src) {
    const pl = defaultPlant(), num = (v, d, lo, hi) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    if (src && typeof src === 'object') {
      pl.initial = num(src.initial, pl.initial, 0, 100);
      pl.fillRate = num(src.fillRate, pl.fillRate, 0, 100);
      pl.drainRate = num(src.drainRate, pl.drainRate, 0, 100);
    }
    pl.level = pl.initial;
    return pl;
  }

  // Posição e direção de saída (dx,dy) de cada pino, em coordenadas locais (antes de girar).
  function pinLocal(p) {
    const t = p.type;
    if (t === 'ground') return [{ x: 0, y: -5, dx: 0, dy: -1 }];
    if (t === 'rail_pos' || t === 'rail_neg') {
      const len = Math.max(2, Math.round(Number(p.len) || 8)), d = t === 'rail_pos' ? 1 : -1, out = [];
      for (let k = 0; k <= len; k++) out.push({ x: 0, y: (k - len / 2) * 20, dx: d, dy: 0 });
      return out;
    }
    if (t === 'plc_cpu') return [{ x: 0, y: -CPU_H / 2, dx: 0, dy: -1 }, { x: 0, y: CPU_H / 2, dx: 0, dy: 1 }];
    return [{ x: -38, y: 0, dx: -1, dy: 0 }, { x: 38, y: 0, dx: 1, dy: 0 }];
  }

  function blank(type) {
    const d = DEFAULTS[type];
    return { id: 0, type, x: 0, y: 0, rotation: 0, name: d.name, value: d.value, tag: '', ref: '', color: '', len: d.len || 0,
             closed: d.nc === true, energized: false, outOn: false, simVoltage: 0, simCurrent: 0 };
  }

  function createWorld() {
    return { parts: [], wires: [], zones: [], program: [], rt: P.createRuntime(), nextId: 1, nextZoneId: 1,
             sim: { ok: false, V: 0, I: 0, P: 0 }, plcPowered: true, pinV: {}, plant: defaultPlant(), sheet: defaultSheet() };
  }
  function defaultSheet() { return { title: '', author: '', rev: 'A' }; }
  function sanitizeSheet(s) {
    const o = defaultSheet(); if (!s || typeof s !== 'object') return o;
    ['title', 'author', 'rev'].forEach(k => { if (typeof s[k] === 'string') o[k] = s[k].slice(0, 80); });
    return o;
  }

  function makePart(w, type, x, y, overrides) {
    if (!DEFAULTS[type]) throw new Error('Tipo desconhecido: ' + type);
    const p = Object.assign(blank(type), { id: w.nextId++, x, y }, overrides || {});
    w.parts.push(p);
    return p;
  }

  function makeZone(w, x, y, ww, hh, label) {
    const z = { id: w.nextZoneId++, x, y, w: ww, h: hh, label: String(label || 'Seção') };
    w.zones.push(z);
    return z;
  }

  function clear(w) {
    w.parts = []; w.wires = []; w.zones = []; w.program = []; w.nextId = 1; w.nextZoneId = 1;
    w.rt = P.createRuntime(); w.sim = { ok: false, V: 0, I: 0, P: 0 }; w.plcPowered = true; w.pinV = {}; w.plant = defaultPlant(); w.sheet = defaultSheet();
  }

  // Os sensores de nível seguem o nível do tanque: contato NA que fecha quando o nível chega ao valor configurado.
  function updateSensors(w) {
    w.parts.forEach(p => { if (p.type === 'level_sw') p.closed = w.plant.level >= (Number(p.value) || 0); });
  }

  function resetStates(w) {
    w.parts.forEach(p => {
      p.closed = DEFAULTS[p.type].nc === true;
      p.energized = false; p.outOn = false; p.simVoltage = 0; p.simCurrent = 0;
    });
    w.wires.forEach(x => { x.v = null; x.flow = 0; });
    w.rt = P.createRuntime();
    w.sim = { ok: false, V: 0, I: 0, P: 0 };
    w.plcPowered = true; w.pinV = {};
    const pl = w.plant;
    pl.level = pl.initial; pl.pumping = false; pl.draining = false; pl.overflow = false;
    updateSensors(w);
  }

  // Dinâmica do tanque: cada bomba energizada enche, cada válvula aberta esvazia. Roda uma vez por varredura.
  function plantStep(w, dtMs) {
    const pl = w.plant, dt = Math.max(0, dtMs) / 1000;
    const pumps = w.parts.filter(p => p.type === 'pump' && p.energized).length;
    const valves = w.parts.filter(p => p.type === 'valve' && p.energized).length;
    pl.pumping = pumps > 0; pl.draining = valves > 0 && pl.level > 0;
    const next = pl.level + (pumps * pl.fillRate - valves * pl.drainRate) * dt;
    pl.overflow = pl.pumping && next >= 100;
    pl.level = Math.max(0, Math.min(100, next));
    updateSensors(w);
  }

  // Resolve o circuito; contatos de relé seguem o estado das bobinas (itera até estabilizar).
  function solveElectric(w) {
    for (let it = 0; it < 4; it++) {
      const r = S.solve(w.parts, w.wires);
      w.parts.forEach(p => { const x = r.results[p.id]; p.simVoltage = x.v; p.simCurrent = x.i; });
      w.wires.forEach((x, i) => { x.v = r.wireV[i]; x.flow = r.wireFlow[i]; });
      w.pinV = r.pinV;
      w.sim = { ok: true, V: r.V, I: r.I, P: r.P };
      w.parts.forEach(p => {
        if (p.type === 'relay_coil') p.energized = Math.abs(p.simVoltage) >= COIL_ON;
        else if (p.type === 'pump' || p.type === 'valve') p.energized = Math.abs(p.simVoltage) >= LOAD_ON;
      });
      let changed = false;
      w.parts.forEach(p => {
        if (p.type !== 'relay_no' && p.type !== 'relay_nc') return;
        const coil = w.parts.find(q => q.type === 'relay_coil' && q.name === p.ref);
        const e = !!(coil && coil.energized);
        const c = p.type === 'relay_no' ? e : !e;
        if (c !== p.closed) { p.closed = c; changed = true; }
      });
      if (!changed) break;
    }
  }

  // Sem bloco CLP no projeto (projetos antigos), o CLP é considerado alimentado.
  function cpuPowered(w) {
    const cpus = w.parts.filter(p => p.type === 'plc_cpu');
    return cpus.length === 0 || cpus.every(c => c.simVoltage >= CPU_ON);
  }

  function start(w) { resetStates(w); solveElectric(w); w.plcPowered = cpuPowered(w); }
  function stop(w) { resetStates(w); }

  // Ciclo de varredura: (1) lê entradas físicas, (2) executa o Ladder, (3) escreve saídas físicas.
  // Sem alimentação, o CLP desliga: memória apagada e todas as saídas abertas.
  function step(w, dtMs) {
    solveElectric(w);
    w.plcPowered = cpuPowered(w);
    if (!w.plcPowered) {
      w.rt = P.createRuntime();
      w.parts.forEach(p => { if (p.type === 'plc_output') p.outOn = false; });
      solveElectric(w);
      w.plcPowered = cpuPowered(w);
      plantStep(w, dtMs);
      return null;
    }
    w.parts.forEach(p => { if (p.type === 'plc_input' && p.tag) w.rt.tags[p.tag] = p.simVoltage >= INPUT_ON; });
    const info = P.scan(w.program, w.rt, dtMs);
    w.parts.forEach(p => { if (p.type === 'plc_output') p.outOn = !!w.rt.tags[p.tag]; });
    solveElectric(w);
    plantStep(w, dtMs);
    return info;
  }

  function serialize(w) {
    return {
      app: 'EletroLab Studio', version: VERSION, schema: SCHEMA, nextId: w.nextId,
      parts: w.parts.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, rotation: p.rotation, name: p.name, value: p.value, tag: p.tag, ref: p.ref, len: p.len, color: p.color || undefined })),
      wires: w.wires.map(x => ({ a: { id: x.a.id, pin: x.a.pin }, b: { id: x.b.id, pin: x.b.pin } })),
      zones: w.zones.map(z => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h, label: z.label })),
      plant: { initial: w.plant.initial, fillRate: w.plant.fillRate, drainRate: w.plant.drainRate },
      sheet: { title: w.sheet.title, author: w.sheet.author, rev: w.sheet.rev },
      program: w.program
    };
  }

  // Retorna uma lista de avisos (strings) para mostrar ao usuário.
  function loadProject(w, data) {
    if (!data || !Array.isArray(data.parts) || !Array.isArray(data.wires)) throw new Error('Arquivo de projeto inválido.');
    const warnings = [];
    const parts = data.parts.map(o => {
      if (!o || !DEFAULTS[o.type]) throw new Error('Componente desconhecido no arquivo: ' + (o && o.type));
      const p = blank(o.type);
      p.id = Number(o.id); p.x = Number(o.x) || 0; p.y = Number(o.y) || 0; p.rotation = Number(o.rotation) || 0;
      p.name = String(o.name != null ? o.name : p.name); p.value = Number(o.value);
      if (!isFinite(p.value)) p.value = DEFAULTS[o.type].value;
      p.tag = String(o.tag || ''); p.ref = String(o.ref || '');
      if (o.type === 'lamp' && LAMP_COLORS.includes(o.color)) p.color = o.color;
      if (DEFAULTS[o.type].len) {
        let len = Math.round(Number(o.len) || DEFAULTS[o.type].len);
        len = Math.max(2, Math.min(80, len)); if (len % 2) len += 1;
        p.len = len;
      }
      return p;
    });
    const ids = new Set(parts.map(p => p.id));
    if (ids.size !== parts.length || parts.some(p => !isFinite(p.id))) throw new Error('IDs de componentes inválidos.');
    const wires = data.wires
      .filter(x => x && x.a && x.b && ids.has(x.a.id) && ids.has(x.b.id))
      .filter(x => x.a.pin < S.pinCount(parts.find(p => p.id === x.a.id)) && x.b.pin < S.pinCount(parts.find(p => p.id === x.b.id)))
      .map(x => ({ a: { id: x.a.id, pin: x.a.pin }, b: { id: x.b.id, pin: x.b.pin } }));
    w.parts = parts; w.wires = wires;
    w.zones = (Array.isArray(data.zones) ? data.zones : []).filter(z => z && isFinite(Number(z.x)) && isFinite(Number(z.y)))
      .map((z, i) => ({ id: Number(z.id) || i + 1, x: Number(z.x), y: Number(z.y), w: Math.max(60, Number(z.w) || 200), h: Math.max(60, Number(z.h) || 160), label: String(z.label || 'Seção') }));
    w.nextZoneId = w.zones.reduce((m, z) => Math.max(m, z.id), 0) + 1;
    w.program = P.sanitizeProgram(data.program);
    w.plant = sanitizePlant(data.plant);
    w.sheet = sanitizeSheet(data.sheet);
    w.nextId = parts.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    resetStates(w);
    if (!(data.schema >= 2) && parts.some(p => p.type === 'plc_output')) {
      warnings.push('Projeto de versão anterior: o módulo de saída agora é um contato (pino de cima = L+, pino de baixo = Q). Revise a ligação das saídas.');
    }
    return warnings;
  }

  // Exemplo em diagrama de comando: tudo pendurado entre o trilho +24V (em cima) e o 0V (embaixo).
  //   Entradas (S0/S1 → módulos de entrada) → CLP → saídas (Q0.0 → K1 → contato K1 → motor; Q0.1 → H1).
  function loadExample(w) {
    clear(w);
    // Da esquerda para a direita: fonte → entradas → CLP → comando K1 → potência (contato K1 + motor) → sinaleiro.
    // O contato K1 fica ao lado da bobina (acoplamento curto, sem cruzar outras colunas) e a lâmpada vai por último.
    const TOP = 80, BOT = 420, LEN = 52, RX = 560;
    const top = makePart(w, 'rail_pos', RX, TOP, { rotation: 90, len: LEN, name: '+24V' });
    const bot = makePart(w, 'rail_neg', RX, BOT, { rotation: 90, len: LEN, name: '0V' });
    const R = (rail, X) => ({ id: rail.id, pin: rail.len / 2 + (rail.x - X) / 20 }); // trilho girado 90°
    const pin = (p, i) => ({ id: p.id, pin: i });
    const link = (a, b) => w.wires.push({ a, b });
    const V = (type, x, y, o) => makePart(w, type, x, y, Object.assign({ rotation: 90 }, o));

    const src = V('source', 80, 250, { rotation: 270, name: 'Fonte' });

    const s0 = V('push_nc', 200, 160, { name: 'S0 Desliga' });
    const in0 = V('plc_input', 200, 270, { name: 'Entrada I0.0', tag: '%I0.0' });
    const s1 = V('push_no', 320, 190, { name: 'S1 Liga' });
    const in1 = V('plc_input', 320, 320, { name: 'Entrada I0.1', tag: '%I0.1' });

    const cpu = makePart(w, 'plc_cpu', 560, 240, { name: 'CLP' });

    const out0 = V('plc_output', 760, 170, { name: 'Saída Q0.0', tag: '%Q0.0' });
    const k1 = V('relay_coil', 760, 290, { name: 'K1' });
    const k1c = V('relay_no', 900, 180, { name: 'K1 (NA)', ref: 'K1' });
    const m1 = V('motor_load', 900, 320, { name: 'Motor M1' });
    const out1 = V('plc_output', 1060, 170, { name: 'Saída Q0.1', tag: '%Q0.1' });
    const h1 = V('lamp', 1060, 300, { name: 'H1 (após 3 s)' });

    link(pin(src, 1), R(top, 80)); link(pin(src, 0), R(bot, 80));
    link(R(top, 200), pin(s0, 0)); link(pin(s0, 1), pin(in0, 0)); link(pin(in0, 1), R(bot, 200));
    link(R(top, 320), pin(s1, 0)); link(pin(s1, 1), pin(in1, 0)); link(pin(in1, 1), R(bot, 320));
    link(R(top, 560), pin(cpu, 0)); link(pin(cpu, 1), R(bot, 560));
    link(R(top, 760), pin(out0, 0)); link(pin(out0, 1), pin(k1, 0)); link(pin(k1, 1), R(bot, 760));
    link(R(top, 900), pin(k1c, 0)); link(pin(k1c, 1), pin(m1, 0)); link(pin(m1, 1), R(bot, 900));
    link(R(top, 1060), pin(out1, 0)); link(pin(out1, 1), pin(h1, 0)); link(pin(h1, 1), R(bot, 1060));

    makeZone(w, 44, 48, 120, 400, 'Fonte');
    makeZone(w, 176, 48, 250, 400, 'Entradas');
    makeZone(w, 436, 48, 250, 400, 'CLP');
    makeZone(w, 700, 48, 142, 400, 'Comando K1');
    makeZone(w, 852, 48, 156, 400, 'Potência K1');
    makeZone(w, 1018, 48, 182, 400, 'Sinaleiro H1');

    w.program = [
      { comment: 'Liga/desliga com selo: S1 (%I0.1) liga, S0 (%I0.0, NF físico) desliga',
        cells: [{ contacts: [{ type: 'NO', tag: '%I0.1' }, { type: 'NO', tag: '%Q0.0' }] },
                { contacts: [{ type: 'NO', tag: '%I0.0' }] }],
        out: { type: 'coil', tag: '%Q0.0', preset: 0 } },
      { comment: 'Temporizador: 3 s após o motor ligar',
        cells: [{ contacts: [{ type: 'NO', tag: '%Q0.0' }] }],
        out: { type: 'ton', tag: 'T1', preset: 3000 } },
      { comment: 'Sinaleiro H1 acende quando T1 concluir',
        cells: [{ contacts: [{ type: 'NO', tag: 'T1.DN' }] }],
        out: { type: 'coil', tag: '%Q0.1', preset: 0 } }
    ];
    resetStates(w);
  }

  // Exemplo da planta didática: tanque com bomba, dreno manual e dois sensores de nível.
  //   Entradas: S0 (para, NF), S1 (liga), B1 (nível ≥ 20%), B2 (nível ≥ 80%).
  //   Saídas:   Q0.0 → K1 → bomba P1;  Q0.1 → H1 (alarme de falha de bomba).
  //   Dreno manual Y1 (consumo): botão S2 direto na alimentação, sem passar pelo CLP.
  // Partida de motor com proteção: emergência (NF) e relé térmico (NF) como entradas do CLP,
  // contator K1 comandado pela saída Q0.0 e falha memorizada (reconhecida com S1).
  function loadMotorExample(w) {
    clear(w);
    const TOP = 80, BOT = 470, LEN = 66, RX = 700;
    const top = makePart(w, 'rail_pos', RX, TOP, { rotation: 90, len: LEN, name: '+24V' });
    const bot = makePart(w, 'rail_neg', RX, BOT, { rotation: 90, len: LEN, name: '0V' });
    const R = (rail, X) => ({ id: rail.id, pin: rail.len / 2 + (rail.x - X) / 20 });
    const pin = (p, i) => ({ id: p.id, pin: i });
    const link = (a, b) => w.wires.push({ a, b });
    const V = (type, x, y, o) => makePart(w, type, x, y, Object.assign({ rotation: 90 }, o));

    const src = V('source', 80, 280, { rotation: 270, name: 'Fonte' });
    const s0 = V('push_nc', 220, 170, { name: 'S0 Para' });
    const in0 = V('plc_input', 220, 290, { name: 'Entrada I0.0', tag: '%I0.0' });
    const s1 = V('push_no', 340, 170, { name: 'S1 Liga' });
    const in1 = V('plc_input', 340, 330, { name: 'Entrada I0.1', tag: '%I0.1' });
    const f1 = V('thermal', 460, 170, { name: 'F1 Térm.' });
    const in2 = V('plc_input', 460, 370, { name: 'Entrada I0.2', tag: '%I0.2' });
    const e0 = V('estop', 580, 170, { name: 'E0 Emerg.' });
    const in3 = V('plc_input', 580, 410, { name: 'Entrada I0.3', tag: '%I0.3' });
    const cpu = makePart(w, 'plc_cpu', 800, 240, { name: 'CLP' });
    const out0 = V('plc_output', 1000, 170, { name: 'Saída Q0.0', tag: '%Q0.0' });
    const k1 = V('relay_coil', 1000, 290, { name: 'K1' });
    const k1c = V('relay_no', 1120, 180, { name: 'K1 (NA)', ref: 'K1' });
    const m1 = V('motor_load', 1120, 320, { name: 'Motor M1' });
    const out1 = V('plc_output', 1240, 170, { name: 'Saída Q0.1', tag: '%Q0.1' });
    const h1 = V('lamp', 1240, 300, { name: 'H1 Falha' });

    link(pin(src, 1), R(top, 80)); link(pin(src, 0), R(bot, 80));
    [[s0, in0, 220], [s1, in1, 340], [f1, in2, 460], [e0, in3, 580]].forEach(([sw, inp, X]) => {
      link(R(top, X), pin(sw, 0)); link(pin(sw, 1), pin(inp, 0)); link(pin(inp, 1), R(bot, X));
    });
    link(R(top, 800), pin(cpu, 0)); link(pin(cpu, 1), R(bot, 800));
    link(R(top, 1000), pin(out0, 0)); link(pin(out0, 1), pin(k1, 0)); link(pin(k1, 1), R(bot, 1000));
    link(R(top, 1120), pin(k1c, 0)); link(pin(k1c, 1), pin(m1, 0)); link(pin(m1, 1), R(bot, 1120));
    link(R(top, 1240), pin(out1, 0)); link(pin(out1, 1), pin(h1, 0)); link(pin(h1, 1), R(bot, 1240));

    makeZone(w, 44, 48, 96, 450, 'Fonte');
    makeZone(w, 180, 48, 490, 450, 'Comando e proteção');
    makeZone(w, 676, 48, 254, 450, 'CLP');
    makeZone(w, 940, 48, 120, 450, 'Contator K1');
    makeZone(w, 1070, 48, 140, 450, 'Motor');
    makeZone(w, 1214, 48, 136, 450, 'Falha');

    const c = (type, tag) => ({ type, tag });
    w.program = [
      { comment: 'Partida com selo: S1 (%I0.1) liga; S0, F1 e E0 são NF físicos (verdadeiros em repouso) e desligam ao abrir',
        cells: [{ contacts: [c('NO', '%I0.1'), c('NO', '%M0.0')] }, { contacts: [c('NO', '%I0.0')] }, { contacts: [c('NO', '%I0.2')] },
                { contacts: [c('NO', '%I0.3')] }, { contacts: [c('NC', '%M0.1')] }],
        out: { type: 'coil', tag: '%M0.0', preset: 0 } },
      { comment: 'Contator K1 (%Q0.0) acompanha a partida; o contato K1 alimenta o motor',
        cells: [{ contacts: [c('NO', '%M0.0')] }],
        out: { type: 'coil', tag: '%Q0.0', preset: 0 } },
      { comment: 'Falha: térmico F1 atuou ou emergência E0 acionada — memoriza',
        cells: [{ contacts: [c('NC', '%I0.2'), c('NC', '%I0.3')] }],
        out: { type: 'set', tag: '%M0.1', preset: 0 } },
      { comment: 'Reconhecer: com F1 e E0 rearmados, apertar S1 limpa a falha',
        cells: [{ contacts: [c('NO', '%I0.1')] }, { contacts: [c('NO', '%I0.2')] }, { contacts: [c('NO', '%I0.3')] }],
        out: { type: 'reset', tag: '%M0.1', preset: 0 } },
      { comment: 'Sinaleiro H1 indica falha memorizada',
        cells: [{ contacts: [c('NO', '%M0.1')] }],
        out: { type: 'coil', tag: '%Q0.1', preset: 0 } }
    ];
    resetStates(w);
  }

  // Contagem de peças: mesma planta elétrica do motor, com o sensor B3 no lugar do térmico.
  // Esteira liga com S1; cada vez que B3 fecha, o CTU C1 conta; ao completar o lote a esteira para e H1 acende.
  function loadCounterExample(w) {
    loadMotorExample(w);
    const named = n => w.parts.find(p => p.name === n);
    const b3 = named('F1 Térm.'); b3.type = 'sensor_ind'; b3.name = 'B3 Peça';
    named('Motor M1').name = 'Esteira'; named('H1 Falha').name = 'H1 Lote';
    const c = (type, tag) => ({ type, tag });
    w.program = [
      { comment: 'Esteira com selo: S1 (%I0.1) liga; S0 (NF), emergência E0 (NF) e lote completo (%M0.1) desligam',
        cells: [{ contacts: [c('NO', '%I0.1'), c('NO', '%M0.0')] }, { contacts: [c('NO', '%I0.0')] }, { contacts: [c('NO', '%I0.3')] }, { contacts: [c('NC', '%M0.1')] }],
        out: { type: 'coil', tag: '%M0.0', preset: 0 } },
      { comment: 'Contator K1 (%Q0.0) aciona a esteira',
        cells: [{ contacts: [c('NO', '%M0.0')] }],
        out: { type: 'coil', tag: '%Q0.0', preset: 0 } },
      { comment: 'Conta uma peça a cada vez que o sensor B3 (%I0.2) fecha, com a esteira ligada. Lote de 5',
        cells: [{ contacts: [c('NO', '%I0.2')] }, { contacts: [c('NO', '%M0.0')] }],
        out: { type: 'ctu', tag: 'C1', preset: 5 } },
      { comment: 'Lote completo: C1.DN memoriza e para a esteira',
        cells: [{ contacts: [c('NO', 'C1.DN')] }],
        out: { type: 'set', tag: '%M0.1', preset: 0 } },
      { comment: 'Novo lote: com o lote completo, apertar S1 zera o contador C1',
        cells: [{ contacts: [c('NO', '%I0.1')] }, { contacts: [c('NO', '%M0.1')] }],
        out: { type: 'ctr', tag: 'C1', preset: 0 } },
      { comment: 'Novo lote: e libera a esteira (limpa %M0.1)',
        cells: [{ contacts: [c('NO', '%I0.1')] }, { contacts: [c('NO', '%M0.1')] }],
        out: { type: 'reset', tag: '%M0.1', preset: 0 } },
      { comment: 'Sinaleiro H1: acende com o lote completo ou quase completo (comparação C1.ACC ≥ 4)',
        cells: [{ contacts: [c('NO', '%M0.1'), { type: 'CMP', tag: 'C1.ACC', op: '>=', value: 4 }] }],
        out: { type: 'coil', tag: '%Q0.1', preset: 0 } }
    ];
    resetStates(w);
  }

  // Semáforo: um único temporizador (ciclo de 12 s) e comparações decidem qual lâmpada acende:
  // verde de 0 a 5 s, amarelo de 5 a 7 s e vermelho de 7 a 12 s.
  function loadTrafficExample(w) {
    clear(w);
    const TOP = 80, BOT = 470, LEN = 52, RX = 560;
    const top = makePart(w, 'rail_pos', RX, TOP, { rotation: 90, len: LEN, name: '+24V' });
    const bot = makePart(w, 'rail_neg', RX, BOT, { rotation: 90, len: LEN, name: '0V' });
    const R = (rail, X) => ({ id: rail.id, pin: rail.len / 2 + (rail.x - X) / 20 });
    const pin = (p, i) => ({ id: p.id, pin: i });
    const link = (a, b) => w.wires.push({ a, b });
    const V = (type, x, y, o) => makePart(w, type, x, y, Object.assign({ rotation: 90 }, o));

    const src = V('source', 80, 280, { rotation: 270, name: 'Fonte' });
    const s0 = V('push_nc', 220, 170, { name: 'S0 Para' });
    const in0 = V('plc_input', 220, 290, { name: 'Entrada I0.0', tag: '%I0.0' });
    const s1 = V('push_no', 340, 170, { name: 'S1 Liga' });
    const in1 = V('plc_input', 340, 330, { name: 'Entrada I0.1', tag: '%I0.1' });
    const cpu = makePart(w, 'plc_cpu', 580, 240, { name: 'CLP' });
    const outs = [['Saída Q0.0', '%Q0.0', 760, 'Verde', 'green'], ['Saída Q0.1', '%Q0.1', 880, 'Amarelo', 'yellow'], ['Saída Q0.2', '%Q0.2', 1000, 'Vermelho', 'red']]
      .map(([n, tag, x, ln, color]) => ({ x, out: V('plc_output', x, 170, { name: n, tag }), lamp: V('lamp', x, 300, { name: ln, color }) }));

    link(pin(src, 1), R(top, 80)); link(pin(src, 0), R(bot, 80));
    [[s0, in0, 220], [s1, in1, 340]].forEach(([sw, inp, X]) => {
      link(R(top, X), pin(sw, 0)); link(pin(sw, 1), pin(inp, 0)); link(pin(inp, 1), R(bot, X));
    });
    link(R(top, 580), pin(cpu, 0)); link(pin(cpu, 1), R(bot, 580));
    outs.forEach(({ x, out, lamp }) => {
      link(R(top, x), pin(out, 0)); link(pin(out, 1), pin(lamp, 0)); link(pin(lamp, 1), R(bot, x));
    });

    makeZone(w, 44, 48, 96, 450, 'Fonte');
    makeZone(w, 180, 48, 250, 450, 'Comando');
    makeZone(w, 436, 48, 260, 450, 'CLP');
    makeZone(w, 700, 48, 120, 450, 'Verde');
    makeZone(w, 824, 48, 120, 450, 'Amarelo');
    makeZone(w, 948, 48, 120, 450, 'Vermelho');

    const c = (type, tag) => ({ type, tag });
    const cmp = (op, value) => ({ type: 'CMP', tag: 'T1.ACC', op, value });
    w.program = [
      { comment: 'Liga/desliga o ciclo com selo: S1 (%I0.1) liga; S0 (%I0.0, NF físico) desliga',
        cells: [{ contacts: [c('NO', '%I0.1'), c('NO', '%M0.0')] }, { contacts: [c('NO', '%I0.0')] }],
        out: { type: 'coil', tag: '%M0.0', preset: 0 } },
      { comment: 'Relógio do ciclo: T1 conta de 0 a 12 s e reinicia sozinho (NC T1.DN)',
        cells: [{ contacts: [c('NO', '%M0.0')] }, { contacts: [c('NC', 'T1.DN')] }],
        out: { type: 'ton', tag: 'T1', preset: 12000 } },
      { comment: 'Verde: de 0 a 5 s do ciclo (T1.ACC < 5000)',
        cells: [{ contacts: [c('NO', '%M0.0')] }, { contacts: [cmp('<', 5000)] }],
        out: { type: 'coil', tag: '%Q0.0', preset: 0 } },
      { comment: 'Amarelo: de 5 s a 7 s',
        cells: [{ contacts: [c('NO', '%M0.0')] }, { contacts: [cmp('>=', 5000)] }, { contacts: [cmp('<', 7000)] }],
        out: { type: 'coil', tag: '%Q0.1', preset: 0 } },
      { comment: 'Vermelho: de 7 s até o fim do ciclo',
        cells: [{ contacts: [c('NO', '%M0.0')] }, { contacts: [cmp('>=', 7000)] }],
        out: { type: 'coil', tag: '%Q0.2', preset: 0 } }
    ];
    resetStates(w);
  }

  function loadTankExample(w) {
    clear(w);
    const TOP = 80, BOT = 470, LEN = 72, RX = 760;
    const top = makePart(w, 'rail_pos', RX, TOP, { rotation: 90, len: LEN, name: '+24V' });
    const bot = makePart(w, 'rail_neg', RX, BOT, { rotation: 90, len: LEN, name: '0V' });
    const R = (rail, X) => ({ id: rail.id, pin: rail.len / 2 + (rail.x - X) / 20 });
    const pin = (p, i) => ({ id: p.id, pin: i });
    const link = (a, b) => w.wires.push({ a, b });
    const V = (type, x, y, o) => makePart(w, type, x, y, Object.assign({ rotation: 90 }, o));

    const src = V('source', 80, 280, { rotation: 270, name: 'Fonte' });

    const s2 = V('push_no', 200, 170, { name: 'S2 Dreno' });
    const y1 = V('valve', 200, 320, { name: 'Válvula Y1' });

    const s0 = V('push_nc', 340, 170, { name: 'S0 Para' });
    const in0 = V('plc_input', 340, 290, { name: 'Entrada I0.0', tag: '%I0.0' });
    const s1 = V('push_no', 460, 170, { name: 'S1 Liga' });
    const in1 = V('plc_input', 460, 330, { name: 'Entrada I0.1', tag: '%I0.1' });
    const b1 = V('level_sw', 580, 170, { name: 'B1 Baixo', value: 20 });
    const in2 = V('plc_input', 580, 370, { name: 'Entrada I0.2', tag: '%I0.2' });
    const b2 = V('level_sw', 700, 170, { name: 'B2 Alto', value: 80 });
    const in3 = V('plc_input', 700, 410, { name: 'Entrada I0.3', tag: '%I0.3' });

    const cpu = makePart(w, 'plc_cpu', 920, 240, { name: 'CLP' });

    const out0 = V('plc_output', 1120, 170, { name: 'Saída Q0.0', tag: '%Q0.0' });
    const k1 = V('relay_coil', 1120, 290, { name: 'K1' });
    const k1c = V('relay_no', 1240, 180, { name: 'K1 (NA)', ref: 'K1' });
    const pump = V('pump', 1240, 320, { name: 'Bomba P1' });
    const out1 = V('plc_output', 1360, 170, { name: 'Saída Q0.1', tag: '%Q0.1' });
    const h1 = V('lamp', 1360, 300, { name: 'H1 Alarme' });

    link(pin(src, 1), R(top, 80)); link(pin(src, 0), R(bot, 80));
    link(R(top, 200), pin(s2, 0)); link(pin(s2, 1), pin(y1, 0)); link(pin(y1, 1), R(bot, 200));
    [[s0, in0, 340], [s1, in1, 460], [b1, in2, 580], [b2, in3, 700]].forEach(([sw, inp, X]) => {
      link(R(top, X), pin(sw, 0)); link(pin(sw, 1), pin(inp, 0)); link(pin(inp, 1), R(bot, X));
    });
    link(R(top, 920), pin(cpu, 0)); link(pin(cpu, 1), R(bot, 920));
    link(R(top, 1120), pin(out0, 0)); link(pin(out0, 1), pin(k1, 0)); link(pin(k1, 1), R(bot, 1120));
    link(R(top, 1240), pin(k1c, 0)); link(pin(k1c, 1), pin(pump, 0)); link(pin(pump, 1), R(bot, 1240));
    link(R(top, 1360), pin(out1, 0)); link(pin(out1, 1), pin(h1, 0)); link(pin(h1, 1), R(bot, 1360));

    makeZone(w, 44, 48, 96, 450, 'Fonte');
    makeZone(w, 150, 48, 140, 450, 'Dreno');
    makeZone(w, 300, 48, 490, 450, 'Entradas');
    makeZone(w, 796, 48, 254, 450, 'CLP');
    makeZone(w, 1060, 48, 120, 450, 'Comando K1');
    makeZone(w, 1190, 48, 140, 450, 'Bomba');
    makeZone(w, 1334, 48, 136, 450, 'Alarme');

    const c = (type, tag) => ({ type, tag });
    w.program = [
      { comment: 'Automático com selo: S1 (%I0.1) liga, S0 (%I0.0, NF físico) desliga',
        cells: [{ contacts: [c('NO', '%I0.1'), c('NO', '%M0.0')] }, { contacts: [c('NO', '%I0.0')] }],
        out: { type: 'coil', tag: '%M0.0', preset: 0 } },
      { comment: 'Bomba: liga com o nível abaixo de B1 e desliga ao chegar em B2 (histerese). Bloqueada pelo alarme',
        cells: [{ contacts: [c('NC', '%I0.2'), c('NO', '%Q0.0')] }, { contacts: [c('NC', '%I0.3')] },
                { contacts: [c('NO', '%M0.0')] }, { contacts: [c('NC', '%M0.1')] }],
        out: { type: 'coil', tag: '%Q0.0', preset: 0 } },
      { comment: 'Falha da bomba: ligada há 6 s e o nível ainda não chegou em B1',
        cells: [{ contacts: [c('NO', '%Q0.0')] }, { contacts: [c('NC', '%I0.2')] }],
        out: { type: 'ton', tag: 'T1', preset: 6000 } },
      { comment: 'Memoriza o alarme',
        cells: [{ contacts: [c('NO', 'T1.DN')] }],
        out: { type: 'set', tag: '%M0.1', preset: 0 } },
      { comment: 'Reconhecer o alarme: apertar S1',
        cells: [{ contacts: [c('NO', '%I0.1')] }],
        out: { type: 'reset', tag: '%M0.1', preset: 0 } },
      { comment: 'Sinaleiro H1 mostra o alarme',
        cells: [{ contacts: [c('NO', '%M0.1')] }],
        out: { type: 'coil', tag: '%Q0.1', preset: 0 } }
    ];
    w.plant = sanitizePlant({ initial: 10, fillRate: 5, drainRate: 7 });
    resetStates(w);
  }

  const EXAMPLES = { partida: loadExample, motor: loadMotorExample, contador: loadCounterExample, tanque: loadTankExample, semaforo: loadTrafficExample };

  return { DEFAULTS, VERSION, CPU_W, CPU_H, PLANT_TYPES, LAMP_COLORS, plantKind, LATCH_TYPES, sanitizeSheet, EXAMPLES, loadMotorExample, loadCounterExample, loadTrafficExample, pinLocal, createWorld, makePart, makeZone, clear, start, stop, step,
           solveElectric, cpuPowered, serialize, loadProject, loadExample, loadTankExample, hasPlantParts, sanitizePlant, updateSensors };
})();
if (typeof module !== 'undefined') module.exports = Engine;
