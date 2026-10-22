// Testes sem interface: node tests/test.js
const assert = require('assert');
const Engine = require('../js/engine.js');
const PLC = require('../js/plc.js');
const Solver = require('../js/solver.js');
const Geometry = require('../js/geometry.js');

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok -', name); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b}, obtido ${a}`);
const W = (w, a, pa, b, pb) => w.wires.push({ a: { id: a.id, pin: pa }, b: { id: b.id, pin: pb } });

test('divisor resistivo: 12 V, 100 Ω + 24 Ω em série ≈ 0,0968 A', () => {
  const w = Engine.createWorld();
  const src = Engine.makePart(w, 'source', 0, 0, { value: 12 });
  const r1 = Engine.makePart(w, 'lamp', 0, 0, { value: 100 });
  const r2 = Engine.makePart(w, 'lamp', 0, 0, { value: 24 });
  const g = Engine.makePart(w, 'ground', 0, 0);
  W(w, src, 1, r1, 0); W(w, r1, 1, r2, 0); W(w, r2, 1, g, 0); W(w, src, 0, g, 0);
  const r = Solver.solve(w.parts, w.wires);
  near(r.I, 12 / 124, 1e-6, 'corrente');
  near(r.results[r1.id].v, 12 * 100 / 124, 1e-4, 'tensão em R1 (positiva)');
});

test('polaridade: pino 1 da fonte é positivo (+) e aterrar o pino 0 dá +24 V na carga', () => {
  const w = Engine.createWorld();
  const src = Engine.makePart(w, 'source', 0, 0, { value: 24 });
  const l = Engine.makePart(w, 'lamp', 0, 0, { value: 120 });
  const g = Engine.makePart(w, 'ground', 0, 0);
  W(w, src, 1, l, 0); W(w, l, 1, g, 0); W(w, src, 0, g, 0);
  const r = Solver.solve(w.parts, w.wires);
  near(r.results[l.id].v, 24, 1e-6);
  near(r.results[src.id].i, 0.2, 1e-6, 'corrente entregue positiva');
});

test('curto-circuito na fonte gera erro claro', () => {
  const w = Engine.createWorld();
  const src = Engine.makePart(w, 'source', 0, 0);
  W(w, src, 0, src, 1);
  assert.throws(() => Solver.solve(w.parts, w.wires), /Curto-circuito/);
});

test('sem fonte: erro claro', () => {
  const w = Engine.createWorld();
  Engine.makePart(w, 'lamp', 0, 0);
  assert.throws(() => Solver.solve(w.parts, w.wires), /Fonte CC/);
});

test('quantidade de pinos do solver bate com a geometria de cada tipo', () => {
  Object.keys(Engine.DEFAULTS).forEach(type => {
    const w = Engine.createWorld();
    const p = Engine.makePart(w, type, 0, 0, Engine.DEFAULTS[type].len ? { len: 10 } : {});
    assert.strictEqual(Engine.pinLocal(p).length, Solver.pinCount(p), type);
  });
});

test('trilhos: todos os pinos são a mesma rede; trilho 0V e terra são a mesma referência', () => {
  const w = Engine.createWorld();
  const src = Engine.makePart(w, 'source', 0, 0, { value: 24 });
  const top = Engine.makePart(w, 'rail_pos', 0, 0, { rotation: 90, len: 8 });
  const bot = Engine.makePart(w, 'rail_neg', 0, 0, { rotation: 90, len: 8 });
  const g = Engine.makePart(w, 'ground', 0, 0);
  const l1 = Engine.makePart(w, 'lamp', 0, 0, { value: 120 });
  const l2 = Engine.makePart(w, 'lamp', 0, 0, { value: 60 });
  W(w, src, 1, top, 0); W(w, src, 0, bot, 3);
  W(w, top, 2, l1, 0); W(w, l1, 1, bot, 7);
  W(w, top, 8, l2, 0); W(w, l2, 1, g, 0);
  const r = Solver.solve(w.parts, w.wires);
  near(r.results[l1.id].v, 24, 1e-6, 'lâmpada 1 em 24 V');
  near(r.results[l2.id].v, 24, 1e-6, 'lâmpada 2 em 24 V (via terra, mesma referência do trilho 0V)');
  near(r.I, 24 / 120 + 24 / 60, 1e-6, 'corrente total');
  const nets = Solver.analyzeNets(w.parts, w.wires);
  assert.strictEqual(nets.role[nets.netOf[top.id + ':5']], 'pos');
  assert.strictEqual(nets.role[nets.netOf[bot.id + ':0']], 'neg');
  assert.strictEqual(nets.netOf[g.id + ':0'], nets.netOf[bot.id + ':4']);
});

test('módulo de saída é um contato: aberto = 0 V na carga, fechado = 24 V', () => {
  const w = Engine.createWorld();
  const src = Engine.makePart(w, 'source', 0, 0, { value: 24 });
  const top = Engine.makePart(w, 'rail_pos', 0, 0, { rotation: 90 });
  const bot = Engine.makePart(w, 'rail_neg', 0, 0, { rotation: 90 });
  const out = Engine.makePart(w, 'plc_output', 0, 0, { tag: '%Q0.0' });
  const l = Engine.makePart(w, 'lamp', 0, 0, { value: 120 });
  W(w, src, 1, top, 0); W(w, src, 0, bot, 0); W(w, top, 1, out, 0); W(w, out, 1, l, 0); W(w, l, 1, bot, 1);
  Engine.solveElectric(w); near(l.simVoltage, 0, 1e-3, 'aberto');
  out.outOn = true; Engine.solveElectric(w); near(l.simVoltage, 24, 1e-3, 'fechado');
});

test('sentido da corrente nos fios: do + da fonte para a carga', () => {
  const w = Engine.createWorld();
  const src = Engine.makePart(w, 'source', 0, 0, { value: 24 });
  const l = Engine.makePart(w, 'lamp', 0, 0, { value: 120 });
  const g = Engine.makePart(w, 'ground', 0, 0);
  W(w, src, 1, l, 0); W(w, l, 1, g, 0); W(w, src, 0, g, 0);
  const r = Solver.solve(w.parts, w.wires);
  assert.strictEqual(r.wireFlow[0], 1, 'fio + → lâmpada: de a para b');
  assert.strictEqual(r.wireFlow[1], 1, 'fio lâmpada → terra: de a para b');
  assert.strictEqual(r.wireFlow[2], -1, 'fio − da fonte: o fluxo volta de b (terra) para a (fonte)');
  near(r.wireV[0], 24, 1e-6); near(r.wireV[1], 0, 1e-6);
});

test('Ladder: selo, TON e reset', () => {
  const rt = PLC.createRuntime();
  const prog = [
    { cells: [{ contacts: [{ type: 'NO', tag: 'Liga' }, { type: 'NO', tag: 'M' }] }, { contacts: [{ type: 'NC', tag: 'Desl' }] }], out: { type: 'coil', tag: 'M' } },
    { cells: [{ contacts: [{ type: 'NO', tag: 'M' }] }], out: { type: 'ton', tag: 'T1', preset: 100 } }
  ];
  PLC.scan(prog, rt, 10); assert.strictEqual(!!rt.tags.M, false);
  rt.tags.Liga = true; PLC.scan(prog, rt, 10); assert.strictEqual(rt.tags.M, true);
  rt.tags.Liga = false; PLC.scan(prog, rt, 10); assert.strictEqual(rt.tags.M, true, 'selo mantém');
  for (let i = 0; i < 12; i++) PLC.scan(prog, rt, 10);
  assert.strictEqual(rt.tags['T1.DN'], true, 'TON concluiu após 100 ms');
  rt.tags.Desl = true; PLC.scan(prog, rt, 10);
  assert.strictEqual(rt.tags.M, false); assert.strictEqual(rt.tags['T1.DN'], false);
});

test('Ladder: set/reset e TOF', () => {
  const rt = PLC.createRuntime();
  const prog = [
    { cells: [{ contacts: [{ type: 'NO', tag: 'a' }] }], out: { type: 'set', tag: 'q' } },
    { cells: [{ contacts: [{ type: 'NO', tag: 'b' }] }], out: { type: 'reset', tag: 'q' } },
    { cells: [{ contacts: [{ type: 'NO', tag: 'a' }] }], out: { type: 'tof', tag: 'F', preset: 50 } }
  ];
  rt.tags.a = true; PLC.scan(prog, rt, 10); assert.strictEqual(rt.tags.q, true); assert.strictEqual(rt.tags['F.DN'], true);
  rt.tags.a = false; PLC.scan(prog, rt, 10); assert.strictEqual(rt.tags.q, true, 'set retém'); assert.strictEqual(rt.tags['F.DN'], true);
  for (let i = 0; i < 6; i++) PLC.scan(prog, rt, 10);
  assert.strictEqual(rt.tags['F.DN'], false, 'TOF desligou após 50 ms');
  rt.tags.b = true; PLC.scan(prog, rt, 10); assert.strictEqual(rt.tags.q, false);
});

test('validação de tags', () => {
  assert.strictEqual(PLC.tagError('%I0.0'), '');
  assert.strictEqual(PLC.tagError('T1.DN'), '');
  assert.notStrictEqual(PLC.tagError('%X1'), '');
  assert.notStrictEqual(PLC.outTagError('coil', '%I0.0'), '');
  assert.strictEqual(PLC.outTagError('ton', 'T1'), '');
  assert.notStrictEqual(PLC.outTagError('ton', '%M0.0'), '');
});

function exampleWorld() {
  const w = Engine.createWorld();
  Engine.loadExample(w);
  return w;
}
const byType = (w, t) => w.parts.find(p => p.type === t);

test('exemplo: o CLP está ligado e energizado (24 V entre L+ e M)', () => {
  const w = exampleWorld();
  Engine.start(w);
  near(byType(w, 'plc_cpu').simVoltage, 24, 1e-3);
  assert.strictEqual(w.plcPowered, true);
});

test('exemplo completo: partida com selo, motor via contato K1 e lâmpada após 3 s', () => {
  const w = exampleWorld();
  Engine.start(w);
  const s1 = byType(w, 'push_no'), s0 = byType(w, 'push_nc');
  const motor = byType(w, 'motor_load'), lamp = byType(w, 'lamp');
  const run = ms => { for (let t = 0; t < ms; t += 20) Engine.step(w, 20); };

  run(100);
  assert.strictEqual(w.rt.tags['%I0.0'], true, 'S0 (NF) em repouso = 24 V na entrada');
  assert.strictEqual(w.rt.tags['%I0.1'], false);
  assert.strictEqual(!!w.rt.tags['%Q0.0'], false, 'motor desligado');
  near(motor.simVoltage, 0, 0.01);

  s1.closed = true; run(60); s1.closed = false; run(100);
  assert.strictEqual(w.rt.tags['%Q0.0'], true, 'selo manteve a saída após soltar S1');
  near(motor.simVoltage, 24, 0.01, 'motor com 24 V');
  assert.ok(byType(w, 'relay_no').closed, 'contato K1 fechado');
  near(byType(w, 'relay_coil').simVoltage, 24, 0.01, 'K1 com 24 V');
  assert.strictEqual(!!w.rt.tags['%Q0.1'], false, 'H1 ainda apagada');
  near(lamp.simVoltage, 0, 0.01);

  run(3200);
  assert.strictEqual(w.rt.tags['T1.DN'], true, 'TON concluído');
  assert.strictEqual(w.rt.tags['%Q0.1'], true);
  near(lamp.simVoltage, 24, 0.01, 'H1 com 24 V');

  s0.closed = false; run(100); s0.closed = true; run(100);
  assert.strictEqual(w.rt.tags['%Q0.0'], false, 'S0 desligou o motor');
  near(motor.simVoltage, 0, 0.01);
  assert.strictEqual(w.rt.tags['%Q0.1'], false, 'H1 apagou');
});

test('CLP sem alimentação (fio L+ removido): nada liga, mesmo apertando S1', () => {
  const w = exampleWorld();
  const cpu = byType(w, 'plc_cpu');
  w.wires = w.wires.filter(x => !(x.a.id === cpu.id || x.b.id === cpu.id) || !(x.a.pin === 0 || x.b.pin === 0 && x.b.id === cpu.id));
  Engine.start(w);
  const s1 = byType(w, 'push_no');
  s1.closed = true;
  for (let t = 0; t < 400; t += 20) Engine.step(w, 20);
  assert.strictEqual(w.plcPowered, false);
  assert.strictEqual(!!w.rt.tags['%Q0.0'], false);
  near(byType(w, 'motor_load').simVoltage, 0, 0.01);
});

test('fios do exemplo: tensão por fio (24 V no trilho +, 0 V no trilho −) e sentido conhecido no motor', () => {
  const w = exampleWorld();
  Engine.start(w);
  const s1 = byType(w, 'push_no'); s1.closed = true;
  for (let t = 0; t < 200; t += 20) Engine.step(w, 20);
  s1.closed = false;
  for (let t = 0; t < 200; t += 20) Engine.step(w, 20);
  const top = byType(w, 'rail_pos'), bot = byType(w, 'rail_neg'), m1 = byType(w, 'motor_load');
  w.wires.forEach(x => {
    const ids = [x.a.id, x.b.id];
    if (ids.includes(top.id)) near(x.v, 24, 1e-3, 'fio no trilho +');
    if (ids.includes(bot.id)) near(x.v, 0, 1e-3, 'fio no trilho −');
  });
  const wm = w.wires.find(x => x.a.id === m1.id || x.b.id === m1.id);
  assert.notStrictEqual(wm.flow, 0, 'sentido da corrente conhecido no fio do motor');
});

test('geometria: todo fio do exemplo é ortogonal e termina exatamente nos pinos', () => {
  const w = exampleWorld();
  w.wires.forEach((x, i) => {
    const pts = Geometry.wireRoute(w, x);
    assert.ok(pts && pts.length >= 2, 'rota ' + i);
    for (let k = 0; k < pts.length - 1; k++) {
      const dx = Math.abs(pts[k].x - pts[k + 1].x), dy = Math.abs(pts[k].y - pts[k + 1].y);
      assert.ok(dx < 1e-6 || dy < 1e-6, `segmento diagonal no fio ${i}`);
    }
    const pa = Geometry.pinWorld(w.parts.find(p => p.id === x.a.id), x.a.pin);
    const pb = Geometry.pinWorld(w.parts.find(p => p.id === x.b.id), x.b.pin);
    near(pts[0].x, pa.x, 1e-6); near(pts[0].y, pa.y, 1e-6);
    near(pts[pts.length - 1].x, pb.x, 1e-6); near(pts[pts.length - 1].y, pb.y, 1e-6);
  });
});

test('geometria: as colunas do exemplo ficam retas (fio vertical sem desvio)', () => {
  const w = exampleWorld();
  w.wires.forEach((x, i) => {
    const pts = Geometry.wireRoute(w, x);
    assert.strictEqual(pts.length, 2, `fio ${i} deveria ser um segmento reto`);
  });
});

// Um segmento horizontal/vertical entra no retângulo (encolhido de m) se as caixas se sobrepõem.
function segHitsRect(a, b, r, m) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return x1 > r.x0 + m && x0 < r.x1 - m && y1 > r.y0 + m && y0 < r.y1 - m;
}
const isRailType = p => p.type === 'rail_pos' || p.type === 'rail_neg';

test('exemplo: nenhum fio atravessa o corpo de um componente que não é seu', () => {
  const w = exampleWorld();
  w.wires.forEach((x, i) => {
    const pts = Geometry.wireRoute(w, x);
    for (let k = 0; k < pts.length - 1; k++) {
      w.parts.filter(p => !isRailType(p) && p.id !== x.a.id && p.id !== x.b.id).forEach(p => {
        assert.ok(!segHitsRect(pts[k], pts[k + 1], Geometry.partBounds(p), 2), `fio ${i} atravessa ${p.name}`);
      });
    }
  });
});

test('exemplo: linhas lógicas do CLP são ortogonais, terminam na linha da tag e não atravessam componentes', () => {
  const w = exampleWorld();
  const rows = Geometry.cpuRows(w), cpu = byType(w, 'plc_cpu');
  assert.deepStrictEqual(rows.ins, ['%I0.0', '%I0.1']);
  assert.deepStrictEqual(rows.outs, ['%Q0.0', '%Q0.1']);
  const mods = w.parts.filter(p => p.type === 'plc_input' || p.type === 'plc_output');
  assert.strictEqual(mods.length, 4);
  mods.forEach(m => {
    const pts = Geometry.logicLink(w, m, rows), isIn = m.type === 'plc_input';
    assert.ok(pts && pts.length >= 2, 'sem ligação para ' + m.tag);
    const a = Geometry.cpuAnchor(cpu, isIn ? 'in' : 'out', (isIn ? rows.ins : rows.outs).indexOf(m.tag));
    near(pts[pts.length - 1].x, a.x, 1e-6); near(pts[pts.length - 1].y, a.y, 1e-6);
    for (let k = 0; k < pts.length - 1; k++) {
      assert.ok(Math.abs(pts[k].x - pts[k + 1].x) < 1e-6 || Math.abs(pts[k].y - pts[k + 1].y) < 1e-6, 'diagonal em ' + m.tag);
      w.parts.filter(p => p !== m && p !== cpu && !isRailType(p)).forEach(p => {
        assert.ok(!segHitsRect(pts[k], pts[k + 1], Geometry.partBounds(p), 2), `${m.tag} atravessa ${p.name}`);
      });
    }
  });
});

test('exemplo: cada componente (menos os trilhos) fica dentro de uma seção e as seções não se sobrepõem', () => {
  const w = exampleWorld();
  w.parts.filter(p => !isRailType(p)).forEach(p => {
    const b = Geometry.partBounds(p);
    const inside = w.zones.filter(z => b.x0 >= z.x && b.x1 <= z.x + z.w && b.y0 >= z.y && b.y1 <= z.y + z.h);
    assert.strictEqual(inside.length, 1, p.name + ' deveria estar em exatamente uma seção');
  });
  for (let i = 0; i < w.zones.length; i++) for (let j = i + 1; j < w.zones.length; j++) {
    const a = w.zones[i], b = w.zones[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `seções ${a.label} e ${b.label} se sobrepõem`);
  }
});

test('geometria: roteamento com cotovelo e orientações mistas continua ortogonal', () => {
  const cases = [
    [{ x: 0, y: 0, dx: 1, dy: 0 }, { x: 100, y: 60, dx: -1, dy: 0 }],
    [{ x: 0, y: 0, dx: 1, dy: 0 }, { x: -50, y: 60, dx: 1, dy: 0 }],
    [{ x: 0, y: 0, dx: 0, dy: 1 }, { x: 80, y: 100, dx: 0, dy: -1 }],
    [{ x: 0, y: 0, dx: 0, dy: 1 }, { x: 80, y: 100, dx: -1, dy: 0 }],
    [{ x: 0, y: 0, dx: 1, dy: 0 }, { x: 0, y: -40, dx: 0, dy: 1 }]
  ];
  cases.forEach((c, i) => {
    const pts = Geometry.route(c[0], c[1]);
    for (let k = 0; k < pts.length - 1; k++) {
      assert.ok(Math.abs(pts[k].x - pts[k + 1].x) < 1e-6 || Math.abs(pts[k].y - pts[k + 1].y) < 1e-6, `caso ${i}`);
    }
    near(pts[0].x, c[0].x, 1e-6); near(pts[pts.length - 1].y, c[1].y, 1e-6);
  });
});

test('geometria: pinos giram com o componente e clique nos trilhos acha o pino certo', () => {
  const w = Engine.createWorld();
  const part = Engine.makePart(w, 'lamp', 100, 100, { rotation: 90 });
  const a = Geometry.pinWorld(part, 0), b = Geometry.pinWorld(part, 1);
  near(a.x, 100, 1e-6); near(a.y, 62, 1e-6); near(b.y, 138, 1e-6);
  assert.strictEqual(a.dy, -1); assert.strictEqual(b.dy, 1);
  const rail = Engine.makePart(w, 'rail_pos', 480, 80, { rotation: 90, len: 44 });
  const hit = Geometry.nearestPin(w, 300, 84, 11);
  assert.strictEqual(hit.id, rail.id);
  near(Geometry.pinWorld(rail, hit.pin).x, 300, 1e-6);
});

test('serialize/loadProject: ida e volta preserva circuito, trilhos, seções e programa', () => {
  const w = exampleWorld();
  const json = JSON.parse(JSON.stringify(Engine.serialize(w)));
  const w2 = Engine.createWorld();
  const warnings = Engine.loadProject(w2, json);
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(w2.parts.length, w.parts.length);
  assert.strictEqual(w2.wires.length, w.wires.length);
  assert.strictEqual(w2.zones.length, 6);
  assert.deepStrictEqual(w2.program, w.program);
  assert.strictEqual(w2.nextId, w.nextId);
  assert.strictEqual(byType(w2, 'rail_pos').len, 52);
  Engine.start(w2); Engine.step(w2, 20);
  assert.throws(() => Engine.loadProject(w2, { parts: [{ type: 'resistor' }], wires: [] }), /desconhecido/);
  assert.throws(() => Engine.loadProject(w2, null), /inválido/);
});

test('projeto antigo (sem schema) com módulo de saída gera aviso', () => {
  const w = Engine.createWorld();
  const warnings = Engine.loadProject(w, { parts: [{ id: 1, type: 'plc_output', x: 0, y: 0, tag: '%Q0.0' }], wires: [] });
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /contato/);
});

test('trilho: comprimento inválido é corrigido ao abrir arquivo (par, entre 2 e 80)', () => {
  const w = Engine.createWorld();
  Engine.loadProject(w, { schema: 2, parts: [{ id: 1, type: 'rail_pos', len: 7 }, { id: 2, type: 'rail_neg', len: 500 }, { id: 3, type: 'rail_pos', len: -3 }], wires: [{ a: { id: 1, pin: 99 }, b: { id: 2, pin: 0 } }] });
  assert.deepStrictEqual(w.parts.map(p => p.len), [8, 80, 2]);
  assert.strictEqual(w.wires.length, 0, 'fio com pino inexistente é descartado');
});

// ===================== Planta didática: tanque =====================
function tankWorld() { const w = Engine.createWorld(); Engine.loadTankExample(w); return w; }
const named = (w, nm) => w.parts.find(p => p.name === nm);

test('planta: bomba energizada enche (5 %/s), válvula aberta esvazia (7 %/s) e o nível fica entre 0 e 100', () => {
  const w = Engine.createWorld();
  const src = Engine.makePart(w, 'source', 0, 0, { value: 24 });
  const pump = Engine.makePart(w, 'pump', 0, 0), valve = Engine.makePart(w, 'valve', 0, 0), g = Engine.makePart(w, 'ground', 0, 0);
  W(w, src, 1, pump, 0); W(w, pump, 1, g, 0); W(w, src, 1, valve, 0); W(w, valve, 1, g, 0); W(w, src, 0, g, 0);
  const wire = (p, on) => { w.wires = w.wires.filter(x => !(x.a.id === p.id && x.b.id === g.id)); if (on) W(w, p, 1, g, 0); };   // liga/desliga o retorno ao 0 V
  Engine.start(w);
  near(w.plant.level, 10, 1e-9, 'nível inicial');
  wire(valve, false);                                   // só a bomba
  for (let i = 0; i < 50; i++) Engine.step(w, 20);      // 1 s
  near(w.plant.level, 15, 0.2, 'subiu 5% em 1 s');
  assert.strictEqual(w.plant.pumping, true);
  wire(valve, true);                                    // bomba + válvula: líquido −2 %/s
  for (let i = 0; i < 50; i++) Engine.step(w, 20);
  near(w.plant.level, 13, 0.3, 'saldo −2 %/s');
  wire(pump, false);                                    // só a válvula
  for (let i = 0; i < 1000; i++) Engine.step(w, 20);    // 20 s: esvazia e para em 0
  assert.strictEqual(w.plant.level, 0, 'não passa de 0');
  assert.strictEqual(w.plant.draining, false, 'sem nível, o dreno não corre');
  wire(pump, true); wire(valve, false);
  for (let i = 0; i < 2500; i++) Engine.step(w, 20);    // 50 s: enche e para em 100
  assert.strictEqual(w.plant.level, 100, 'não passa de 100');
  assert.strictEqual(w.plant.overflow, true);
});

test('planta: sensor de nível é contato NA que fecha quando o nível chega ao valor configurado', () => {
  const w = Engine.createWorld();
  const b = Engine.makePart(w, 'level_sw', 0, 0, { value: 30 });
  w.plant.level = 29.9; Engine.updateSensors(w); assert.strictEqual(b.closed, false);
  w.plant.level = 30; Engine.updateSensors(w); assert.strictEqual(b.closed, true);
  w.plant.level = 12; Engine.updateSensors(w); assert.strictEqual(b.closed, false, 'abre de novo quando o nível cai');
});

test('tanque: o exemplo começa com nível 10%, sensores abertos, CLP alimentado e nada ligado', () => {
  const w = tankWorld();
  Engine.start(w);
  near(w.plant.level, 10, 1e-9);
  assert.strictEqual(named(w, 'B1 Baixo').closed, false);
  assert.strictEqual(named(w, 'B2 Alto').closed, false);
  assert.strictEqual(w.plcPowered, true);
  for (let i = 0; i < 10; i++) Engine.step(w, 20);
  assert.strictEqual(!!w.rt.tags['%Q0.0'], false, 'bomba desligada até apertar S1');
  assert.strictEqual(w.rt.tags['%I0.0'], true, 'S0 (NF) em repouso');
  near(named(w, 'Bomba P1').simVoltage, 0, 0.01);
});

test('tanque: liga, histerese B1/B2, dreno manual, alarme de falha de bomba e reconhecimento', () => {
  const w = tankWorld();
  Engine.start(w);
  const s1 = named(w, 'S1 Liga'), s2 = named(w, 'S2 Dreno'), pump = named(w, 'Bomba P1'), lamp = named(w, 'H1 Alarme');
  const run = ms => { for (let t = 0; t < ms; t += 20) Engine.step(w, 20); };
  const tag = t => !!w.rt.tags[t];

  s1.closed = true; run(60); s1.closed = false; run(40);
  assert.strictEqual(tag('%M0.0'), true, 'automático com selo');
  assert.strictEqual(tag('%Q0.0'), true, 'bomba comandada (nível abaixo de B1)');
  near(pump.simVoltage, 24, 0.01, 'bomba com 24 V via contato K1');
  run(1000);
  assert.ok(w.plant.level > 14 && w.plant.level < 17, 'subindo ~5 %/s, nível ' + w.plant.level);

  run(2000);                                              // passou de B1 (20%): a bomba continua (selo)
  assert.strictEqual(named(w, 'B1 Baixo').closed, true);
  assert.strictEqual(tag('%Q0.0'), true, 'mantém a bomba entre B1 e B2');
  assert.strictEqual(tag('%M0.1'), false, 'sem alarme: o nível chegou em B1 a tempo');

  run(12000);                                             // chega em B2 (80%) e desliga
  assert.strictEqual(tag('%Q0.0'), false, 'bomba desligou em B2');
  assert.ok(w.plant.level >= 79.9 && w.plant.level < 81, 'nível parou em ~80%: ' + w.plant.level);
  near(pump.simVoltage, 0, 0.01);

  s2.closed = true; run(5000);                            // consumo: 80 → ~45%
  assert.strictEqual(tag('%Q0.0'), false, 'histerese: entre B1 e B2 a bomba continua parada');
  assert.ok(w.plant.level > 40 && w.plant.level < 50, 'nível ' + w.plant.level);
  run(5000);                                              // passa de B1 para baixo: a bomba volta
  assert.strictEqual(tag('%Q0.0'), true, 'abaixo de B1 a bomba religa');
  assert.ok(w.plant.level < 20);
  assert.strictEqual(tag('%M0.1'), false, 'ainda sem alarme');

  run(7000);                                              // dreno (7 %/s) vence a bomba (5 %/s): o nível não sobe
  assert.strictEqual(tag('%M0.1'), true, 'alarme memorizado após 6 s');
  assert.strictEqual(tag('%Q0.1'), true);
  near(lamp.simVoltage, 24, 0.01, 'H1 acesa');
  assert.strictEqual(tag('%Q0.0'), false, 'alarme bloqueia a bomba');
  near(pump.simVoltage, 0, 0.01);

  s2.closed = false; run(500);
  assert.strictEqual(tag('%M0.1'), true, 'o alarme fica memorizado');
  s1.closed = true; run(60); s1.closed = false; run(100);
  assert.strictEqual(tag('%M0.1'), false, 'S1 reconhece o alarme');
  near(lamp.simVoltage, 0, 0.01);
  assert.strictEqual(tag('%Q0.0'), true, 'bomba volta a trabalhar');
  run(6000);
  assert.ok(w.plant.level > 20, 'nível voltou a subir: ' + w.plant.level);
  assert.strictEqual(tag('%M0.1'), false, 'sem novo alarme');
});

test('tanque: S0 desliga o automático e a bomba para', () => {
  const w = tankWorld();
  Engine.start(w);
  const s1 = named(w, 'S1 Liga'), s0 = named(w, 'S0 Para');
  const run = ms => { for (let t = 0; t < ms; t += 20) Engine.step(w, 20); };
  s1.closed = true; run(60); s1.closed = false; run(500);
  assert.strictEqual(w.rt.tags['%Q0.0'], true);
  s0.closed = false; run(100); s0.closed = true; run(100);
  assert.strictEqual(w.rt.tags['%M0.0'], false);
  assert.strictEqual(w.rt.tags['%Q0.0'], false);
  const lv = w.plant.level; run(1000);
  near(w.plant.level, lv, 0.01, 'nível parado sem bomba nem dreno');
});

function trafficWorld() { const w = Engine.createWorld(); Engine.loadTrafficExample(w); return w; }
function counterWorld() { const w = Engine.createWorld(); Engine.loadCounterExample(w); return w; }
function motorWorld() { const w = Engine.createWorld(); Engine.loadMotorExample(w); return w; }
[['tanque', tankWorld], ['motor', motorWorld], ['contador', counterWorld], ['semaforo', trafficWorld]].forEach(([nm, mk]) => {
test(nm + ': geometria — fios retos e ortogonais, terminam nos pinos e não atravessam componente alheio', () => {
  const w = mk();
  w.wires.forEach((x, i) => {
    const pts = Geometry.wireRoute(w, x);
    assert.strictEqual(pts.length, 2, `fio ${i} deveria ser reto`);
    const pa = Geometry.pinWorld(w.parts.find(p => p.id === x.a.id), x.a.pin), pb = Geometry.pinWorld(w.parts.find(p => p.id === x.b.id), x.b.pin);
    near(pts[0].x, pa.x, 1e-6); near(pts[0].y, pa.y, 1e-6); near(pts[1].x, pb.x, 1e-6); near(pts[1].y, pb.y, 1e-6);
    w.parts.filter(p => !isRailType(p) && p.id !== x.a.id && p.id !== x.b.id).forEach(p => {
      assert.ok(!segHitsRect(pts[0], pts[1], Geometry.partBounds(p), 2), `fio ${i} atravessa ${p.name}`);
    });
  });
});

// cruzamento próprio entre segmentos horizontais/verticais (sobreposição colinear também conta)
function segsCross(a, b, c, d) {
  const hv = (p, q) => Math.abs(p.y - q.y) < 1e-6, E = 1e-6;
  if (hv(a, b) === hv(c, d)) {
    if (hv(a, b)) return Math.abs(a.y - c.y) < E && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > E;
    return Math.abs(a.x - c.x) < E && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > E;
  }
  const [h0, h1, v0, v1] = hv(a, b) ? [a, b, c, d] : [c, d, a, b];
  return v0.x > Math.min(h0.x, h1.x) + E && v0.x < Math.max(h0.x, h1.x) - E && h0.y > Math.min(v0.y, v1.y) + E && h0.y < Math.max(v0.y, v1.y) - E;
}

test(nm + ': linhas lógicas do CLP terminam na linha da tag, não atravessam componentes nem se cruzam', () => {
  const w = mk();
  const rows = Geometry.cpuRows(w), cpu = byType(w, 'plc_cpu');
  const tagsOf = type => w.parts.filter(p => p.type === type).map(p => p.tag).sort();
  assert.deepStrictEqual(rows.ins, tagsOf('plc_input'));
  assert.deepStrictEqual(rows.outs, tagsOf('plc_output'));
  const mods = w.parts.filter(p => p.type === 'plc_input' || p.type === 'plc_output');
  assert.strictEqual(mods.length, rows.ins.length + rows.outs.length);
  const links = mods.map(m => {
    const pts = Geometry.logicLink(w, m, rows), isIn = m.type === 'plc_input';
    assert.ok(pts && pts.length >= 2, 'sem ligação para ' + m.tag);
    const a = Geometry.cpuAnchor(cpu, isIn ? 'in' : 'out', (isIn ? rows.ins : rows.outs).indexOf(m.tag));
    near(pts[pts.length - 1].x, a.x, 1e-6); near(pts[pts.length - 1].y, a.y, 1e-6);
    for (let k = 0; k < pts.length - 1; k++) {
      assert.ok(Math.abs(pts[k].x - pts[k + 1].x) < 1e-6 || Math.abs(pts[k].y - pts[k + 1].y) < 1e-6, 'diagonal em ' + m.tag);
      w.parts.filter(p => p !== m && p !== cpu && !isRailType(p)).forEach(p => {
        assert.ok(!segHitsRect(pts[k], pts[k + 1], Geometry.partBounds(p), 2), `${m.tag} atravessa ${p.name}`);
      });
    }
    return { tag: m.tag, pts };
  });
  for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
    const A = links[i].pts, B = links[j].pts;
    for (let p = 0; p < A.length - 1; p++) for (let q = 0; q < B.length - 1; q++) {
      assert.ok(!segsCross(A[p], A[p + 1], B[q], B[q + 1]), `linhas ${links[i].tag} e ${links[j].tag} se cruzam`);
    }
  }
});

test(nm + ': cada componente (menos os trilhos) fica em exatamente uma seção, seções não se sobrepõem', () => {
  const w = mk();
  w.parts.filter(p => !isRailType(p)).forEach(p => {
    const b = Geometry.partBounds(p);
    const inside = w.zones.filter(z => b.x0 >= z.x && b.x1 <= z.x + z.w && b.y0 >= z.y && b.y1 <= z.y + z.h);
    assert.strictEqual(inside.length, 1, p.name + ' deveria estar em exatamente uma seção');
  });
  for (let i = 0; i < w.zones.length; i++) for (let j = i + 1; j < w.zones.length; j++) {
    const a = w.zones[i], b = w.zones[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `seções ${a.label} e ${b.label} se sobrepõem`);
  }
});

test(nm + ': nomes e rótulos das colunas cabem sem invadir a coluna vizinha (≈7 px por letra)', () => {
  const w = mk();
  const cols = w.parts.filter(p => !isRailType(p) && p.type !== 'plc_cpu' && p.type !== 'source' && !['plc_input', 'plc_output', 'relay_coil'].includes(p.type) && p.name && p.rotation === 90);   // esses três já trazem o nome dentro do símbolo
  cols.forEach(p => {
    const end = p.x + 32 + p.name.length * 7;
    w.parts.filter(q => q !== p && !isRailType(q) && q.type !== 'plc_cpu' && Math.abs(q.y - p.y) < 40).forEach(q => {
      const qb = Geometry.partBounds(q);
      if (qb.x0 > p.x) assert.ok(end < qb.x0 + 6, `rótulo de ${p.name} invade ${q.name}`);
    });
  });
});

});

test('tanque: ida e volta do arquivo preserva sensores, planta e programa; planta inválida é corrigida', () => {
  const w = tankWorld();
  w.plant.fillRate = 8; w.plant.initial = 30;
  const json = JSON.parse(JSON.stringify(Engine.serialize(w)));
  const w2 = Engine.createWorld();
  assert.deepStrictEqual(Engine.loadProject(w2, json), []);
  assert.deepStrictEqual(w2.program, w.program);
  assert.strictEqual(w2.parts.filter(p => p.type === 'level_sw').length, 2);
  assert.deepStrictEqual(w2.parts.filter(p => p.type === 'level_sw').map(p => p.value), [20, 80]);
  assert.strictEqual(w2.plant.fillRate, 8); assert.strictEqual(w2.plant.initial, 30); assert.strictEqual(w2.plant.level, 30);
  assert.strictEqual(named(w2, 'B1 Baixo').closed, true, 'sensor B1 já fechado com nível inicial 30%');
  const w3 = Engine.createWorld();
  Engine.loadProject(w3, { schema: 2, parts: [], wires: [], plant: { initial: 500, fillRate: -4, drainRate: 'x' } });
  assert.strictEqual(w3.plant.initial, 100); assert.strictEqual(w3.plant.fillRate, 0); assert.strictEqual(w3.plant.drainRate, 7);
  const w4 = Engine.createWorld();
  Engine.loadProject(w4, { schema: 2, parts: [], wires: [] });
  assert.strictEqual(w4.plant.initial, 10, 'projeto sem planta usa o padrão');
});

test('Parar volta o tanque ao nível inicial e abre os sensores', () => {
  const w = tankWorld();
  Engine.start(w);
  const s1 = named(w, 'S1 Liga');
  s1.closed = true; for (let t = 0; t < 8000; t += 20) Engine.step(w, 20);
  assert.ok(w.plant.level > 30);
  Engine.stop(w);
  near(w.plant.level, 10, 1e-9); assert.strictEqual(named(w, 'B1 Baixo').closed, false);
  assert.strictEqual(w.plant.pumping, false);
});

test('motor: partida com selo, térmico e emergência derrubam, falha memorizada e reconhecimento com S1', () => {
  const w = motorWorld(); Engine.start(w);
  const run = ms => { for (let t = 0; t < ms; t += 20) Engine.step(w, 20); };
  const s0 = named(w, 'S0 Para'), s1 = named(w, 'S1 Liga'), f1 = named(w, 'F1 Térm.'), e0 = named(w, 'E0 Emerg.'), m1 = named(w, 'Motor M1'), h1 = named(w, 'H1 Falha');
  const on = p => Math.abs(p.simVoltage) > 12;
  run(200); assert.ok(!on(m1) && !on(h1), 'tudo desligado no início');
  s1.closed = true; run(200); s1.closed = false; run(200);
  assert.ok(on(m1), 'motor liga e fica selado'); assert.strictEqual(w.rt.tags['%Q0.0'], true);
  s0.closed = false; run(100); s0.closed = true; run(100); assert.ok(!on(m1), 'S0 para o motor');
  s1.closed = true; run(100); s1.closed = false; run(100); assert.ok(on(m1));
  f1.closed = false; run(100);
  assert.ok(!on(m1), 'térmico derruba o motor'); assert.ok(on(h1), 'H1 acende (falha memorizada)');
  f1.closed = true; run(200); assert.ok(!on(m1) && on(h1), 'rearmar F1 não religa nem apaga a falha');
  s1.closed = true; run(100); s1.closed = false; run(200);
  assert.ok(!on(h1), 'S1 reconhece a falha'); 
  s1.closed = true; run(100); s1.closed = false; run(100); assert.ok(on(m1), 'e agora o motor parte de novo');
  e0.closed = false; run(100); assert.ok(!on(m1) && on(h1), 'emergência derruba e sinaliza');
  e0.closed = true; run(100); assert.ok(!on(m1), 'rearmar a emergência não religa sozinho');
});

test('contador CTU: conta na borda de subida, DN ao atingir, CTR zera e Parar reinicia', () => {
  const rt = PLC.createRuntime(), prog = PLC.sanitizeProgram([
    { cells: [{ contacts: [{ type: 'NO', tag: 'P' }] }], out: { type: 'ctu', tag: 'C1', preset: 3 } },
    { cells: [{ contacts: [{ type: 'NO', tag: 'Z' }] }], out: { type: 'ctr', tag: 'C1' } }]);
  const sc = () => PLC.scan(prog, rt, 20);
  rt.tags.P = true; sc(); sc(); sc(); assert.strictEqual(rt.tags['C1.ACC'], 1, 'nível alto contínuo conta uma vez');
  rt.tags.P = false; sc(); rt.tags.P = true; sc(); assert.strictEqual(rt.tags['C1.ACC'], 2); assert.strictEqual(rt.tags['C1.DN'], false);
  rt.tags.P = false; sc(); rt.tags.P = true; sc(); assert.strictEqual(rt.tags['C1.ACC'], 3); assert.strictEqual(rt.tags['C1.DN'], true);
  rt.tags.Z = true; sc(); assert.strictEqual(rt.tags['C1.ACC'], 0); assert.strictEqual(rt.tags['C1.DN'], false);
  assert.strictEqual(PLC.outTagError('ctu', '%Q0.0') !== '', true); assert.strictEqual(PLC.outTagError('ctr', 'C1'), '');
  assert.strictEqual(PLC.sanitizeProgram([{ out: { type: 'ctu', tag: 'C2', preset: 4 } }])[0].out.type, 'ctu');
});

test('contagem de peças: 5 peças completam o lote, param a esteira, S1 zera e religa', () => {
  const w = counterWorld(); Engine.start(w);
  const run = ms => { for (let t = 0; t < ms; t += 20) Engine.step(w, 20); };
  const s1 = named(w, 'S1 Liga'), b3 = named(w, 'B3 Peça'), belt = named(w, 'Esteira'), h1 = named(w, 'H1 Lote');
  const on = p => Math.abs(p.simVoltage) > 12;
  const piece = () => { b3.closed = true; run(100); b3.closed = false; run(100); };
  piece(); assert.strictEqual(w.rt.tags['C1.ACC'], 0, 'esteira parada não conta');
  s1.closed = true; run(100); s1.closed = false; run(100); assert.ok(on(belt));
  for (let i = 0; i < 3; i++) piece();
  assert.strictEqual(w.rt.tags['C1.ACC'], 3); assert.ok(on(belt) && !on(h1), 'com 3 peças ainda não avisa');
  piece(); assert.strictEqual(w.rt.tags['C1.ACC'], 4); assert.ok(on(belt) && on(h1), 'a partir de 4 peças a comparação acende H1');
  piece(); run(100);
  assert.strictEqual(w.rt.tags['C1.DN'], true); assert.ok(!on(belt), 'lote completo para a esteira'); assert.ok(on(h1));
  s1.closed = true; run(100); s1.closed = false; run(100);
  assert.strictEqual(w.rt.tags['C1.ACC'], 0); assert.ok(!on(h1), 'S1 limpa o lote'); 
});

function loadRender() {
  const vm = require('vm'), fs = require('fs'), ctx = { Geometry: require('../js/geometry.js'), Engine, Solver, console };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../js/render.js'), 'utf8') + ';globalThis.Render = Render;', ctx);
  return ctx.Render;
}
test('numeração de fios: um número por rede (sem trilhos) e referências cruzadas bobina ↔ contato', () => {
  const Render = loadRender(), w = tankWorld(), G = require('../js/geometry.js');
  const nets = Solver.analyzeNets(w.parts, w.wires), routes = w.wires.map(x => G.wireRoute(w, x));
  const nums = Render.wireNumbers({ world: w, nets, routes });
  assert.ok(nums.length >= 8, 'o tanque tem pelo menos 8 redes fora dos trilhos');
  assert.deepStrictEqual(nums.map(x => x.num), nums.map((_, i) => i + 1));
  for (let i = 1; i < nums.length; i++) assert.ok(nums[i].minX >= nums[i - 1].minX, 'numeração da esquerda para a direita');
  assert.strictEqual(new Set(nums.map(x => x.net)).size, nums.length, 'redes distintas');
  assert.strictEqual(Render.crossRef(w, named(w, 'K1')), '→ Bomba');
  assert.ok(Render.crossRef(w, named(w, 'K1 (NA)')).startsWith('← Comando'));
  assert.strictEqual(Render.crossRef(w, named(w, 'Bomba P1')), '');
  const orphan = Engine.makePart(w, 'relay_no', 0, 0, { ref: 'K9', name: 'K9 (NA)' });
  assert.strictEqual(Render.crossRef(w, orphan), '⚠ sem bobina');
});

test('comparador e CTD: operadores, operando por tag, regressivo e CTR, saneamento', () => {
  const rt = PLC.createRuntime(), prog = PLC.sanitizeProgram([
    { cells: [{ contacts: [{ type: 'NO', tag: 'P' }] }], out: { type: 'ctd', tag: 'D1', preset: 3 } },
    { cells: [{ contacts: [{ type: 'NO', tag: 'Z' }] }], out: { type: 'ctr', tag: 'D1' } },
    { cells: [{ contacts: [{ type: 'CMP', tag: 'D1.ACC', op: '<=', value: 1 }] }], out: { type: 'coil', tag: 'LOW' } },
    { cells: [{ contacts: [{ type: 'CMP', tag: 'D1.ACC', op: '==', value: 'LIM' }] }], out: { type: 'coil', tag: 'EQ' } },
    { cells: [{ contacts: [{ type: 'CMP', tag: 'D1.ACC', op: '!=', value: 3 }] }], out: { type: 'coil', tag: 'NE' } }]);
  const sc = () => PLC.scan(prog, rt, 20), pulse = () => { rt.tags.P = true; sc(); rt.tags.P = false; sc(); };
  rt.tags.LIM = 2; rt.tags.P = false; sc();
  assert.strictEqual(rt.tags['D1.ACC'], 3, 'começa no valor programado'); assert.strictEqual(rt.tags['D1.DN'], false);
  assert.strictEqual(rt.tags.NE, false); assert.strictEqual(rt.tags.LOW, false);
  pulse(); assert.strictEqual(rt.tags['D1.ACC'], 2); assert.strictEqual(rt.tags.EQ, true, 'compara com tag'); assert.strictEqual(rt.tags.NE, true);
  pulse(); assert.strictEqual(rt.tags['D1.ACC'], 1); assert.strictEqual(rt.tags.LOW, true); assert.strictEqual(rt.tags.EQ, false);
  pulse(); assert.strictEqual(rt.tags['D1.ACC'], 0); assert.strictEqual(rt.tags['D1.DN'], true, 'DN em zero');
  pulse(); assert.strictEqual(rt.tags['D1.ACC'], 0, 'não fica negativo');
  rt.tags.Z = true; sc(); assert.strictEqual(rt.tags['D1.ACC'], 3, 'CTR volta ao valor inicial'); assert.strictEqual(rt.tags['D1.DN'], false);
  const s = PLC.sanitizeProgram([{ cells: [{ contacts: [{ type: 'CMP', tag: 'A', op: 'xx', value: '7' }, { type: 'CMP', tag: 'A', op: '>', value: '%%' }, { type: 'CMP', tag: 'A', op: '<', value: 'B.ACC' }] }], out: { type: 'ctd', tag: 'C', preset: 2 } }]);
  assert.deepStrictEqual(s[0].cells[0].contacts.map(k => [k.op, k.value]), [['==', 7], ['>', 0], ['<', 'B.ACC']]);
  assert.strictEqual(s[0].out.type, 'ctd');
  const w = Engine.createWorld(); Engine.loadProject(w, JSON.parse(JSON.stringify({ schema: 2, parts: [], wires: [], program: s })));
  assert.deepStrictEqual(Engine.serialize(w).program[0].cells[0].contacts[2], { type: 'CMP', tag: 'A', op: '<', value: 'B.ACC' });
});

test('semáforo: ciclo de 12 s (verde 0–5, amarelo 5–7, vermelho 7–12), reinicia e S0 apaga tudo', () => {
  const w = trafficWorld(); Engine.start(w);
  const run = ms => { for (let t = 0; t < ms; t += 20) Engine.step(w, 20); };
  const lamp = c => w.parts.find(p => p.type === 'lamp' && p.color === c), on = c => Math.abs(lamp(c).simVoltage) > 12;
  const state = () => ['green', 'yellow', 'red'].filter(on).join(',') || 'apagado';
  assert.strictEqual(Engine.plantKind(w), 'traffic');
  run(500); assert.strictEqual(state(), 'apagado', 'parado até apertar S1');
  const s1 = named(w, 'S1 Liga'), s0 = named(w, 'S0 Para');
  s1.closed = true; run(100); s1.closed = false;
  run(2000); assert.strictEqual(state(), 'green');
  run(3500); assert.strictEqual(state(), 'yellow', 'por volta de 5,7 s');
  run(2000); assert.strictEqual(state(), 'red', 'por volta de 7,7 s');
  run(4600); assert.strictEqual(state(), 'green', 'ciclo reiniciou (~12,3 s)');
  s0.closed = false; run(100); s0.closed = true; run(100);
  assert.strictEqual(state(), 'apagado', 'S0 desliga o ciclo'); assert.strictEqual(w.rt.tags['%M0.0'], false);
});

test('cor do sinaleiro: ida e volta, valor inválido ignorado e tipo de planta', () => {
  const w = trafficWorld(), w2 = Engine.createWorld();
  Engine.loadProject(w2, JSON.parse(JSON.stringify(Engine.serialize(w))));
  assert.deepStrictEqual(w2.parts.filter(p => p.type === 'lamp').map(p => p.color), ['green', 'yellow', 'red']);
  assert.strictEqual(Engine.plantKind(w2), 'traffic'); assert.strictEqual(Engine.hasPlantParts(w2), true);
  const bad = Engine.serialize(w); bad.parts.forEach(p => { if (p.type === 'lamp') p.color = 'roxo'; });
  const w3 = Engine.createWorld(); Engine.loadProject(w3, bad);
  assert.ok(w3.parts.filter(p => p.type === 'lamp').every(p => p.color === '')); assert.strictEqual(Engine.plantKind(w3), null);
  assert.strictEqual(Engine.plantKind(tankWorld()), 'tank'); assert.strictEqual(Engine.plantKind(motorWorld()), null);
});

test('bancada virtual: mapa de E/S do programa e pisca-pisca a 1 Hz sem circuito', () => {
  const w = Engine.createWorld(); Engine.loadBenchExample(w);
  const io = PLC.ioMap(w.program);
  assert.deepStrictEqual(io.inputs, ['%I0.0', '%I0.1']);
  assert.deepStrictEqual(io.outputs, ['%Q0.0', '%Q0.1']);
  assert.deepStrictEqual(io.memory, ['%M0.0']);
  assert.deepStrictEqual(io.timers.map(t => t.name), ['T1', 'T2']);
  assert.deepStrictEqual(io.signals, ['%I0.0', '%I0.1', '%Q0.0', '%Q0.1', '%M0.0', 'T1.DN', 'T2.DN']);
  Engine.start(w, { virtual: true });
  assert.strictEqual(w.virtual, true); assert.strictEqual(w.parts.length, 0);
  const scan = n => { for (let i = 0; i < n; i++) Engine.step(w, 20); };
  scan(10); assert.strictEqual(!!w.rt.tags['%Q0.0'], false, 'desligado sem a chave');
  w.vin['%I0.0'] = true; scan(1); w.vin['%I0.0'] = false;           // pulso em %I0.0: liga e sela
  assert.strictEqual(w.rt.tags['%M0.0'], true);
  scan(23); assert.strictEqual(w.rt.tags['%Q0.0'], false, 'ainda em T1');
  scan(1); assert.strictEqual(w.rt.tags['%Q0.0'], true, 'T1 terminou (500 ms)'); assert.strictEqual(w.rt.tags['%Q0.1'], false);
  scan(24); assert.strictEqual(w.rt.tags['%Q0.0'], true);
  scan(1); assert.strictEqual(w.rt.tags['%Q0.0'], false, 'T2 terminou, reinicia'); assert.strictEqual(w.rt.tags['%Q0.1'], true, 'B é a inversa de A');
  scan(24); assert.strictEqual(w.rt.tags['%Q0.0'], false);
  scan(1); assert.strictEqual(w.rt.tags['%Q0.0'], true, 'segundo ciclo, período de 1 s');
  assert.ok(w.simMs >= 1400, 'relógio de simulação avança');
  w.vin['%I0.1'] = true; scan(2); assert.strictEqual(w.rt.tags['%M0.0'], false, 'desliga'); assert.strictEqual(!!w.rt.tags['%Q0.0'], false);
  Engine.stop(w); assert.strictEqual(w.virtual, false); assert.deepStrictEqual(w.vin, {});
});

test('ioMap: nomes livres sem escrita são entradas; membros de temporizador e contador não; CMP ignorado', () => {
  const p = PLC.sanitizeProgram([
    { cells: [{ contacts: [{ type: 'NO', tag: 'Liga' }, { type: 'NO', tag: 'Z' }] }, { contacts: [{ type: 'NC', tag: 'T1.DN' }, { type: 'CMP', tag: 'C1.ACC', op: '>', value: 1 }] }], out: { type: 'coil', tag: 'Motor' } },
    { cells: [{ contacts: [{ type: 'NO', tag: 'Motor' }] }], out: { type: 'ton', tag: 'T1', preset: 100 } },
    { cells: [{ contacts: [{ type: 'NO', tag: '%I0.2' }] }], out: { type: 'ctu', tag: 'C1', preset: 3 } },
    { cells: [{ contacts: [{ type: 'NO', tag: 'T1' }] }], out: { type: 'set', tag: '%Q0.5' } }]);
  const io = PLC.ioMap(p);
  assert.deepStrictEqual(io.inputs, ['%I0.2', 'Liga', 'Z'], 'só %I e nomes livres que ninguém escreve, %I primeiro');
  assert.ok(!io.inputs.includes('T1.DN') && !io.inputs.includes('C1.ACC') && !io.inputs.includes('T1') && !io.inputs.includes('Motor'), 'membros, temporizador e saídas internas não são entradas');
  assert.deepStrictEqual(io.outputs, ['%Q0.5']); assert.deepStrictEqual(io.memory, ['Motor']);
  assert.deepStrictEqual(io.counters.map(c => c.name), ['C1']);
});

test('contatos de borda: P e N valem uma varredura; primeira varredura sem borda; contador conta 1 por clique', () => {
  const prog = PLC.sanitizeProgram([
    { cells: [{ contacts: [{ type: 'P', tag: '%I0.0' }] }], out: { type: 'coil', tag: '%M0.0' } },
    { cells: [{ contacts: [{ type: 'N', tag: '%I0.0' }] }], out: { type: 'coil', tag: '%M0.1' } },
    { cells: [{ contacts: [{ type: 'P', tag: '%I0.0' }] }], out: { type: 'ctu', tag: 'C1', preset: 3 } }]);
  assert.strictEqual(prog[0].cells[0].contacts[0].type, 'P');
  const rt = PLC.createRuntime(); const run = v => { rt.tags['%I0.0'] = v; PLC.scan(prog, rt, 10); return [rt.tags['%M0.0'], rt.tags['%M0.1']].map(Boolean); };
  assert.deepStrictEqual(run(true), [false, false]);     // já ligada na partida: sem borda
  assert.deepStrictEqual(run(true), [false, false]);
  assert.deepStrictEqual(run(false), [false, true]);     // descida
  assert.deepStrictEqual(run(false), [false, false]);
  assert.deepStrictEqual(run(true), [true, false]);      // subida
  assert.deepStrictEqual(run(true), [false, false]);     // só uma varredura
  assert.strictEqual(rt.tags['C1.ACC'], 1);
  assert.deepStrictEqual(PLC.ioMap(prog).inputs, ['%I0.0']);
});
test('exemplo bancada2: alternador por borda e contador de cliques', () => {
  const w = Engine.createWorld(); Engine.loadEdgeExample(w); Engine.start(w, { virtual: true });
  Engine.step(w, 20);
  const click = () => { w.vin['%I0.0'] = true; Engine.step(w, 20); Engine.step(w, 20); w.vin['%I0.0'] = false; Engine.step(w, 20); };
  const q = () => [!!w.rt.tags['%Q0.0'], !!w.rt.tags['%Q0.1']];
  click(); assert.deepStrictEqual(q(), [true, false]);
  click(); assert.deepStrictEqual(q(), [false, false]);
  click(); assert.deepStrictEqual(q(), [true, true]); assert.strictEqual(w.rt.tags['C1.ACC'], 3);
  w.vin['%I0.1'] = true; Engine.step(w, 20); w.vin['%I0.1'] = false; Engine.step(w, 20);
  assert.strictEqual(w.rt.tags['C1.ACC'], 0); assert.strictEqual(!!w.rt.tags['%Q0.1'], false);
});
test('sensor de 3 fios: PNP e NPN com LED, só atua alimentado, e fluxo de corrente nos fios', () => {
  const build = (npn, powered, commonOnPlus) => {
    const w = Engine.createWorld(), mk = (t, x, y, o) => Engine.makePart(w, t, x, y, o);
    const src = mk('source', 0, 0), b = mk('sensor3', 100, 0, { npn }), inp = mk('plc_input', 200, 0, { tag: '%I0.0' });
    const wire = (a, ap, c, cp) => w.wires.push({ a: { id: a.id, pin: ap }, b: { id: c.id, pin: cp } });
    if (powered) { wire(src, 1, b, 0); wire(src, 0, b, 1); }
    wire(b, 2, inp, 0); wire(inp, 1, src, commonOnPlus ? 1 : 0);
    Engine.start(w); return { w, b };
  };
  const run = (c, act) => { c.b.closed = act; Engine.step(c.w, 20); Engine.step(c.w, 20); return [!!c.w.rt.tags['%I0.0'], !!c.b.sOut]; };
  let c = build(false, true, false);
  assert.deepStrictEqual(run(c, false), [false, false]);
  assert.deepStrictEqual(run(c, true), [true, true]);
  assert.ok(Math.abs(c.b.simVoltage - 24) < 0.1 && c.b.simCurrent > 0.009 && c.b.simCurrent < 0.011);
  c = build(true, true, true);                              // NPN: comum da entrada no +24V
  assert.deepStrictEqual(run(c, false), [false, false]);
  assert.deepStrictEqual(run(c, true), [true, true]);
  c = build(false, false, false);                           // sem alimentação: não atua
  assert.deepStrictEqual(run(c, true), [false, false]);
  c = build(true, true, false);                             // NPN com comum no 0V: não aciona a entrada
  assert.deepStrictEqual(run(c, true), [false, true]);
  const back = Engine.createWorld(); Engine.loadProject(back, JSON.parse(JSON.stringify(Engine.serialize(build(true, true, true).w))));
  const sb = back.parts.find(q => q.type === 'sensor3'); assert.strictEqual(sb.npn, true); assert.strictEqual(sb.sub, 'ind');
});
test('Emergência e térmico (NF) cortam a carga; sensor indutivo (NA) liga', () => {
  const w = Engine.createWorld();
  const top = Engine.makePart(w, 'rail_pos', 400, 80, { rotation: 90, len: 8 }), bot = Engine.makePart(w, 'rail_neg', 400, 300, { rotation: 90, len: 8 });
  const src = Engine.makePart(w, 'source', 100, 190, { rotation: 270 });
  const e = Engine.makePart(w, 'estop', 300, 150, { rotation: 90 }), f = Engine.makePart(w, 'thermal', 300, 200, { rotation: 90 });
  const b = Engine.makePart(w, 'sensor_ind', 360, 150, { rotation: 90 });
  const lamp = Engine.makePart(w, 'lamp', 300, 250, { rotation: 90 }), lamp2 = Engine.makePart(w, 'lamp', 360, 250, { rotation: 90 });
  const wr = (a, pa, c, pc) => w.wires.push({ a: { id: a.id, pin: pa }, b: { id: c.id, pin: pc } });
  wr(src, 1, top, 4); wr(src, 0, bot, 4);
  wr(top, 6, e, 0); wr(e, 1, f, 0); wr(f, 1, lamp, 0); wr(lamp, 1, bot, 6);
  wr(top, 8, b, 0); wr(b, 1, lamp2, 0); wr(lamp2, 1, bot, 8);
  Engine.start(w); Engine.step(w, 20);
  assert.ok(Math.abs(lamp.simVoltage) > 20, 'NF fechado: lâmpada acesa');
  assert.ok(Math.abs(lamp2.simVoltage) < 1, 'NA aberto: lâmpada apagada');
  e.closed = false; Engine.step(w, 20); assert.ok(Math.abs(lamp.simVoltage) < 1, 'emergência acionada corta');
  e.closed = true; f.closed = false; Engine.step(w, 20); assert.ok(Math.abs(lamp.simVoltage) < 1, 'térmico disparado corta');
  b.closed = true; Engine.step(w, 20); assert.ok(Math.abs(lamp2.simVoltage) > 20, 'sensor ativado liga');
  Engine.stop(w);
  assert.strictEqual(e.closed, true); assert.strictEqual(f.closed, true); assert.strictEqual(b.closed, false, 'Parar rearma tudo');
  assert.deepStrictEqual(Engine.LATCH_TYPES.slice().sort(), ['estop', 'sensor3', 'sensor_ind', 'thermal']);
});

test('Folha de desenho: round-trip e saneamento', () => {
  const w = Engine.createWorld(); w.sheet = { title: 'Meu diagrama', author: 'Leo', rev: 'B' };
  const w2 = Engine.createWorld(); Engine.loadProject(w2, JSON.parse(JSON.stringify(Engine.serialize(w))));
  assert.deepStrictEqual(w2.sheet, { title: 'Meu diagrama', author: 'Leo', rev: 'B' });
  const w3 = Engine.createWorld(); Engine.loadProject(w3, { schema: 2, parts: [], wires: [], sheet: { title: 5, author: 'x'.repeat(500) } });
  assert.strictEqual(w3.sheet.title, ''); assert.strictEqual(w3.sheet.author.length, 80); assert.strictEqual(w3.sheet.rev, 'A');
});

console.log(`\n${n} testes passaram.`);
