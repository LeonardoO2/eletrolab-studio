// Solver elétrico CC (Análise Nodal Modificada).
// Convenções de ligação:
//   source      : pino 0 = negativo (−), pino 1 = positivo (+)
//   plc_output  : CONTATO de saída. pino 0 = L+ (alimentação), pino 1 = saída (Q).
//                 Fecha (resistência baixa) quando a tag do CLP é verdadeira (outOn).
//   plc_input   : pino 0 = sinal (+), pino 1 = comum (0 V); simVoltage = V(pino0) − V(pino1)
//   plc_cpu     : alimentação do CLP. pino 0 = L+, pino 1 = M (0 V). Carga resistiva.
//   rail_pos / rail_neg : trilhos (barramentos). Todos os pinos de um trilho são a mesma rede.
//   ground e rail_neg   : referência de 0 V. Todos juntos formam uma única rede.
//   level_sw    : sensor de nível (boia), contato NA que o engine fecha conforme o nível do tanque.
//   pump / valve: bomba e válvula de dreno, cargas resistivas (valor em Ω).
const Solver = (function () {
  const R_OPEN = 1e9, R_CLOSED = 0.001, G_MIN = 1e-12, PIVOT_MIN = 1e-15;
  const SWITCHES = ['push_no', 'push_nc', 'relay_no', 'relay_nc', 'level_sw', 'estop', 'thermal', 'sensor_ind'];
  const NET_ONLY = ['ground', 'rail_pos', 'rail_neg']; // só definem redes, não entram na matriz
  const isRail = p => p.type === 'rail_pos' || p.type === 'rail_neg';

  function pinCount(p) {
    if (p.type === 'ground') return 1;
    if (isRail(p)) return Math.max(2, Math.round(Number(p.len) || 8)) + 1;
    return 2;
  }
  function isVSource(p) { return p.type === 'source'; }
  function resistanceOf(p) {
    if (SWITCHES.includes(p.type)) return p.closed ? R_CLOSED : R_OPEN;
    if (p.type === 'plc_output') return p.outOn ? R_CLOSED : R_OPEN;
    if (p.type === 'plc_input') return Math.max(1, Number(p.value) || 3000);
    if (p.type === 'plc_cpu') return Math.max(1, Number(p.value) || 1200);
    return Math.max(1, Number(p.value) || 100);
  }

  function gauss(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let i = 0; i < n; i++) {
      let max = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[max][i])) max = k;
      if (Math.abs(M[max][i]) < PIVOT_MIN) throw new Error('Curto-circuito ou fontes em conflito no circuito.');
      [M[i], M[max]] = [M[max], M[i]];
      const d = M[i][i];
      for (let j = i; j <= n; j++) M[i][j] /= d;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const f = M[k][i];
        if (f === 0) continue;
        for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    return M.map(row => row[n]);
  }

  // Une os pinos ligados por fios, os pinos de cada trilho e todas as referências de 0 V.
  function buildNets(parts, wires) {
    const parent = {};
    parts.forEach(p => { for (let i = 0; i < pinCount(p); i++) parent[p.id + ':' + i] = p.id + ':' + i; });
    const find = t => { while (parent[t] !== t) { parent[t] = parent[parent[t]]; t = parent[t]; } return t; };
    const union = (a, b) => { parent[find(a)] = find(b); };
    wires.forEach(w => {
      const a = w.a.id + ':' + w.a.pin, b = w.b.id + ':' + w.b.pin;
      if (a in parent && b in parent) union(a, b);
    });
    parts.filter(isRail).forEach(p => { for (let i = 1; i < pinCount(p); i++) union(p.id + ':0', p.id + ':' + i); });
    const refs = parts.filter(p => p.type === 'ground' || p.type === 'rail_neg').map(p => p.id + ':0');
    for (let i = 1; i < refs.length; i++) union(refs[0], refs[i]);
    return { parent, find, refAnchor: refs.length ? refs[0] : null };
  }

  // Redes sem resolver o circuito (para destacar no editor, mesmo parado).
  // netOf: "id:pino" -> id da rede;  role: id da rede -> 'pos' (trilho +) | 'neg' (0 V)
  function analyzeNets(parts, wires) {
    const { parent, find } = buildNets(parts, wires);
    const netOf = {}, role = {};
    Object.keys(parent).forEach(k => { netOf[k] = find(k); });
    parts.forEach(p => { if (p.type === 'rail_pos') role[netOf[p.id + ':0']] = 'pos'; });
    parts.forEach(p => { if (p.type === 'rail_neg' || p.type === 'ground') role[netOf[p.id + ':0']] = 'neg'; });
    return { netOf, role };
  }

  function solve(parts, wires) {
    const sources = parts.filter(isVSource);
    if (!sources.length) throw new Error('Adicione uma Fonte CC ao circuito.');

    const { parent, find, refAnchor } = buildNets(parts, wires);
    const ref = refAnchor ? find(refAnchor) : find(sources[0].id + ':0');
    const nets = [...new Set(Object.keys(parent).map(find))];
    const idx = {}; let nn = 0;
    nets.forEach(n => { if (n !== ref) idx[n] = nn++; });

    const vs = sources;
    const n = nn + vs.length;
    const A = Array.from({ length: n }, () => Array(n).fill(0));
    const b = Array(n).fill(0);
    const node = net => (net === ref ? -1 : idx[net]);
    const stampG = (na, nb, g) => {
      const i = node(na), j = node(nb);
      if (i >= 0) A[i][i] += g;
      if (j >= 0) A[j][j] += g;
      if (i >= 0 && j >= 0) { A[i][j] -= g; A[j][i] -= g; }
    };

    nets.forEach(net => { if (net !== ref) stampG(net, ref, G_MIN); });
    parts.forEach(p => {
      if (NET_ONLY.includes(p.type) || isVSource(p)) return;
      stampG(find(p.id + ':0'), find(p.id + ':1'), 1 / resistanceOf(p));
    });
    vs.forEach((p, k) => {
      const row = nn + k;
      const i = node(find(p.id + ':1')); // positivo
      const j = node(find(p.id + ':0')); // negativo
      if (i >= 0) { A[i][row] += 1; A[row][i] += 1; }
      if (j >= 0) { A[j][row] -= 1; A[row][j] -= 1; }
      b[row] = Number(p.value) || 0;
    });

    const x = gauss(A, b);
    const volt = net => (net === ref ? 0 : x[idx[net]]);

    const results = {};
    parts.forEach(p => {
      if (p.type === 'ground') { results[p.id] = { v: 0, i: 0 }; return; }
      if (isRail(p)) { results[p.id] = { v: volt(find(p.id + ':0')), i: 0 }; return; }
      const va = volt(find(p.id + ':0')), vb = volt(find(p.id + ':1'));
      if (isVSource(p)) results[p.id] = { v: vb - va, i: -x[nn + vs.indexOf(p)] }; // corrente entregue ao circuito
      else results[p.id] = { v: va - vb, i: (va - vb) / resistanceOf(p) };
    });

    // Tensão por pino e por rede
    const pinV = {}, netOf = {};
    Object.keys(parent).forEach(k => { netOf[k] = find(k); pinV[k] = volt(netOf[k]); });

    // Sentido da corrente em cada fio. Um fio ligado a um pino que só tem esse fio
    // carrega a corrente do componente daquele pino. Sem pino assim, o sentido é desconhecido (0).
    const byId = {}; parts.forEach(p => { byId[p.id] = p; });
    const degree = {};
    wires.forEach(w => [w.a, w.b].forEach(e => { const k = e.id + ':' + e.pin; degree[k] = (degree[k] || 0) + 1; }));
    const wireV = [], wireFlow = [];
    wires.forEach(w => {
      const ka = w.a.id + ':' + w.a.pin;
      wireV.push(ka in parent ? pinV[ka] : null);
      let best = 0, bestMag = 1e-4;
      [[w.a, -1], [w.b, 1]].forEach(([e, sgn]) => {
        const k = e.id + ':' + e.pin;
        if (degree[k] !== 1) return;
        const part = byId[e.id];
        if (!part || NET_ONLY.includes(part.type)) return;
        const i = results[part.id].i;            // fluxo interno pino 0 → pino 1
        const into = e.pin === 0 ? i : -i;       // corrente que ENTRA no componente por este pino
        const f = sgn * into;                    // sentido no fio, de a para b
        if (Math.abs(f) > bestMag) { bestMag = Math.abs(f); best = f > 0 ? 1 : -1; }
      });
      wireFlow.push(best);
    });

    const V = Math.abs(results[sources[0].id].v);
    const I = sources.reduce((s, p) => s + results[p.id].i, 0);
    return { results, pinV, netOf, wireV, wireFlow, V, I, P: V * Math.abs(I) };
  }

  const api = { solve, analyzeNets, resistanceOf, isVSource, pinCount, R_OPEN, R_CLOSED };
  return api;
})();
if (typeof module !== 'undefined') module.exports = Solver;
