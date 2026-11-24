/* Interfaz de KMZ + ANEXO III Red BT */
(function () {
  'use strict';
  const APP_VERSION = '1.9.2';
  const C = window.Core;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const estado = { fotos: [], kmzGenerado: null, kmzModificado: null, modelo: null };

  // ───────── persistencia de las tablas (solo texto) ─────────
  const LS = { main: 'kmzexcelbt.main', def: 'kmzexcelbt.def', suf: 'kmzexcelbt.suf1', comp: 'kmzexcelbt.comp', orig: 'kmzexcelbt.orig', mapa: 'kmzexcelbt.mapa' };
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
  $('txtMain').value = lsGet(LS.main);
  $('txtDef').value = lsGet(LS.def);
  $('chkSuf1').checked = lsGet(LS.suf) === '1';
  $('txtComp').value = lsGet(LS.comp);
  $('txtComp').addEventListener('input', () => { lsSet(LS.comp, $('txtComp').value); clearTimeout(estado.tComp); estado.tComp = setTimeout(() => pintarSecciones(), 600); });
  const infoTabla = (ta, info) => { const n = C.splitTable(ta.value).length; $(info).textContent = n ? n + ' filas' : ''; };
  [['txtMain', 'infoMain', LS.main], ['txtDef', 'infoDef', LS.def]].forEach(([ta, info, k]) => {
    $(ta).addEventListener('input', () => { lsSet(k, $(ta).value); infoTabla($(ta), info); actualizarBtnExcel(); clearTimeout(estado.tNum); estado.tNum = setTimeout(() => { pintarNumeracion(); pintarSecciones(); avisarTabla(); marcarFotosSiToca(); }, 500); });
    infoTabla($(ta), info);
  });
  $('chkSuf1').addEventListener('change', () => lsSet(LS.suf, $('chkSuf1').checked ? '1' : ''));

  // ───────── carga de archivos de tabla (.txt/.csv/.xlsx) ─────────
  document.querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => $(b.dataset.file).click()));
  async function leerTabla(file) {
    if (/\.xlsx$/i.test(file.name)) return xlsxATexto(await file.arrayBuffer());
    const buf = await file.arrayBuffer();
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);
    return t;
  }
  async function xlsxATexto(buf) {
    const z = await JSZip.loadAsync(buf);
    const P = s => new DOMParser().parseFromString(s, 'application/xml');
    const wb = P(await z.file('xl/workbook.xml').async('string'));
    const rid = wb.getElementsByTagName('sheet')[0].getAttribute('r:id');
    const rels = P(await z.file('xl/_rels/workbook.xml.rels').async('string'));
    let target = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid).getAttribute('Target');
    target = target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
    const ss = [];
    if (z.file('xl/sharedStrings.xml')) {
      const d = P(await z.file('xl/sharedStrings.xml').async('string'));
      [...d.getElementsByTagName('si')].forEach(si => ss.push([...si.getElementsByTagName('t')].map(t => t.textContent).join('')));
    }
    const sh = P(await z.file(target).async('string'));
    const colN = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const filas = [];
    [...sh.getElementsByTagName('row')].forEach(row => {
      const f = [];
      [...row.getElementsByTagName('c')].forEach(c => {
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's' && v) val = ss[+v.textContent] || '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (v) val = v.textContent;
        f[colN(c.getAttribute('r'))] = String(val).replace(/[\t\n\r]+/g, ' ');
      });
      filas.push(Array.from(f, x => x == null ? '' : x).join('\t'));
    });
    return filas.join('\n');
  }
  [['fMain', 'txtMain', 'infoMain', LS.main], ['fDef', 'txtDef', 'infoDef', LS.def]].forEach(([fi, ta, info, k]) => {
    $(fi).addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { $(ta).value = await leerTabla(f); lsSet(k, $(ta).value); infoTabla($(ta), info); $(info).textContent += ' · ' + f.name; pintarNumeracion(); actualizarBtnExcel(); avisarTabla(); }
      catch (err) { alert('No se pudo leer ' + f.name + ': ' + err.message); }
      e.target.value = '';
    });
  });

  // ───────── fotos ─────────
  function zonaDrop(zona, input, onFiles) {
    zona.addEventListener('click', () => input.click());
    zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('on'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('on'));
    zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('on'); onFiles([...e.dataTransfer.files]); });
    input.addEventListener('change', e => { onFiles([...e.target.files]); e.target.value = ''; });
  }
  async function anadirFotos(files) {
    $('infoFotos').textContent = 'Leyendo…';
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        try {
          const z = await JSZip.loadAsync(f);
          z.forEach((path, entry) => {
            if (entry.dir || /(^|\/)(__MACOSX|\.)/.test(path)) return;
            if (/\.(jpe?g|png|gif|webp)$/i.test(path)) estado.fotos.push({ orig: path, nombre: renombrar(path), leer: () => entry.async('uint8array') });
          });
        } catch (e) { alert('No se pudo abrir ' + f.name + ': ' + e.message); }
      } else if (/\.(jpe?g|png|gif|webp)$/i.test(f.name)) {
        estado.fotos.push({ orig: f.name, nombre: renombrar(f.name), leer: async () => new Uint8Array(await f.arrayBuffer()) });
      }
    }
    pintarFotos(); marcarFotosSiToca();
  }
  function pintarFotos() {
    if (estado.mapaListo) pintarNumeracion();
    $('infoFotos').textContent = estado.fotos.length ? estado.fotos.length + ' fotos cargadas.' : 'Sin fotos.';
    $('btnQuitarFotos').hidden = !estado.fotos.length;
  }
  zonaDrop($('dropFotos'), $('fFotos'), anadirFotos);
  $('btnQuitarFotos').addEventListener('click', () => { estado.fotos = []; estado.fotosMarcadas = false; pintarFotos(); });

  $('btnNuevo').addEventListener('click', () => {
    if (!confirm('¿Empezar un proyecto nuevo? Se borra todo lo del proyecto actual: tablas, fotos, KMZ, fotos elegidas para el Excel y el envío pendiente al informe.')) return;
    // pantalla
    $('txtMain').value = ''; $('txtDef').value = ''; $('txtComp').value = ''; $('chkSuf1').checked = false;
    $('res1').innerHTML = ''; $('res2').innerHTML = ''; $('infoMain').textContent = ''; $('infoDef').textContent = '';
    $('infoKmz').textContent = 'Ningún KMZ cargado.'; $('btnUsarGenerado').hidden = true;
    $('fotosPick').innerHTML = '<div class="info">Carga el KMZ modificado para elegir las fotos.</div>';
    ['fMain', 'fDef', 'fFotos', 'fKmz'].forEach(id => { $(id).value = ''; });
    // memoria de la página
    if (estado.miniaturas) estado.miniaturas.forEach(u => { if (u) URL.revokeObjectURL(u); });
    estado.miniaturas = new Map(); estado.fotoElegida = {}; estado.avisoRegenerar = false; estado.fotosMarcadas = false; estado.tablaAvisada = null;
    estado.fotos = []; estado.kmzGenerado = null; estado.kmzModificado = null; estado.kmzLeido = null; estado.modelo = null; estado.informe = null;
    clearTimeout(estado.tGrav);
    // memoria del navegador (el orden de gravedad es un ajuste y se conserva)
    [LS.main, LS.def, LS.suf, LS.comp, LS.orig, LS.mapa, 'jdev_kmz_informe'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    pintarFotos(); actualizarBtnExcel(); pintarNumeracion(); $('detSecc').open = false; $('secciones').innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ───────── leyenda (única imagen propia permitida) ─────────
  function leyendaPNG(filas) {
    const fila = 30, pad = 6;
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d');
    ctx.font = '13px Arial, Helvetica, sans-serif';
    const w = Math.max(190, Math.ceil(Math.max(...filas.map(f => ctx.measureText(f.label).width))) + 58);
    const h = filas.length * fila + pad * 2;
    cv.width = w; cv.height = h;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const pin = (y, col) => { ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(20, y - 2); ctx.lineTo(17, y + 11); ctx.stroke(); ctx.beginPath(); ctx.arc(21, y - 5, 7, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke(); };
    filas.forEach((f, i) => {
      const y = pad + i * fila + fila / 2;
      switch (f.k) {
        case 'APOYO': pin(y, '#f7d117'); break;
        case 'APOYO_CGP': pin(y, '#1ea51e'); break;
        case 'POST': pin(y, '#7fc8f8'); break;
        case 'CGP': ctx.beginPath(); ctx.arc(20, y, 6, 0, 7); ctx.fillStyle = '#006400'; ctx.fill(); break;
        case 'GPAL': ctx.fillStyle = '#0000ff'; ctx.fillRect(14, y - 6, 12, 12); break;
        case 'DEF': ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(15, y + 9); ctx.lineTo(15, y - 9); ctx.stroke(); ctx.beginPath(); ctx.moveTo(15, y - 9); ctx.lineTo(27, y - 4); ctx.lineTo(15, y + 1); ctx.closePath(); ctx.fillStyle = '#ff0000'; ctx.fill(); break;
        case 'ZOBX': case 'Q91X': ctx.beginPath(); ctx.moveTo(20, y - 9); ctx.lineTo(28, y); ctx.lineTo(20, y + 9); ctx.lineTo(12, y); ctx.closePath(); ctx.fillStyle = f.k === 'ZOBX' ? '#ff0000' : '#2060ff'; ctx.fill(); break;
        case 'SAL': ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(32, y); ctx.stroke(); break;
      }
      ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.fillText(f.label, 46, y + 1);
    });
    return new Promise(res => cv.toBlob(b => res({ blob: b, w, h }), 'image/png'));
  }

  // ───────── vista previa esquemática (SVG) ─────────
  function vistaPrevia(m) {
    const pts = m.nodes.filter(n => n.coords); if (!pts.length) return '';
    const lat0 = pts.reduce((s, n) => s + n.coords.lat, 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
    const X = n => n.coords.lon * k, Y = n => -n.coords.lat;
    const xs = pts.map(X), ys = pts.map(Y), minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const W = 900, H = 420, m0 = 24, s = Math.min((W - 2 * m0) / ((maxx - minx) || 1e-6), (H - 2 * m0) / ((maxy - miny) || 1e-6));
    const px = n => (m0 + (X(n) - minx) * s).toFixed(1), py = n => (m0 + (Y(n) - miny) * s).toFixed(1);
    let g = '';
    (m.adicionales || []).forEach(x => { if (x.a.coords && x.b.coords) g += `<line x1="${px(x.a)}" y1="${py(x.a)}" x2="${px(x.b)}" y2="${py(x.b)}" stroke="${C.salHex(x.salida)}" stroke-width="2.5"><title>${C.salName(x.salida)}: ${x.a.name} → ${x.b.name} (recorrido) · ${Math.round(x.dist)} m</title></line>`; });
    (m.compartidos || []).forEach(c => { const t = c.tramo; g += `<line x1="${px(t.a)}" y1="${py(t.a)}" x2="${px(t.b)}" y2="${py(t.b)}" stroke="${C.salHex(c.salida)}" stroke-width="${2.5 + 3 * c.orden}" stroke-opacity=".55" stroke-linecap="round"><title>${C.salName(c.salida)} comparte ${t.a.name} → ${t.b.name}</title></line>`; });
    m.tramos.forEach(t => { if (t.dist != null) g += `<line x1="${px(t.a)}" y1="${py(t.a)}" x2="${px(t.b)}" y2="${py(t.b)}" stroke="${C.salHex(t.salida)}" stroke-width="2.5"><title>${t.a.name} → ${t.b.name} · ${Math.round(t.dist)} m</title></line>`; });
    pts.forEach(n => {
      const col = n.esPT ? '#e00' : n.clase === 'POST' ? '#7fc8f8' : n.clase === 'GPAL' ? '#00f' : n.cgp ? '#1ea51e' : '#f7d117';
      const def = n.defectos.length ? `<circle cx="${px(n)}" cy="${py(n)}" r="9" fill="none" stroke="#e00" stroke-dasharray="2 2"/>` : '';
      g += `${def}<circle cx="${px(n)}" cy="${py(n)}" r="${n.esPT ? 7 : 5}" fill="${col}" stroke="#333"><title>${esc(n.name)}${n.defectos.length ? ' · ' + n.defectos.map(d => d.codigo).join(', ') : ''}</title></circle>`;
      if (!n.esPT) g += `<text x="${+px(n) + 7}" y="${+py(n) - 6}" font-size="10" fill="#555">${n.apoyo}</text>`;
    });
    const hReal = Math.min(H, 2 * m0 + (maxy - miny) * s + 10);
    return `<svg class="prev" viewBox="0 0 ${W} ${hReal}" width="100%">${g}</svg><div class="info">Vista esquemática (no es un mapa). Círculo rojo discontinuo = apoyo con defecto. Pasa el ratón por encima para ver nombres y distancias.</div>`;
  }

  const listaAvisos = (arr, cls) => arr.length ? `<ul class="av">${arr.map(a => `<li class="${cls}">${esc(a)}</li>`).join('')}</ul>` : '';
  const descargar = (blob, nombre) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };

  // Avisa a GestCD (misma web) de que se ha hecho un paso de este centro: 'fotos', 'kmz' o 'excel'
  function marcarPaso(paso, ct) {
    try {
      if (!ct) ct = modeloDesdeTablas().ct;
      const k = String(ct).trim().toUpperCase().replace(/^0+(?=\d)/, ''); if (!k) return false;
      const m = JSON.parse(localStorage.getItem('jdev_pasos') || '{}') || {};
      m[k] = Object.assign({}, m[k], { [paso]: Date.now() });
      localStorage.setItem('jdev_pasos', JSON.stringify(m));
      return true;
    } catch (e) { return false; }
  }
  // Al meter la tabla de posiciones se avisa a GestCD para que cree el centro si no lo tiene
  function avisarTabla() {
    try {
      const m = modeloDesdeTablas(); const k = String(m.ct).replace(/^0+(?=\d)/, '');
      if (estado.tablaAvisada === k) return;
      const reg = JSON.parse(localStorage.getItem('jdev_pasos') || '{}') || {};
      const tipo = m.pt && /^CT/i.test(String(m.pt.row.tipo).trim()) ? 'CT' : 'PT';
      reg[k] = Object.assign({}, reg[k], { tabla: Date.now(), tipo });
      localStorage.setItem('jdev_pasos', JSON.stringify(reg));
      estado.tablaAvisada = k;
    } catch (e) { /* tabla incompleta */ }
  }
  // Marca las fotos en cuanto se conozca el CT (pueden subirse antes que la tabla)
  function marcarFotosSiToca() {
    if (!estado.fotos.length || estado.fotosMarcadas) return;
    if (marcarPaso('fotos')) estado.fotosMarcadas = true;
  }
  function resaltar(id) {
    const el = $(id); el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 2500);
  }

  // Provincia del centro: la de GestCD (misma web), o la de la app de informes, o la última elegida
  const PROVS = ['Badajoz', 'Cáceres', 'Sevilla', 'Málaga', 'Córdoba', 'Huelva', 'Cádiz', 'Granada', 'Jaén', 'Almería'];
  const sinAcento = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const esBoletin = prov => sinAcento(prov) === 'MALAGA';
  function provinciaCentro(ct) {
    const k = String(ct).replace(/^0+(?=\d)/, '');
    const norm = p => PROVS.find(x => sinAcento(x) === sinAcento(p)) || p;
    try {
      const g = JSON.parse(localStorage.getItem('gestcd_v1') || 'null');
      const cs = ((g && g.centros) || []).filter(c => String(c.numero).replace(/^0+(?=\d)/, '') === k && c.provincia);
      const c = cs.find(x => !(x.pasos && x.pasos.sharepoint)) || cs[cs.length - 1];
      if (c) { const p = norm(c.provincia); if (!PROVS.includes(p)) PROVS.push(p); return { nombre: p, origen: 'GestCD', tecnico: c.operario && c.operario !== 'Sin asignar' ? c.operario : '' }; }
    } catch (e) {}
    try {
      const ib = JSON.parse(localStorage.getItem('ibt_estado') || 'null');
      for (const l of (ib && ib.lineas) || []) for (const c of l.centros || []) if (String(c.centro).replace(/^0+(?=\d)/, '') === k && c.provincia) { const p = norm(c.provincia); if (!PROVS.includes(p)) PROVS.push(p); return { nombre: p, origen: 'la app de informes' }; }
    } catch (e) {}
    return { nombre: lsGet('kmzexcelbt.prov') || 'Badajoz', origen: '' };
  }

  function modeloDesdeTablas() {
    const main = C.splitTable($('txtMain').value);
    if (!main.length) throw new Error('Falta la tabla de posiciones.');
    return C.buildModel(main, C.splitTable($('txtDef').value), { compartidos: $('txtComp').value });
  }

  // ───────── PASO 1: KMZ ─────────
  $('btnKmz').addEventListener('click', async () => {
    if (!estado.fotos.length && !confirm('No has cargado el ZIP de fotos.\n\n¿Generar el KMZ sin fotos?\n\nAceptar: generar sin fotos · Cancelar: volver para cargarlas')) { resaltar('dropFotos'); return; }
    const btn = $('btnKmz'); btn.disabled = true; btn.textContent = 'Generando…';
    try {
      const m = modeloDesdeTablas();
      const ph = C.asociarFotos(m, estado.fotos.map(f => f.nombre), { sufijo1EsCGP: $('chkSuf1').checked });
      // nombres únicos dentro de files/
      const usados = new Set(['leyenda.png']); const nombreDe = new Map();
      const fotoPor = new Map(estado.fotos.map(f => [f.nombre, f]));
      const todas = [];
      m.nodes.forEach(n => todas.push(...n.fotos, ...n.fotosCGP)); m.defectos.forEach(d => todas.push(...d.fotos));
      todas.forEach(f => { if (nombreDe.has(f.full)) return; let b = f.base, i = 2; while (usados.has(b)) b = f.base.replace(/(\.\w+)$/, `_${i++}$1`); usados.add(b); nombreDe.set(f.full, b); });
      const filasLey = C.leyendaFilas(m);
      const ley = await leyendaPNG(filasLey);
      const kml = C.buildKml(m, f => nombreDe.get(f.full), { w: ley.w, h: ley.h });
      const z = new JSZip();
      z.file('doc.kml', kml, { compression: 'DEFLATE' });
      z.file('files/leyenda.png', ley.blob, { compression: 'STORE' });
      for (const [full, base] of nombreDe) z.file('files/' + base, await fotoPor.get(full).leer(), { compression: 'STORE' });
      const blob = await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' });
      const nombre = `ANEXO I - ${m.ct}.kmz`;
      estado.kmzGenerado = { blob, nombre }; estado.modelo = m; if (estado.avisoRegenerar) { estado.avisoRegenerar = false; pintarNumeracion(); }
      descargar(blob, nombre);
      marcarPaso('kmz', m.ct); marcarFotosSiToca();
      $('btnUsarGenerado').hidden = false; actualizarBtnExcel();
      pintarRes1(m, ph, nombre);
    } catch (e) {
      console.error(e); $('res1').innerHTML = `<div class="res"><div class="err-box">${esc(e.message)}</div></div>`;
    } finally { btn.disabled = false; btn.textContent = 'Generar KMZ'; }
  });

  function pintarRes1(m, ph, nombre) {
    const nApoyos = m.nodes.filter(n => !n.esPT).length, nCgp = m.nodes.filter(n => n.cgp).length;
    const tramos = m.tramos.filter(t => t.dist != null).length;
    const d = C.distancias(m);
    const nZ = m.defectos.filter(x => x.codigo === 'ZOBX').length, nQ = m.defectos.filter(x => x.codigo === 'ZOBX_Q91X').length, nD = m.defectos.length - nZ - nQ;
    let h = `<div class="res"><div class="ok-box">✔ <b>${esc(nombre)}</b> generado y descargado.</div>
      <div class="chips"><span class="chip">PT/CT <b>${esc(m.pt ? m.pt.name : m.ct)}</b></span><span class="chip">Apoyos <b>${nApoyos}</b></span><span class="chip">Tramos <b>${tramos}</b></span><span class="chip">CGP/CPM <b>${nCgp}</b></span>
      <span class="chip">ZOBX <b>${nZ}</b></span>${nQ ? `<span class="chip">ZOBX_Q91X <b>${nQ}</b></span>` : ''}<span class="chip">Otros defectos <b>${nD}</b></span>
      <span class="chip">Fotos <b>${ph.asociadas}/${ph.total}</b></span><span class="chip">Red total <b>${C.fmtMiles(d.total)} m</b></span></div>`;
    h += m.avisos.length ? `<b class="t-aviso">Avisos (${m.avisos.length})</b>${listaAvisos(m.avisos, 't-aviso')}` : '<div class="t-ok">Sin avisos.</div>';
    if (m.notas.length) h += `<details><summary>Notas (${m.notas.length})</summary>${listaAvisos(m.notas, '')}</details>`;
    h += `<details><summary>Distancias por salida</summary><table><tr><th>Salida</th><th>Metros (suma de tramos)</th></tr>${Object.entries(d.porSalida).map(([s, v]) => `<tr><td>${s}</td><td>${C.fmtMiles(v)}</td></tr>`).join('')}<tr><th>Total red${(m.compartidos || []).length ? ' (sin contar dos veces los tramos compartidos)' : ''}</th><th>${C.fmtMiles(d.total)}</th></tr></table></details>`;
    if (m.defectos.length) h += `<details><summary>Defectos asignados (${m.defectos.length})</summary><div class="scroll"><table><tr><th>Código</th><th>Descripción</th><th>Apoyo</th><th>Cómo se asoció</th><th>Distancia</th><th>Fotos</th></tr>${m.defectos.map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.desc)}</td><td>${esc(x.node.esPT ? x.node.name : x.node.code)}</td><td>${esc(x.metodo)}</td><td class="${x.lejos ? 't-aviso' : ''}">${x.dist == null ? '' : C.fmtMiles(x.dist) + ' m'}</td><td>${x.fotos.length}</td></tr>`).join('')}</table></div></details>`;
    if (ph.huerfanas.length) h += `<details open><summary class="t-aviso">Fotos sin asociar (${ph.huerfanas.length})</summary>${listaAvisos(ph.huerfanas.map(x => x.nombre + ' — ' + x.motivo), 't-aviso')}</details>`;
    h += vistaPrevia(m) + '</div>';
    $('res1').innerHTML = h;
  }

  // ───────── PASO 2: ANEXO III ─────────
  function actualizarBtnExcel() { $('btnExcel').disabled = !$('txtMain').value.trim(); }
  zonaDrop($('dropKmz'), $('fKmz'), files => {
    const f = files.find(x => /\.(kmz|kml)$/i.test(x.name)); if (!f) { alert('Elige un archivo .kmz o .kml'); return; }
    estado.kmzModificado = { blob: f, nombre: f.name };
    $('infoKmz').textContent = 'KMZ cargado: ' + f.name; actualizarBtnExcel(); prepararFotos(true);
  });
  $('btnUsarGenerado').addEventListener('click', () => {
    estado.kmzModificado = estado.kmzGenerado;
    $('infoKmz').textContent = 'Usando el KMZ recién generado (sin modificar): ' + estado.kmzGenerado.nombre; actualizarBtnExcel(); prepararFotos(true);
  });

  // ───────── elección de la foto de cada fila (columna FOTO) ─────────
  estado.fotoElegida = {}; estado.miniaturas = new Map();
  async function prepararFotos(nuevoKmz) {
    const zona = $('fotosPick');
    if (nuevoKmz) { estado.fotoElegida = {}; estado.miniaturas.forEach(u => URL.revokeObjectURL(u)); estado.miniaturas = new Map(); }
    const kmz = estado.kmzModificado || estado.kmzGenerado;
    if (!kmz) { zona.innerHTML = ''; return; }
    try {
      const m = modeloDesdeTablas();
      const k = await leerKmz(kmz); estado.kmzLeido = k;
      const an = C.buildAnexo(m, C.parseKml(k.kml), { gravedad: $('txtGrav').value.split(/[\s,;]+/) });
      const filas = an.filas.filter(f => f.candidatas.length);
      if (!filas.length) { zona.innerHTML = '<div class="info">No hay fotos que elegir (ni foto _1 del PT ni fotos de defectos en el KMZ).</div>'; return; }
      const leer = lectorImagenes(k.zip);
      for (const f of filas) for (const c of f.candidatas) if (!estado.miniaturas.has(c.src)) { const d = await leer(c.src); estado.miniaturas.set(c.src, d ? URL.createObjectURL(new Blob([d], { type: d[0] === 0x89 ? 'image/png' : 'image/jpeg' })) : ''); }
      zona.innerHTML = `<p class="info" style="margin:4px 0 8px">Pulsa la foto que quieres en cada fila. Viene marcada la que elegiría la app (foto _1 en el PT; 1ª foto del defecto más grave en los apoyos).</p>` + filas.map(f => {
        const sel = Object.prototype.hasOwnProperty.call(estado.fotoElegida, f.clave) ? estado.fotoElegida[f.clave] : (f.fotoSrc || '');
        const titulo = f.apoyo === '0' || +f.apoyo === 0 ? `Apoyo 0 · PT/CT ${esc(f.ct)}` : `Apoyo ${esc(f.apoyo)} · ${esc([f.defec, f.q91x].filter(Boolean).join(' / ') || 'defecto')}`;
        return `<div class="fp-fila" data-k="${esc(f.clave)}"><div class="fp-tit">${titulo}</div><div class="fp-fotos">` +
          f.candidatas.map(c => `<button type="button" class="fp-foto${sel === c.src ? ' on' : ''}" data-src="${esc(c.src)}" title="${esc(c.src.split('/').pop())}"><img loading="lazy" src="${estado.miniaturas.get(c.src) || ''}" alt=""><span>${esc((suf => c.etiqueta === 'General' ? ('General ' + suf).trim() : (suf || c.etiqueta))(c.src.split('/').pop().replace(/\.\w+$/, '').replace(/^\d+_?/, '')))}</span></button>`).join('') +
          `<button type="button" class="fp-foto fp-no${sel === '' ? ' on' : ''}" data-src=""><span>Sin foto</span></button></div></div>`;
      }).join('');
    } catch (e) { zona.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
  }
  $('fotosPick').addEventListener('click', e => {
    const b = e.target.closest('.fp-foto'); if (!b) return;
    const fila = b.closest('.fp-fila');
    estado.fotoElegida[fila.dataset.k] = b.dataset.src;
    fila.querySelectorAll('.fp-foto').forEach(x => x.classList.toggle('on', x === b));
  });
  $('fotosPick').addEventListener('dblclick', e => { const b = e.target.closest('.fp-foto'); if (b && b.dataset.src) window.open(estado.miniaturas.get(b.dataset.src), '_blank'); });

  async function leerKmz(k) {
    if (/\.kml$/i.test(k.nombre)) return { kml: await k.blob.text(), zip: null };
    const z = await JSZip.loadAsync(k.blob);
    const f = z.file('doc.kml') || z.file(/\.kml$/i)[0];
    if (!f) throw new Error('El KMZ no contiene ningún .kml');
    return { kml: await f.async('string'), zip: z };
  }
  function lectorImagenes(zip) {
    return async src => {
      if (!zip) return null;
      let p = src; try { p = decodeURIComponent(src); } catch (e) {}
      p = p.replace(/^\.?\//, '');
      let f = zip.file(p);
      if (!f) { const base = p.split(/[\\/]/).pop().toLowerCase(); f = zip.file(new RegExp('(^|/)' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))[0]; }
      return f ? await f.async('uint8array') : null;
    };
  }

  // Orden de gravedad de defectos (para elegir la foto)
  const LS_GRAV = 'kmzexcelbt.gravedad';
  $('txtGrav').value = lsGet(LS_GRAV) || C.GRAVEDAD_DEFECTO.join(', ');
  $('txtGrav').addEventListener('input', () => { lsSet(LS_GRAV, $('txtGrav').value); clearTimeout(estado.tGrav); estado.tGrav = setTimeout(() => prepararFotos(false), 600); });
  $('btnGravDef').addEventListener('click', () => { $('txtGrav').value = C.GRAVEDAD_DEFECTO.join(', '); lsSet(LS_GRAV, ''); });

  $('btnExcel').addEventListener('click', async () => {
    let kmz = estado.kmzModificado;
    if (!kmz) {
      if (!estado.kmzGenerado) { alert('No has subido el KMZ (ANEXO I).\n\nSúbelo para generar el Excel.'); resaltar('dropKmz'); return; }
      if (!confirm('No has subido el KMZ modificado (ANEXO I).\n\n¿Generar el Excel con el KMZ recién generado, sin los cambios que hayas hecho en Google Earth?\n\nAceptar: generar con el recién generado · Cancelar: volver para subir el modificado')) { resaltar('dropKmz'); return; }
      kmz = estado.kmzGenerado;
    }
    const btn = $('btnExcel'); btn.disabled = true; btn.textContent = 'Generando…';
    try {
      const m = modeloDesdeTablas(); // siempre desde las tablas guardadas
      const k = await leerKmz(kmz);
      const an = C.buildAnexo(m, C.parseKml(k.kml), { gravedad: $('txtGrav').value.split(/[\s,;]+/), fotoElegida: estado.fotoElegida });
      const tpl = await JSZip.loadAsync(Uint8Array.from(atob(window.ANEXO_TEMPLATE_B64), c => c.charCodeAt(0)));
      const gx = await C.generarAnexoXlsx(tpl, an, m.ct, lectorImagenes(k.zip));
      an.avisos.push(...gx.avisos);
      if (!k.zip) an.avisos.push('Has subido un .kml: no lleva fotos, así que la columna FOTO queda vacía.');
      const blob = await tpl.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const nombre = `ANEXO III - ${m.ct}.xlsx`;
      descargar(blob, nombre);
      marcarPaso('excel', m.ct);
      const conDef = an.filas.filter(f => f.defec || f.q91x);
      let h = `<div class="res"><div class="ok-box">✔ <b>${esc(nombre)}</b> generado y descargado desde <i>${esc(kmz.nombre)}</i>.</div>
        <div class="chips"><span class="chip">Filas <b>${an.filas.length}</b></span><span class="chip">Con defecto <b>${conDef.length}</b></span><span class="chip">Suma DIST. <b>${C.fmtMiles(an.totalDist)} m</b></span><span class="chip">Fotos en FOTO <b>${gx.nFotos}</b></span><span class="chip">Defectos leídos de <b>${an.fuenteDef}</b></span></div>`;
      const inf = an.informe;
      const [fy, fm, fd] = (inf.fecha || '--').split('-');
      const prov = provinciaCentro(inf.centro);
      h += `<div class="ok-box" id="cajaInforme" style="background:var(--naranja-claro);border-color:#f3c79c">
        <b id="tituloDoc"></b> ${esc(inf.centro)} · fecha ${esc(fd + '/' + fm + '/' + fy)} · ${inf.defectos.length ? inf.defectos.length + ' defecto(s) para la tabla (sin ZOBX)' : 'sin defectos (solo había ZOBX)'}
        <div class="acciones" style="margin-top:8px;align-items:center">
          <label class="info" style="display:flex;gap:6px;align-items:center">Provincia
            <select id="selProv" style="font:inherit;padding:6px 8px;border:1px solid var(--gris-3);border-radius:8px">${PROVS.map(p => `<option${p === prov.nombre ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
          <button id="btnInforme"></button></div>
        <div class="info" id="infoDoc"></div>
        <div class="info">${prov.origen ? 'Provincia tomada de ' + prov.origen + '.' : 'Elige la provincia del centro (no está en GestCD).'}</div></div>`;
      estado.informe = inf;
      h += an.avisos.length ? `<b class="t-aviso">Avisos (${an.avisos.length})</b>${listaAvisos(an.avisos, 't-aviso')}` : '<div class="t-ok">Topología del KMZ coincide con la tabla. Sin avisos.</div>';
      if (an.resumen.length) h += `<details open><summary>Supuestos aplicados</summary>${listaAvisos(an.resumen, '')}</details>`;
      h += `<details><summary>Ver filas del ANEXO III</summary><div class="scroll"><table><tr><th>Nº</th><th>TIPO</th><th>INICIO</th><th>FIN</th><th>SECCIÓN</th><th>DIST.</th><th>DEFEC.</th><th>Q91X</th><th>OBSERVACIONES</th><th>FOTO</th></tr>${an.filas.map(f => `<tr><td>${esc(f.apoyo)}</td><td>${esc(f.tipo)}</td><td>${esc(f.inicio)}</td><td>${esc(f.fin)}</td><td>${esc(f.seccion)}</td><td>${f.dist}</td><td>${esc(f.defec)}</td><td>${esc(f.q91x)}</td><td>${esc(f.obs)}</td><td>${f.fotoVm ? esc(f.fotoSrc.split('/').pop()) + '<br><span class="info">' + esc(f.fotoMotivo) + '</span>' : ''}</td></tr>`).join('')}</table></div></details></div>`;
      $('res2').innerHTML = h;
      const pintarDoc = () => {
        const bol = esBoletin($('selProv').value);
        $('tituloDoc').textContent = bol ? 'Certificado de Revisión BT' : 'Informe BT';
        $('btnInforme').textContent = bol ? 'Enviar al Certificado BT' : 'Enviar al Informe BT';
        $('infoDoc').textContent = bol
          ? 'Abre la app de informes en modo Certificado de Revisión BT (Málaga) con el centro relleno y el técnico de GestCD. Allí revisas dirección, población y técnico, pones la foto del ANEXO I y descargas Word + PDF.'
          : 'Abre la app de informes con el centro relleno. Allí revisas dirección, población y provincia, pones la foto del ANEXO I y descargas Word + PDF.';
      };
      pintarDoc();
      $('selProv').addEventListener('change', () => { lsSet('kmzexcelbt.prov', $('selProv').value); pintarDoc(); });
      $('btnInforme').addEventListener('click', () => {
        const provincia = $('selProv').value;
        const datos = Object.assign({}, estado.informe, { provincia, documento: esBoletin(provincia) ? 'boletin' : 'informe', tecnico: provinciaCentro(estado.informe.centro).tecnico || '' });
        try { localStorage.setItem('jdev_kmz_informe', JSON.stringify(datos)); } catch (e) { alert('No se pudo guardar en este navegador'); return; }
        window.open('../InformesConBT/?kmz=1', 'informesconbt');
      });
    } catch (e) {
      console.error(e); $('res2').innerHTML = `<div class="res"><div class="err-box">${esc(e.message)}</div></div>`;
    } finally { btn.textContent = 'Generar ANEXO III'; actualizarBtnExcel(); }
  });



  // ───────── secciones de los apoyos ─────────
  function selectorSeccion(valor, attrs) {
    const v = C.normSeccion(valor || '');
    const ops = ['<option value="">—</option>'].concat(C.SECCIONES.map(x => `<option${x === v ? ' selected' : ''}>${x}</option>`));
    if (v && !C.SECCIONES.includes(v)) ops.push(`<option selected value="${esc(valor)}">${esc(valor)}</option>`);
    ops.push('<option value="__otra">Otra…</option>');
    return `<select ${attrs}>${ops.join('')}</select>`;
  }
  // Selectores de una fila: la 1ª es la de su salida; luego las de tramos compartidos y las que se añadan con «+ sección»
  function celdaSecciones(f, n) {
    const partes = trim(f.r.seccion).split(/\s*\/\s*/);
    const total = Math.max(n || 0, partes.filter(Boolean).length, 1 + f.compartidas.length, 1);
    let h = '';
    for (let i = 0; i < total; i++) {
      const etiqueta = i === 0 ? '' : (f.compartidas[i - 1] ? `Compartido con ${C.salName(f.compartidas[i - 1].salida)}` : `Sección ${i + 1}`);
      const quitar = i > 0 && !f.compartidas[i - 1] ? '<button type="button" class="sec peq sx" title="Quitar esta sección">×</button>' : '';
      h += i === 0 ? `<div class="comp" style="margin-top:0">${selectorSeccion(partes[0] || '', 'data-p="0"')}<button type="button" class="sec peq smas">+ sección</button></div>`
        : `<div class="comp">${etiqueta}: ${selectorSeccion(partes[i] || '', `data-p="${i}"`)}${quitar}</div>`;
    }
    return h;
  }
  function pintarSecciones() {
    const zona = $('secciones');
    if (!$('detSecc').open) return;
    let m = null;
    try { if ($('txtMain').value.trim()) m = modeloDesdeTablas(); } catch (e) { m = null; }
    if (!m) { zona.innerHTML = '<div class="info">Pega primero la tabla de posiciones.</div>'; return; }
    const filas = C.filasSecciones(m);
    estado.secc = { m, filas };
    const salidas = [...new Set(filas.map(f => f.salida))].sort((a, b) => a - b);
    const varios = new Set(filas.map(f => f.cuadro)).size > 1;
    let h = `<div class="secc-bulk"><b style="width:100%;font-size:13px">Poner la misma sección a varios apoyos seguidos</b>
      <label>Salida<select id="sbSal">${salidas.map(s => `<option value="${s}">${C.salName(s)}</option>`).join('')}</select></label>
      <label>Desde apoyo<input id="sbDe" type="number" min="1"></label><label>Hasta apoyo<input id="sbA" type="number" min="1"></label>
      <label>Sección${selectorSeccion('', 'id="sbSec"')}</label><button class="peq" id="btnSecBulk">Aplicar</button></div>`;
    h += `<div class="scroll"><table class="tsec"><tr><th>Apoyo</th><th>Salida</th><th>Sección</th></tr>` + filas.map((f, i) => `<tr data-i="${i}"><td><b>${esc(f.apoyo)}</b> <span class="info">${esc(f.r.node.name)}</span></td><td>${varios ? 'C' + f.cuadro + ' ' : ''}${C.salName(f.salida)}</td><td>${celdaSecciones(f)}</td></tr>`).join('') + '</table></div>';
    h += '<div class="info">Los cambios se escriben en la tabla de posiciones (columna SECCIÓN) y salen en el KMZ y en el ANEXO III. Con varias secciones en un apoyo la celda queda como «RZ95 / RZ50» (la de su salida primero).</div>';
    zona.innerHTML = h;
  }
  // Repinta la celda con una sección más, conservando lo elegido
  function celdaSeccionesDesde(f, tr, n) {
    const actual = [...tr.querySelectorAll('select')].map(s => s.value === '__otra' ? '' : s.value);
    const falso = { r: { seccion: actual.join(' / ') }, compartidas: f.compartidas };
    const html = celdaSecciones(falso, n);
    // los huecos vacíos se respetan: se rellenan por posición
    const tmp = document.createElement('td'); tmp.innerHTML = html;
    [...tmp.querySelectorAll('select')].forEach((s, i) => { if (actual[i] !== undefined && [...s.options].some(o => o.value === actual[i])) s.value = actual[i]; });
    return tmp.innerHTML;
  }
  function guardarSecciones(cambios) {
    const m = estado.secc.m;
    const txt = C.editarTabla($('txtMain').value, m, cambios);
    $('txtMain').value = txt; lsSet(LS.main, txt);
  }
  function valorFila(tr) {
    return [...tr.querySelectorAll('select')].map(s => s.value === '__otra' ? '' : s.value.trim()).filter(Boolean).join(' / ');
  }
  $('secciones').addEventListener('change', e => {
    const sel = e.target.closest('select'); if (!sel) return;
    if (sel.value === '__otra') {
      const v = prompt('Escribe la sección:', '');
      if (v && v.trim()) { const o = document.createElement('option'); o.value = o.textContent = C.normSeccion(v); sel.insertBefore(o, sel.lastElementChild); sel.value = o.value; }
      else { sel.value = ''; }
    }
    if (sel.id === 'sbSec') return;
    const tr = sel.closest('tr[data-i]'); if (!tr) return;
    const f = estado.secc.filas[+tr.dataset.i];
    guardarSecciones([{ r: f.r, seccion: valorFila(tr) }]);
    tr.classList.add('mod');
  });
  $('secciones').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-i]');
    if (tr && e.target.classList.contains('smas')) {
      const f = estado.secc.filas[+tr.dataset.i];
      const n = tr.querySelectorAll('select').length + 1;
      tr.cells[2].innerHTML = celdaSeccionesDesde(f, tr, n);
      return;
    }
    if (tr && e.target.classList.contains('sx')) {
      e.target.closest('.comp').remove();
      const f = estado.secc.filas[+tr.dataset.i];
      guardarSecciones([{ r: f.r, seccion: valorFila(tr) }]); tr.classList.add('mod');
      tr.cells[2].innerHTML = celdaSeccionesDesde(f, tr, tr.querySelectorAll('select').length); // renumerar etiquetas
      return;
    }
    if (e.target.id !== 'btnSecBulk') return;
    const sal = +$('sbSal').value, de = +$('sbDe').value, a = +$('sbA').value, sec = $('sbSec').value === '__otra' ? '' : $('sbSec').value;
    if (!de || !a || !sec) return alert('Pon desde qué apoyo, hasta cuál y la sección.');
    const [lo, hi] = de <= a ? [de, a] : [a, de];
    const cambios = estado.secc.filas.filter(f => f.salida === sal && +f.apoyo >= lo && +f.apoyo <= hi).map(f => {
      const resto = trim(f.r.seccion).split(/\s*\/\s*/).slice(1);
      return { r: f.r, seccion: [sec].concat(resto).filter((x, i) => i === 0 || x).join(' / ') };
    });
    if (!cambios.length) return alert('No hay apoyos en ese rango.');
    guardarSecciones(cambios); pintarSecciones();
    $('secciones').querySelectorAll('tr[data-i]').forEach(tr => { const f = estado.secc.filas[+tr.dataset.i]; if (f.salida === sal && +f.apoyo >= lo && +f.apoyo <= hi) tr.classList.add('mod'); });
  });
  const trim = s => String(s == null ? '' : s).trim();
  $('detSecc').addEventListener('toggle', pintarSecciones);

  // ───────── numeración de apoyos: huecos, repetidos y renumeración ─────────
  const lsJson = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  function mapaTotal() { return lsJson(LS.mapa, {}); }
  function renombrar(nombre) {
    const m = mapaTotal(), ks = Object.keys(m).sort((a, b) => b.length - a.length);
    if (!ks.length) return nombre;
    const re = new RegExp('(?<!\\d)(' + ks.join('|') + ')(?!\\d)', 'g');
    return String(nombre).replace(re, x => m[x]);
  }
  function pintarNumeracion() {
    const zona = $('numeracion');
    let m = null;
    try { if ($('txtMain').value.trim()) m = modeloDesdeTablas(); } catch (e) { m = null; }
    const mapa = mapaTotal(), nCamb = Object.keys(mapa).filter(k => mapa[k] !== k).length;
    let h = '';
    if (nCamb) {
      h += `<div class="num-box ok" style="margin-bottom:8px">✔ Renumeración aplicada: ${nCamb} apoyo${nCamb === 1 ? '' : 's'} con número nuevo (tabla, defectos y fotos).
        <button class="sec peq" id="btnDeshacerNum">Deshacer</button> ${estado.fotos.length ? '<button class="sec peq" id="btnZipRen">Descargar fotos renombradas</button>' : ''}
        ${estado.avisoRegenerar ? '<br><b>Vuelve a generar el KMZ</b>: el que tenías es de antes del cambio.' : ''}</div>`;
    }
    if (!m) { zona.innerHTML = h; enganchar(); return; }
    const problemas = C.analizarNumeracion(m);
    const salidas = [...new Set(m.nodes.filter(n => !n.esPT).map(n => n.cuadro + '|' + n.salida))].map(k => k.split('|').map(Number));
    if (!problemas.length) h += `<div class="num-box ok">✔ Numeración de apoyos sin huecos ni repetidos.</div>`;
    else {
      h += '<div class="num-box"><b>Revisa la numeración de los apoyos</b>';
      problemas.forEach(g => {
        const nom = g.seguida ? `Cuadro ${g.cuadro} (numeración seguida entre salidas)` : (salidas.some(x => x[0] !== g.cuadro) ? `Cuadro ${g.cuadro} · ` : '') + C.salName(g.salida);
        const txt = [];
        if (g.faltan.length) txt.push(`falta${g.faltan.length > 1 ? 'n' : ''} el${g.faltan.length > 1 ? ' los' : ''} ${g.faltan.join(', ')} (${g.total} apoyos numerados hasta el ${g.max})`);
        if (g.repetidos.length) txt.push(`número${g.repetidos.length > 1 ? 's' : ''} repetido${g.repetidos.length > 1 ? 's' : ''}: ${g.repetidos.join(', ')} (corrígelo en la tabla)`);
        const prop = g.faltan.length && !g.repetidos.length ? C.propuestaCompactar(m, g.cuadro, g.salida) : [];
        h += `<div class="num-g">• <b>${nom}</b>: ${txt.join('; ')}.` + (prop.length ? ` <button class="peq" data-compactar="${g.cuadro}|${g.salida == null ? '' : g.salida}">Quitar huecos (${prop[0].node.apoyo}–${prop[prop.length - 1].node.apoyo} → ${prop[0].nuevo}–${prop[prop.length - 1].nuevo})</button>` : '') + '</div>';
      });
      h += '</div>';
    }
    h += `<details style="margin-top:6px"><summary>Cambiar el número de un apoyo a mano</summary><div class="num-man">
      <label>Salida<select id="nmSal">${salidas.map(([c, sa]) => `<option value="${c}|${sa}">${salidas.some(x => x[0] !== c) ? 'C' + c + ' ' : ''}${C.salName(sa)}</option>`).join('')}</select></label>
      <label>Apoyo actual<input id="nmDe" type="number" min="1"></label>
      <label>Número nuevo<input id="nmA" type="number" min="1"></label>
      <label style="flex-direction:row;align-items:center;gap:6px;width:auto"><input id="nmSig" type="checkbox" style="width:auto"> y los siguientes también</label>
      <button class="peq" id="btnNumMan">Aplicar</button></div></details>`;
    zona.innerHTML = h; enganchar();
    function enganchar() {
      zona.querySelectorAll('[data-compactar]').forEach(b => b.onclick = () => { const [c, sa] = b.dataset.compactar.split('|'); const mm = modeloDesdeTablas(); aplicarRenumeracion(mm, C.propuestaCompactar(mm, +c, sa === '' ? null : +sa)); });
      if ($('btnNumMan')) $('btnNumMan').onclick = () => {
        const [c, sa] = $('nmSal').value.split('|').map(Number), de = +$('nmDe').value, a = +$('nmA').value;
        if (!de || !a) return alert('Pon el número actual y el nuevo.');
        const mm = modeloDesdeTablas();
        const prop = C.propuestaCambio(mm, c, sa, de, a, $('nmSig').checked);
        if (!prop.length) return alert(`No hay ningún apoyo ${de} en esa salida.`);
        aplicarRenumeracion(mm, prop);
      };
      if ($('btnDeshacerNum')) $('btnDeshacerNum').onclick = deshacerRenumeracion;
      if ($('btnZipRen')) $('btnZipRen').onclick = zipRenombradas;
    }
  }
  function aplicarRenumeracion(m, prop) {
    const r = C.renumerar(m, $('txtMain').value, $('txtDef').value, prop);
    if (r.errores.length) return alert('No se puede aplicar:\n' + r.errores.join('\n'));
    const lista = prop.slice(0, 12).map(x => `${x.node.apoyo}→${x.nuevo}`).join(', ') + (prop.length > 12 ? '…' : '');
    if (!confirm(`Se van a cambiar ${prop.length} apoyo${prop.length === 1 ? '' : 's'} (${lista}).\n\nSe actualizan los números y los INICIO/FIN de la tabla, los códigos de la tabla de defectos y el nombre de las fotos con el código del apoyo nuevo.\n\n¿Seguir?`)) return;
    if (!lsGet(LS.orig)) lsSet(LS.orig, JSON.stringify({ main: $('txtMain').value, def: $('txtDef').value }));
    // componer con lo ya aplicado: original → actual
    const tot = mapaTotal(), vals = new Set(Object.values(tot));
    Object.keys(tot).forEach(k => { if (r.mapa[tot[k]]) tot[k] = r.mapa[tot[k]]; });
    Object.keys(r.mapa).forEach(k => { if (!vals.has(k) && !(k in tot)) tot[k] = r.mapa[k]; });
    lsSet(LS.mapa, JSON.stringify(tot));
    $('txtMain').value = r.mainText; $('txtDef').value = r.defText; lsSet(LS.main, r.mainText); lsSet(LS.def, r.defText);
    infoTabla($('txtMain'), 'infoMain'); infoTabla($('txtDef'), 'infoDef');
    estado.fotos.forEach(f => { f.nombre = renombrar(f.orig); });
    estado.fotoElegida = {}; pintarSecciones();
    if (estado.kmzGenerado) { estado.avisoRegenerar = true; if (estado.kmzModificado === estado.kmzGenerado) estado.kmzModificado = null; estado.kmzGenerado = null; $('btnUsarGenerado').hidden = true; $('res1').innerHTML = ''; actualizarBtnExcel(); }
    pintarNumeracion();
  }
  function deshacerRenumeracion() {
    const o = lsJson(LS.orig, null); if (!o) return;
    if (!confirm('¿Volver a la numeración original? Se restauran las tablas y los nombres de las fotos.')) return;
    $('txtMain').value = o.main; $('txtDef').value = o.def; lsSet(LS.main, o.main); lsSet(LS.def, o.def);
    try { localStorage.removeItem(LS.orig); localStorage.removeItem(LS.mapa); } catch (e) {}
    infoTabla($('txtMain'), 'infoMain'); infoTabla($('txtDef'), 'infoDef');
    estado.fotos.forEach(f => { f.nombre = f.orig; }); estado.fotoElegida = {};
    pintarNumeracion(); pintarSecciones();
  }
  async function zipRenombradas() {
    const z = new JSZip();
    for (const f of estado.fotos) z.file(f.nombre, await f.leer(), { compression: 'STORE' });
    let ct = ''; try { ct = modeloDesdeTablas().ct; } catch (e) {}
    descargar(await z.generateAsync({ type: 'blob' }), `Fotos renombradas${ct ? ' - ' + ct : ''}.zip`);
  }
  pintarNumeracion(); estado.mapaListo = true; actualizarBtnExcel();

  // ───────── PWA y aviso de versión nueva ─────────
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  async function comprobarVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const v = (await r.json()).version;
      if (v && v !== APP_VERSION) $('banner').classList.add('on');
    } catch (e) { /* sin conexión */ }
  }
  $('btnActualizar').addEventListener('click', async () => {
    const b = $('btnActualizar'); b.disabled = true; b.textContent = 'Actualizando…';
    try {
      // 1) descargar de nuevo los archivos de la app saltándose la caché del navegador
      const archivos = ['./', 'index.html', 'js/app.js', 'js/core.js', 'js/template.js', 'vendor/jszip.min.js', 'sw.js', 'manifest.webmanifest'];
      await Promise.all(archivos.map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
      // 2) borrar la copia sin conexión y actualizar el service worker
      const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.update().catch(() => {})));
      }
    } catch (e) {}
    // 3) recargar pidiendo la página nueva
    location.replace(location.pathname + '?v=' + Date.now());
  });
  if (/[?&]v=\d+/.test(location.search)) history.replaceState(null, '', location.pathname);
  comprobarVersion(); setInterval(comprobarVersion, 30 * 60 * 1000);
  window.__APP_VERSION = APP_VERSION;
})();
