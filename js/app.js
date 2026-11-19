/* Interfaz de KMZ + ANEXO III Red BT */
(function () {
  'use strict';
  const APP_VERSION = '1.1.0';
  const C = window.Core;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const estado = { fotos: [], kmzGenerado: null, kmzModificado: null, modelo: null };

  // ───────── persistencia de las tablas (solo texto) ─────────
  const LS = { main: 'kmzexcelbt.main', def: 'kmzexcelbt.def', suf: 'kmzexcelbt.suf1' };
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
  $('txtMain').value = lsGet(LS.main);
  $('txtDef').value = lsGet(LS.def);
  $('chkSuf1').checked = lsGet(LS.suf) === '1';
  const infoTabla = (ta, info) => { const n = C.splitTable(ta.value).length; $(info).textContent = n ? n + ' filas' : ''; };
  [['txtMain', 'infoMain', LS.main], ['txtDef', 'infoDef', LS.def]].forEach(([ta, info, k]) => {
    $(ta).addEventListener('input', () => { lsSet(k, $(ta).value); infoTabla($(ta), info); });
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
      try { $(ta).value = await leerTabla(f); lsSet(k, $(ta).value); infoTabla($(ta), info); $(info).textContent += ' · ' + f.name; }
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
            if (/\.(jpe?g|png|gif|webp)$/i.test(path)) estado.fotos.push({ nombre: path, leer: () => entry.async('uint8array') });
          });
        } catch (e) { alert('No se pudo abrir ' + f.name + ': ' + e.message); }
      } else if (/\.(jpe?g|png|gif|webp)$/i.test(f.name)) {
        estado.fotos.push({ nombre: f.name, leer: async () => new Uint8Array(await f.arrayBuffer()) });
      }
    }
    pintarFotos();
  }
  function pintarFotos() {
    $('infoFotos').textContent = estado.fotos.length ? estado.fotos.length + ' fotos cargadas.' : 'Sin fotos.';
    $('btnQuitarFotos').hidden = !estado.fotos.length;
  }
  zonaDrop($('dropFotos'), $('fFotos'), anadirFotos);
  $('btnQuitarFotos').addEventListener('click', () => { estado.fotos = []; pintarFotos(); });

  $('btnNuevo').addEventListener('click', () => {
    if (!confirm('¿Empezar un proyecto nuevo? Se borran las tablas, las fotos y los KMZ cargados.')) return;
    $('txtMain').value = ''; $('txtDef').value = ''; lsSet(LS.main, ''); lsSet(LS.def, '');
    estado.fotos = []; estado.kmzGenerado = null; estado.kmzModificado = null; estado.modelo = null;
    pintarFotos(); $('res1').innerHTML = ''; $('res2').innerHTML = ''; $('infoMain').textContent = ''; $('infoDef').textContent = '';
    $('infoKmz').textContent = 'Ningún KMZ cargado.'; $('btnUsarGenerado').hidden = true; actualizarBtnExcel();
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

  function modeloDesdeTablas() {
    const main = C.splitTable($('txtMain').value);
    if (!main.length) throw new Error('Falta la tabla de posiciones.');
    return C.buildModel(main, C.splitTable($('txtDef').value), {});
  }

  // ───────── PASO 1: KMZ ─────────
  $('btnKmz').addEventListener('click', async () => {
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
      estado.kmzGenerado = { blob, nombre }; estado.modelo = m;
      descargar(blob, nombre);
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
    h += `<details><summary>Distancias por salida</summary><table><tr><th>Salida</th><th>Metros (suma de tramos)</th></tr>${Object.entries(d.porSalida).map(([s, v]) => `<tr><td>${s}</td><td>${C.fmtMiles(v)}</td></tr>`).join('')}<tr><th>Total red</th><th>${C.fmtMiles(d.total)}</th></tr></table></details>`;
    if (m.defectos.length) h += `<details><summary>Defectos asignados (${m.defectos.length})</summary><div class="scroll"><table><tr><th>Código</th><th>Descripción</th><th>Apoyo</th><th>Cómo se asoció</th><th>Distancia</th><th>Fotos</th></tr>${m.defectos.map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.desc)}</td><td>${esc(x.node.esPT ? x.node.name : x.node.code)}</td><td>${esc(x.metodo)}</td><td class="${x.lejos ? 't-aviso' : ''}">${x.dist == null ? '' : C.fmtMiles(x.dist) + ' m'}</td><td>${x.fotos.length}</td></tr>`).join('')}</table></div></details>`;
    if (ph.huerfanas.length) h += `<details open><summary class="t-aviso">Fotos sin asociar (${ph.huerfanas.length})</summary>${listaAvisos(ph.huerfanas.map(x => x.nombre + ' — ' + x.motivo), 't-aviso')}</details>`;
    h += vistaPrevia(m) + '</div>';
    $('res1').innerHTML = h;
  }

  // ───────── PASO 2: ANEXO III ─────────
  function actualizarBtnExcel() { $('btnExcel').disabled = !(estado.kmzModificado || estado.kmzGenerado); }
  zonaDrop($('dropKmz'), $('fKmz'), files => {
    const f = files.find(x => /\.(kmz|kml)$/i.test(x.name)); if (!f) { alert('Elige un archivo .kmz o .kml'); return; }
    estado.kmzModificado = { blob: f, nombre: f.name };
    $('infoKmz').textContent = 'KMZ cargado: ' + f.name; actualizarBtnExcel();
  });
  $('btnUsarGenerado').addEventListener('click', () => {
    estado.kmzModificado = estado.kmzGenerado;
    $('infoKmz').textContent = 'Usando el KMZ recién generado (sin modificar): ' + estado.kmzGenerado.nombre; actualizarBtnExcel();
  });

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
  $('txtGrav').addEventListener('input', () => lsSet(LS_GRAV, $('txtGrav').value));
  $('btnGravDef').addEventListener('click', () => { $('txtGrav').value = C.GRAVEDAD_DEFECTO.join(', '); lsSet(LS_GRAV, ''); });

  $('btnExcel').addEventListener('click', async () => {
    const btn = $('btnExcel'); btn.disabled = true; btn.textContent = 'Generando…';
    try {
      const kmz = estado.kmzModificado || estado.kmzGenerado;
      if (!kmz) throw new Error('Carga primero el KMZ modificado.');
      const m = modeloDesdeTablas(); // siempre desde las tablas guardadas
      const k = await leerKmz(kmz);
      const an = C.buildAnexo(m, C.parseKml(k.kml), { gravedad: $('txtGrav').value.split(/[\s,;]+/) });
      const tpl = await JSZip.loadAsync(Uint8Array.from(atob(window.ANEXO_TEMPLATE_B64), c => c.charCodeAt(0)));
      const gx = await C.generarAnexoXlsx(tpl, an, m.ct, lectorImagenes(k.zip));
      an.avisos.push(...gx.avisos);
      if (!k.zip) an.avisos.push('Has subido un .kml: no lleva fotos, así que la columna FOTO queda vacía.');
      const blob = await tpl.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const nombre = `ANEXO III - ${m.ct}.xlsx`;
      descargar(blob, nombre);
      const conDef = an.filas.filter(f => f.defec || f.q91x);
      let h = `<div class="res"><div class="ok-box">✔ <b>${esc(nombre)}</b> generado y descargado desde <i>${esc(kmz.nombre)}</i>.</div>
        <div class="chips"><span class="chip">Filas <b>${an.filas.length}</b></span><span class="chip">Con defecto <b>${conDef.length}</b></span><span class="chip">Suma DIST. <b>${C.fmtMiles(an.totalDist)} m</b></span><span class="chip">Fotos en FOTO <b>${gx.nFotos}</b></span><span class="chip">Defectos leídos de <b>${an.fuenteDef}</b></span></div>`;
      h += an.avisos.length ? `<b class="t-aviso">Avisos (${an.avisos.length})</b>${listaAvisos(an.avisos, 't-aviso')}` : '<div class="t-ok">Topología del KMZ coincide con la tabla. Sin avisos.</div>';
      if (an.resumen.length) h += `<details open><summary>Supuestos aplicados</summary>${listaAvisos(an.resumen, '')}</details>`;
      h += `<details><summary>Ver filas del ANEXO III</summary><div class="scroll"><table><tr><th>Nº</th><th>TIPO</th><th>INICIO</th><th>FIN</th><th>SECCIÓN</th><th>DIST.</th><th>DEFEC.</th><th>Q91X</th><th>OBSERVACIONES</th><th>FOTO</th></tr>${an.filas.map(f => `<tr><td>${esc(f.apoyo)}</td><td>${esc(f.tipo)}</td><td>${esc(f.inicio)}</td><td>${esc(f.fin)}</td><td>${esc(f.seccion)}</td><td>${f.dist}</td><td>${esc(f.defec)}</td><td>${esc(f.q91x)}</td><td>${esc(f.obs)}</td><td>${f.fotoVm ? esc(f.fotoSrc.split('/').pop()) + '<br><span class="info">' + esc(f.fotoMotivo) + '</span>' : ''}</td></tr>`).join('')}</table></div></details></div>`;
      $('res2').innerHTML = h;
    } catch (e) {
      console.error(e); $('res2').innerHTML = `<div class="res"><div class="err-box">${esc(e.message)}</div></div>`;
    } finally { btn.textContent = 'Generar ANEXO III'; actualizarBtnExcel(); }
  });

  // ───────── PWA y aviso de versión nueva ─────────
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  async function comprobarVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const v = (await r.json()).version;
      if (v && v !== APP_VERSION) $('banner').classList.add('on');
    } catch (e) { /* sin conexión */ }
  }
  $('btnActualizar').addEventListener('click', async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.update())); } catch (e) {}
    location.reload();
  });
  comprobarVersion(); setInterval(comprobarVersion, 30 * 60 * 1000);
  window.__APP_VERSION = APP_VERSION;
})();
