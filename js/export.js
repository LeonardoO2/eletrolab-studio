// Exportação da folha de desenho: diagrama + lista de materiais + carimbo, em PNG ou PDF (A3 paisagem).
const SheetExport = (function () {
  const TYPE_LABEL = {
    source: 'Fonte CC', push_no: 'Botão NA', push_nc: 'Botão NF', estop: 'Botão de emergência NF', thermal: 'Relé térmico (contato NF)',
    sensor_ind: 'Sensor indutivo', level_sw: 'Sensor de nível', relay_coil: 'Bobina de relé', relay_no: 'Contato NA de relé', relay_nc: 'Contato NF de relé',
    lamp: 'Sinaleiro', motor_load: 'Motor CC', pump: 'Bomba', valve: 'Válvula solenoide', plc_cpu: 'CLP (CPU)', plc_input: 'Módulo de entrada', plc_output: 'Módulo de saída'
  };
  const SKIP = ['ground', 'rail_pos', 'rail_neg'];
  const SW = 1654, SH = 1169;                                   // A3 paisagem a 100 dpi

  // Lista de materiais: um item por tipo, com a quantidade e os nomes.
  function bom(world) {
    const m = {};
    world.parts.filter(p => !SKIP.includes(p.type)).forEach(p => { (m[p.type] = m[p.type] || []).push(p.name || p.type); });
    return Object.keys(m).sort((a, b) => (TYPE_LABEL[a] || a).localeCompare(TYPE_LABEL[b] || b, 'pt-BR')).map((t, i) => ({
      item: i + 1, qty: m[t].length, desc: TYPE_LABEL[t] || t, names: m[t].join(', ')
    }));
  }

  function wrap(ctx, s, w) {
    const out = []; let line = '';
    String(s).split(' ').forEach(wd => { const t = line ? line + ' ' + wd : wd; if (ctx.measureText(t).width > w && line) { out.push(line); line = wd; } else line = t; });
    if (line) out.push(line); return out;
  }

  function sheetCanvas(world, st0, scale) {
    scale = scale || 2;
    const c = document.createElement('canvas'); c.width = SW * scale; c.height = SH * scale;
    const ctx = c.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SW, SH);
    const M = 30, BW = 380;                                      // margem e largura da coluna da direita
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.strokeRect(M, M, SW - 2 * M, SH - 2 * M);

    // diagrama
    const dx = M + 8, dy = M + 8, dw = SW - 2 * M - BW - 24, dh = SH - 2 * M - 16;
    const sub = document.createElement('canvas'), d = scale;
    sub.width = Math.round(dw * d); sub.height = Math.round(dh * d);
    const sctx = sub.getContext('2d');
    const b = Geometry.contentBounds(world), bw = b ? b.x1 - b.x0 : 1, bh = b ? b.y1 - b.y0 : 1, ah = dh - 36;
    const s = b ? Math.min((dw - 40) / bw, (ah - 30) / bh, 1.4) : 1;
    const st = Object.assign({}, st0, {
      world, view: { s, ox: b ? (dw - bw * s) / 2 - b.x0 * s : 20, oy: b ? (ah - bh * s) / 2 - b.y0 * s : 20 },
      selected: null, selectedWire: null, selectedZone: null, pendingPin: null, placing: null, running: false,
      showGrid: false, showLabels: true, showLegend: true, hoverRoot: null, hoverPin: null, hoverPart: null, hoverTag: null, everPressed: true
    });
    Render.draw(sctx, dw, dh, d, st);
    ctx.drawImage(sub, dx, dy, dw, dh);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(dx, dy, dw, dh);

    // coluna da direita: lista de materiais e carimbo
    const x0 = SW - M - BW, w = BW;
    ctx.fillStyle = '#111'; ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('LISTA DE MATERIAIS', x0 + 4, M + 28);
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#555';
    ctx.fillText('Item', x0 + 4, M + 52); ctx.fillText('Qtd', x0 + 44, M + 52); ctx.fillText('Descrição / identificação', x0 + 84, M + 52);
    ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.moveTo(x0, M + 58); ctx.lineTo(x0 + w, M + 58); ctx.stroke();
    let y = M + 78; ctx.font = '12px "Segoe UI", Arial, sans-serif';
    const maxY = SH - M - 190;
    bom(world).forEach(r => {
      const lines = wrap(ctx, r.names, w - 90), hgt = 18 + lines.length * 15;
      if (y + hgt > maxY) return;
      ctx.fillStyle = '#111'; ctx.fillText(String(r.item), x0 + 4, y); ctx.fillText(String(r.qty), x0 + 44, y);
      ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif'; ctx.fillText(r.desc, x0 + 84, y); ctx.font = '12px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#444'; lines.forEach((l, i) => ctx.fillText(l, x0 + 84, y + 15 * (i + 1)));
      ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(x0, y + hgt - 10); ctx.lineTo(x0 + w, y + hgt - 10); ctx.stroke();
      y += hgt;
    });

    // carimbo
    const ty = SH - M - 170, sh = world.sheet || {};
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.strokeRect(x0, ty, w, 162);
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, ty + 70); ctx.lineTo(x0 + w, ty + 70); ctx.moveTo(x0, ty + 116); ctx.lineTo(x0 + w, ty + 116); ctx.moveTo(x0 + w * 0.62, ty + 116); ctx.lineTo(x0 + w * 0.62, ty + 162); ctx.stroke();
    const lab = (t, x, yy) => { ctx.font = '10px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#666'; ctx.fillText(t, x, yy); };
    lab('TÍTULO', x0 + 8, ty + 16); ctx.fillStyle = '#111'; ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    const title = sh.title || 'Diagrama de comando'; wrap(ctx, title, w - 16).slice(0, 2).forEach((l, i) => ctx.fillText(l, x0 + 8, ty + 40 + i * 22));
    lab('DESENHADO POR', x0 + 8, ty + 86); ctx.fillStyle = '#111'; ctx.font = '14px "Segoe UI", Arial, sans-serif'; ctx.fillText(sh.author || '—', x0 + 8, ty + 106);
    lab('DATA', x0 + 8, ty + 132); ctx.fillStyle = '#111'; ctx.font = '14px "Segoe UI", Arial, sans-serif'; ctx.fillText(new Date().toLocaleDateString('pt-BR'), x0 + 8, ty + 152);
    lab('REV.', x0 + w * 0.62 + 8, ty + 132); ctx.fillStyle = '#111'; ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif'; ctx.fillText(sh.rev || 'A', x0 + w * 0.62 + 8, ty + 152);
    lab('FOLHA', x0 + w * 0.8, ty + 132); ctx.fillStyle = '#111'; ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif'; ctx.fillText('1/1', x0 + w * 0.8, ty + 152);
    ctx.fillStyle = '#888'; ctx.font = '11px "Segoe UI", Arial, sans-serif'; ctx.fillText('EletroLab Studio', x0 + w * 0.62 + 8, ty + 100);
    return c;
  }

  // PDF mínimo de 1 página (A3 paisagem) com a imagem JPEG da folha.
  function pdfBytes(canvas) {
    const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1], bin = atob(b64), jpg = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
    const PW = 1190.55, PH = 841.89, enc = new TextEncoder(), chunks = [], offs = []; let len = 0;
    const push = u => { chunks.push(u); len += u.length; };
    const str = s => push(enc.encode(s));
    const obj = (n, body) => { offs[n] = len; str(n + ' 0 obj\n' + body + '\nendobj\n'); };
    str('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offs[4] = len; str('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n'); push(jpg); str('\nendstream\nendobj\n');
    const cs = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q';
    obj(5, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
    const xr = len; let t = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) t += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    str(t + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF');
    const out = new Uint8Array(len); let p = 0; chunks.forEach(u => { out.set(u, p); p += u.length; });
    return out;
  }

  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportPNG(world, st) { sheetCanvas(world, st, 2).toBlob(b => download(b, 'diagrama-eletrolab.png'), 'image/png'); }
  function exportPDF(world, st) { download(new Blob([pdfBytes(sheetCanvas(world, st, 1.5))], { type: 'application/pdf' }), 'diagrama-eletrolab.pdf'); }

  return { bom, sheetCanvas, pdfBytes, exportPNG, exportPDF };
})();
