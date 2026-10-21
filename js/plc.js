// Motor Ladder booleano (IEC 61131-3, simplificado).
// Um degrau = contatos em série (cada "célula" pode ter contatos em paralelo = OU) + uma saída.
//   rung = { comment, cells: [ { contacts: [ { type:'NO'|'NC', tag } ] } ], out: { type, tag, preset } }
//   contato: { type:'NO'|'NC', tag } ou comparação { type:'CMP', tag, op:'>'|'<'|'>='|'<='|'=='|'!=', value:número|tag } (compara valores numéricos, ex.: C1.ACC >= 3)
//   out.type: 'coil' (OTE), 'set', 'reset', 'ton', 'tof' (preset em ms), 'ctu' (contador crescente), 'ctd' (contador regressivo: parte do preset e desce até 0), 'ctr' (volta o contador cujo nome está em tag ao valor inicial)
// Temporizadores e contadores expõem as tags NOME.DN (feito) e NOME.ACC (acumulado: ms ou contagem).
// O contador CTU conta uma vez a cada subida do degrau (borda de subida).
const PLC = (function () {
  const OUT_TYPES = ['coil', 'set', 'reset', 'ton', 'tof', 'ctu', 'ctd', 'ctr'];
  const CMP_OPS = ['>', '<', '>=', '<=', '==', '!='];
  const RE_NUM = /^-?\d+(\.\d+)?$/;
  const RE_ADDR = /^%[IQM]\d+\.\d+$/;
  const RE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const RE_MEMBER = /^[A-Za-z_][A-Za-z0-9_]*\.(DN|ACC)$/;

  function createRuntime() { return { tags: {}, timers: {}, counters: {} }; }

  // Mensagem de erro (string) ou '' se a tag for válida para LEITURA em contato.
  function tagError(tag) {
    const t = String(tag || '').trim();
    if (RE_ADDR.test(t) || RE_NAME.test(t) || RE_MEMBER.test(t)) return '';
    return 'Tag inválida. Use %I0.0, %Q0.0, %M0.0, um nome (ex.: Liga) ou T1.DN.';
  }
  // Validação para a SAÍDA do degrau (não escreve em entradas nem em membros de timer).
  function outTagError(type, tag) {
    const t = String(tag || '').trim();
    if (type === 'ton' || type === 'tof') return RE_NAME.test(t) ? '' : 'Nome de temporizador inválido (ex.: T1).';
    if (type === 'ctu' || type === 'ctd' || type === 'ctr') return RE_NAME.test(t) ? '' : 'Nome de contador inválido (ex.: C1).';
    if (RE_ADDR.test(t)) return t.startsWith('%I') ? 'Não é possível escrever em uma entrada (%I). Use %Q ou %M.' : '';
    if (RE_NAME.test(t)) return '';
    return 'Tag de saída inválida. Use %Q0.0, %M0.0 ou um nome.';
  }

  // Operando direito da comparação: número ou nome de tag (qualquer outra coisa vira 0).
  function cmpValue(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    const t = String(v == null ? '' : v).trim();
    if (RE_NUM.test(t)) return Number(t);
    return tagError(t) === '' && t ? t : 0;
  }
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : (v === true ? 1 : 0);
  function compare(c, rt) {
    const l = num(rt.tags[c.tag]), r = typeof c.value === 'number' ? c.value : num(rt.tags[c.value]);
    switch (c.op) {
      case '>': return l > r; case '<': return l < r; case '>=': return l >= r; case '<=': return l <= r;
      case '!=': return l !== r; default: return l === r;
    }
  }

  function newRung() {
    return { comment: '', cells: [{ contacts: [{ type: 'NO', tag: '%I0.0' }] }], out: { type: 'coil', tag: '%Q0.0', preset: 1000 } };
  }

  function sanitizeProgram(prog) {
    if (!Array.isArray(prog)) return [];
    return prog.map(r => ({
      comment: String((r && r.comment) || ''),
      cells: ((r && Array.isArray(r.cells)) ? r.cells : []).map(c => ({
        contacts: ((c && Array.isArray(c.contacts)) ? c.contacts : []).map(k => {
          const tag = String((k && k.tag) || '').trim();
          if (k && k.type === 'CMP') return { type: 'CMP', tag, op: CMP_OPS.includes(k.op) ? k.op : '==', value: cmpValue(k.value) };
          return { type: k && k.type === 'NC' ? 'NC' : 'NO', tag };
        })
      })),
      out: {
        type: r && r.out && OUT_TYPES.includes(r.out.type) ? r.out.type : 'coil',
        tag: String((r && r.out && r.out.tag) || '').trim(),
        preset: Math.max(0, Number(r && r.out && r.out.preset) || 0)
      }
    }));
  }

  function applyTimer(out, power, rt, dtMs) {
    const name = out.tag;
    const t = rt.timers[name] || (rt.timers[name] = { acc: 0, dn: false });
    const preset = Math.max(0, Number(out.preset) || 0);
    if (out.type === 'ton') {
      if (power) { t.acc = Math.min(preset, t.acc + dtMs); t.dn = t.acc >= preset; }
      else { t.acc = 0; t.dn = false; }
    } else { // tof
      if (power) { t.dn = true; t.acc = 0; }
      else if (t.dn) { t.acc += dtMs; if (t.acc >= preset) t.dn = false; }
    }
    rt.tags[name + '.DN'] = t.dn;
    rt.tags[name + '.ACC'] = Math.round(t.acc);
  }

  function counterOf(rt, name) {
    if (!rt.counters) rt.counters = {};
    return rt.counters[name] || (rt.counters[name] = { acc: 0, dn: false, prev: false });
  }
  function publishCounter(rt, name, c, preset) {
    c.dn = c.down ? c.acc <= 0 : c.acc >= preset;
    rt.tags[name + '.DN'] = c.dn; rt.tags[name + '.ACC'] = c.acc;
  }
  function applyCounter(out, power, rt) {
    const c = counterOf(rt, out.tag), preset = Math.max(0, Number(out.preset) || 0);
    if (out.type === 'ctu') {
      c.down = false;
      if (power && !c.prev) c.acc = Math.min(32767, c.acc + 1);
      c.prev = power; c.pv = preset;
      publishCounter(rt, out.tag, c, preset);
    } else if (out.type === 'ctd') {          // regressivo: parte do valor programado e desce até 0
      if (!c.down) { c.down = true; c.acc = preset; }
      if (power && !c.prev) c.acc = Math.max(0, c.acc - 1);
      c.prev = power; c.pv = preset;
      publishCounter(rt, out.tag, c, preset);
    } else if (power) {                       // ctr: volta ao valor inicial (0 no crescente, o programado no regressivo)
      c.acc = c.down ? (c.pv || 0) : 0; publishCounter(rt, out.tag, c, c.pv || 0);
    }
  }

  function applyOutput(out, power, rt, dtMs) {
    if (!out || !out.tag) return;
    if (out.type === 'ctu' || out.type === 'ctd' || out.type === 'ctr') return applyCounter(out, power, rt);
    if (out.type === 'coil') rt.tags[out.tag] = power;
    else if (out.type === 'set') { if (power) rt.tags[out.tag] = true; }
    else if (out.type === 'reset') { if (power) rt.tags[out.tag] = false; }
    else applyTimer(out, power, rt, dtMs);
  }

  // Uma varredura completa, degrau por degrau, de cima para baixo.
  // Retorna, por degrau, o fluxo de energia (para destacar na interface).
  function scan(program, rt, dtMs) {
    return program.map(rung => {
      let power = true;
      const cells = rung.cells.map(cell => {
        const powerIn = power;
        let pass = cell.contacts.length === 0;
        const contacts = cell.contacts.map(c => {
          const ok = c.type === 'CMP' ? compare(c, rt) : (c.type === 'NC' ? !rt.tags[c.tag] : !!rt.tags[c.tag]);
          if (ok) pass = true;
          return powerIn && ok;
        });
        power = power && pass;
        return { powerIn, contacts };
      });
      applyOutput(rung.out, power, rt, dtMs);
      return { power, cells };
    });
  }

  return { createRuntime, scan, newRung, sanitizeProgram, tagError, outTagError, OUT_TYPES, CMP_OPS, cmpValue };
})();
if (typeof module !== 'undefined') module.exports = PLC;
