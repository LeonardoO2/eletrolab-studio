// Editor de degraus Ladder (DOM). Cada degrau é desenhado como um diagrama de verdade:
// trilho esquerdo → linha contínua → contatos → bobina/temporizador → trilho direito.
// A estrutura é reconstruída ao editar (render); durante a simulação só trocam classes (paint).
const LadderUI = (function () {
  let host = null, getProg = () => [], status = () => {}, onHover = () => {};
  let refs = [], curHl = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function init(opts) {
    host = opts.container;
    getProg = opts.getProgram;
    status = opts.onStatus || (() => {});
    onHover = opts.onHoverTag || (() => {});
    render();
  }

  // Passar o mouse num contato ou na saída avisa o diagrama qual tag está em foco.
  function hoverable(node, getTag) {
    node.addEventListener('mouseenter', () => onHover(getTag()));
    node.addEventListener('mouseleave', () => onHover(null));
  }

  // Acende, no Ladder, todos os contatos/saídas que usam a tag (vinda do diagrama ou de outro ponto do Ladder).
  function highlightTag(tag) {
    tag = tag || null;
    if (!host || tag === curHl) return;
    curHl = tag;
    host.querySelectorAll('[data-tag]').forEach(n => n.classList.toggle('hl', !!tag && n.dataset.tag === tag));
  }

  const isTimerType = t => t === 'ton' || t === 'tof';
  const isCounterType = t => t === 'ctu' || t === 'ctr';
  function nextName(prog, prefix, types) {
    const used = new Set(prog.filter(r => r.out && types.includes(r.out.type)).map(r => r.out.tag));
    let n = 1;
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }

  function tagInput(value, title, check, commit) {
    const inp = el('input', 'tag-in');
    inp.value = value; inp.title = title; inp.spellcheck = false;
    inp.onchange = () => {
      const err = check(inp.value);
      if (err) { status(err, true); inp.value = value; return; }
      commit(inp.value.trim());
    };
    return inp;
  }

  function buildHead(prog, rung, ri) {
    const head = el('div', 'rung-head');
    head.appendChild(el('span', 'rung-n', 'Degrau ' + (ri + 1)));
    const cm = el('input', 'rung-comment');
    cm.placeholder = 'Comentário do degrau';
    cm.value = rung.comment || '';
    cm.onchange = () => { rung.comment = cm.value; };
    head.appendChild(cm);
    const up = el('button', 'mini', '↑'); up.title = 'Mover para cima';
    up.onclick = () => { if (ri > 0) { prog.splice(ri - 1, 0, prog.splice(ri, 1)[0]); render(); } };
    const dn = el('button', 'mini', '↓'); dn.title = 'Mover para baixo';
    dn.onclick = () => { if (ri < prog.length - 1) { prog.splice(ri + 1, 0, prog.splice(ri, 1)[0]); render(); } };
    const rm = el('button', 'mini danger', '✕'); rm.title = 'Excluir degrau';
    rm.onclick = () => { prog.splice(ri, 1); render(); };
    head.append(up, dn, rm);
    return head;
  }

  // Contato: tag em cima, símbolo ┤ ├ (ou ┤/├) no meio, ações embaixo. As três faixas têm altura fixa,
  // então a linha principal do degrau passa exatamente pelo centro do símbolo.
  function buildContact(rung, cell, ci, c, ki) {
    const box = el('div', 'contact');
    box.dataset.tag = c.tag; hoverable(box, () => c.tag);
    const tr = el('div', 'tagrow');
    tr.appendChild(tagInput(c.tag, 'Tag lida por este contato', PLC.tagError, v => { c.tag = v; box.dataset.tag = v; }));
    const sr = el('div', 'symrow');
    const sb = el('button', 'symbtn' + (c.type === 'NC' ? ' nc' : ''));
    sb.title = c.type === 'NC' ? 'Contato NF: clique para trocar para NA' : 'Contato NA: clique para trocar para NF';
    sb.append(el('i'), el('i'));
    sb.onclick = () => { c.type = c.type === 'NC' ? 'NO' : 'NC'; render(); };
    sr.append(el('span', 'cl'), sb, el('span', 'cl'));
    const fr = el('div', 'footrow');
    const del = el('button', 'mini', '×'); del.title = 'Remover contato';
    del.onclick = () => {
      cell.contacts.splice(cell.contacts.indexOf(c), 1);
      if (!cell.contacts.length) rung.cells.splice(ci, 1);
      render();
    };
    fr.appendChild(del);
    if (ki === cell.contacts.length - 1) {
      const par = el('button', 'mini add', '＋ ∥'); par.title = 'Adicionar contato em paralelo (OU) nesta coluna';
      par.onclick = () => { cell.contacts.push({ type: 'NO', tag: '%M0.0' }); render(); };
      fr.appendChild(par);
    }
    box.append(tr, sr, fr);
    return box;
  }

  function buildOutput(prog, out) {
    const timer = isTimerType(out.type), counter = isCounterType(out.type), named = timer || counter, preset = timer || out.type === 'ctu';
    const oc = el('div', 'outcard');
    oc.dataset.tag = out.tag; hoverable(oc, () => out.tag);
    const tr = el('div', 'tagrow');
    tr.appendChild(tagInput(out.tag, timer ? 'Nome do temporizador' : out.type === 'ctu' ? 'Nome do contador' : out.type === 'ctr' ? 'Contador a zerar (nome)' : 'Tag escrita pelo degrau',
      v => PLC.outTagError(out.type, v), v => { out.tag = v; oc.dataset.tag = v; }));
    const sr = el('div', 'osym');
    if (named) sr.appendChild(el('div', 'tbox', out.type.toUpperCase()));
    else sr.appendChild(el('div', 'coil', out.type === 'set' ? 'S' : out.type === 'reset' ? 'R' : ''));
    const fr = el('div', 'footrow');
    const sel = el('select');
    [['coil', 'Bobina ( )'], ['set', 'Set (S)'], ['reset', 'Reset (R)'], ['ton', 'TON'], ['tof', 'TOF'], ['ctu', 'CTU (contador)'], ['ctr', 'CTR (zera contador)']].forEach(([v, t]) => {
      const o = el('option', '', t); o.value = v; sel.appendChild(o);
    });
    sel.value = out.type;
    sel.onchange = () => {
      const nt = sel.value, wasType = out.type;
      out.type = nt;
      if (isTimerType(nt) && !isTimerType(wasType)) { out.tag = nextName(prog, 'T', ['ton', 'tof']); out.preset = 1000; }
      else if (nt === 'ctu' && wasType !== 'ctu') { out.tag = nextName(prog, 'C', ['ctu']); out.preset = 5; }
      else if (nt === 'ctr' && wasType !== 'ctr') {
        const first = prog.find(r => r !== undefined && r.out && r.out.type === 'ctu');
        out.tag = first ? first.out.tag : 'C1';
      }
      else if (!isTimerType(nt) && !isCounterType(nt) && (isTimerType(wasType) || isCounterType(wasType))) out.tag = '%M0.0';
      render();
    };
    fr.appendChild(sel);
    if (preset) {
      const pre = el('input', 'preset');
      pre.type = 'number'; pre.min = '0'; pre.step = timer ? '100' : '1'; pre.value = out.preset; pre.title = timer ? 'Tempo programado (ms)' : 'Contagem programada';
      pre.onchange = () => { out.preset = Math.max(0, Number(pre.value) || 0); pre.value = out.preset; };
      fr.appendChild(pre);
    }
    oc.append(tr, sr, fr);
    return oc;
  }

  function render() {
    if (!host) return;
    const keep = host.scrollTop;
    host.innerHTML = '';
    refs = []; curHl = null;
    const prog = getProg();

    host.appendChild(el('div', 'ladder-intro',
      'Cada degrau é lido da esquerda para a direita, do trilho esquerdo ao direito. Contatos em série formam um E (AND); ' +
      'contatos empilhados na mesma coluna (∥) formam um OU. Clique no símbolo para alternar NA (┤ ├) e NF (┤/├). ' +
      'Tags: %I0.0 (entrada), %Q0.0 (saída), %M0.0 (memória) ou nomes livres. Temporizadores geram NOME.DN. ' +
      'Durante a simulação, a linha verde mostra por onde passa a "energia" do degrau.'));

    prog.forEach((rung, ri) => {
      const rEl = el('div', 'rung');
      const rf = { el: rEl, cells: [], out: null, lines: [] };
      rEl.appendChild(buildHead(prog, rung, ri));

      const scroll = el('div', 'rung-scroll'), body = el('div', 'rung-body');
      body.appendChild(el('div', 'rail l'));

      rung.cells.forEach((cell, ci) => {
        const cEl = el('div', 'cell');
        cEl.appendChild(el('span', 'lw'));
        const stack = el('div', 'stack' + (cell.contacts.length > 1 ? ' par' : ''));
        const cf = { el: cEl, stack, contacts: [] };
        cell.contacts.forEach((c, ki) => {
          const box = buildContact(rung, cell, ci, c, ki);
          stack.appendChild(box);
          cf.contacts.push(box);
        });
        cEl.appendChild(stack);
        body.appendChild(cEl);
        rf.cells.push(cf);
      });

      // linha até a saída, com o "＋" de adicionar contato em série bem em cima da linha
      const seg = el('div', 'segadd'), w1 = el('span', 'lw'), w2 = el('span', 'lw');
      const addC = el('button', 'addnode', '＋');
      addC.title = 'Adicionar contato em série (E)';
      addC.onclick = () => { rung.cells.push({ contacts: [{ type: 'NO', tag: '%I0.0' }] }); render(); };
      seg.append(w1, addC, w2);
      const tail = el('span', 'lw tail');
      rf.out = buildOutput(prog, rung.out);
      rf.lines = [w1, w2, tail];

      body.append(seg, rf.out, tail, el('div', 'rail r'));
      scroll.appendChild(body);
      rEl.appendChild(scroll);
      host.appendChild(rEl);
      refs.push(rf);
    });

    const add = el('button', 'add-rung', '＋ Novo degrau');
    add.onclick = () => { prog.push(PLC.newRung()); render(); };
    host.appendChild(add);
    host.scrollTop = keep;
  }

  // Destaca o fluxo de energia a cada varredura (info vem de PLC.scan; null = parado ou CLP sem alimentação).
  function paint(info) {
    if (!host) return;
    host.classList.toggle('running', !!info);
    refs.forEach((rf, ri) => {
      const i = info && info[ri];
      const on = !!(i && i.power);
      rf.el.classList.toggle('on', on);
      rf.cells.forEach((cf, ci) => {
        const c = i && i.cells[ci];
        cf.el.classList.toggle('live', !!(c && c.powerIn));
        let any = false;
        cf.contacts.forEach((b, k) => {
          const lit = !!(c && c.contacts[k]);
          any = any || lit;
          b.classList.toggle('lit', lit);
        });
        cf.stack.classList.toggle('pass', any);
      });
      rf.lines.forEach(l => l.classList.toggle('live', on));
      rf.out.classList.toggle('lit', on);
    });
  }

  return { init, render, paint, highlightTag };
})();
