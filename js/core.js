/* KMZ + ANEXO III RED BT — lógica pura (sin DOM). Sigue los prompts maestros:
 *  - PROMPT MAESTRO KMZ RED BT v4
 *  - PROMPT MAESTRO ANEXO III (14 columnas con Q91X)
 * Funciona en navegador (window.Core) y en Node (module.exports) para poder testearla.
 */
(function (root) {
  'use strict';

  // ───────────────────────── utilidades ─────────────────────────
  const deaccent = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const trim = s => String(s == null ? '' : s).replace(/ /g, ' ').trim();
  const isInt = s => /^\d+$/.test(trim(s));
  const pad2 = n => String(n).padStart(2, '0');
  const upperEs = s => String(s).toLocaleUpperCase('es-ES');
  const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escHtml = escXml;
  const cdata = s => '<![CDATA[' + String(s).split(']]>').join(']]]]><![CDATA[>') + ']]>';
  const fmtMiles = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  function haversine(a, b) {
    const R = 6371008.8, rad = Math.PI / 180;
    const f1 = a.lat * rad, f2 = b.lat * rad, df = (b.lat - a.lat) * rad, dl = (b.lon - a.lon) * rad;
    const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function parseCoords(s) {
    s = trim(s);
    if (!s) return null;
    const m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  const looksDate = s => /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(trim(s));
  function excelSerialToDate(v) {
    const n = parseFloat(v);
    if (!(n > 20000 && n < 80000)) return null;
    const d = new Date(Math.round((n - 25569) * 86400000));
    return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }

  // Tabla de texto pegada (tabuladores) o CSV con ';'
  function splitTable(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const sep = /\t/.test(text) ? '\t' : ';';
    return lines.filter(l => l.trim() !== '').map(l => l.split(sep));
  }

  // ───────────────────────── clasificación ─────────────────────────
  // Tipo de elemento para la simbología KMZ
  function claseTipo(tipo) {
    const t = upperEs(deaccent(tipo)).trim();
    if (/^(PT|CT|CD)\b|^PT_?CD|^PT\/CD/.test(t)) return 'PT';
    if (/POSTECILLO|^POST\b/.test(t)) return 'POST';
    if (/G\s*\/\s*PAL|GANCHO|GACHO|PALOMETA|PALOMILLA|^G$/.test(t)) return 'GPAL';
    return 'APOYO';
  }
  // Normalización TIPO para el ANEXO III
  function normTipo(tipo) {
    const t = upperEs(deaccent(tipo)).trim();
    if (!t) return '';
    if (['MET', 'H', 'M', 'POST', 'CRUC', 'G', 'PT'].includes(t)) return t;
    if (/^(PT|CT|CD)\b|^PT_?CD/.test(t)) return 'PT';
    if (/POSTECILLO/.test(t)) return 'POST';
    if (/G\s*\/\s*PAL|GANCHO|GACHO|PALOMETA|PALOMILLA/.test(t)) return 'G';
    if (/CRUCETA/.test(t)) return 'CRUC';
    if (/METALIC/.test(t)) return 'MET';
    if (/HORMIGON/.test(t)) return 'H';
    if (/MADERA/.test(t)) return 'M';
    return null;
  }
  const RE_CGP = /\bC(?:GP|PM)S?\b/i;
  const tieneCGP = s => RE_CGP.test(deaccent(s));

  // Código de defecto: ZOBX_Q91X, ZOBX o código de 4 caracteres con algún dígito (Q92Y, L62X, G56X…)
  function esCodigoDefecto(s) {
    s = trim(s).toUpperCase();
    return s === 'ZOBX_Q91X' || s === 'ZOBX' || (/^[A-Z][A-Z0-9]{3}$/.test(s) && /\d/.test(s));
  }
  function inferirCodigo(texto) {
    const m = trim(texto).match(/^(ZOBX_Q91X|ZOBX|[A-Z][A-Z0-9]{3})(?![A-Za-z0-9])[\s\-:.,]*(.*)$/);
    if (m && esCodigoDefecto(m[1])) return { codigo: m[1], resto: m[2] };
    return null;
  }

  // ───────────────────────── tabla principal ─────────────────────────
  // FECHA · CT · CUADRO · SALIDA · NºAPOYO · TIPO · INICIO · FIN · SECCIÓN · DIST · OBSERVACIONES · COD DE DEFECTO · DEFECTO · MAPA
  function parseMain(rows) {
    const out = [], avisos = [];
    rows.forEach((raw, i) => {
      const f = raw.map(trim);
      if (!f.some(x => x)) return;
      let off = 0;
      if (isInt(f[0]) && (looksDate(f[1]) || excelSerialToDate(f[1])) ) off = 1; // numeración de fila
      const g = k => f[off + k] == null ? '' : f[off + k];
      if (/FECHA|APOYO/i.test(g(0)) || /^CT$/i.test(g(1))) return; // cabecera
      if (!isInt(g(1))) { avisos.push(`Fila ${i + 1} de la tabla principal ignorada (CT no numérico: "${g(1)}").`); return; }
      let fecha = g(0);
      const fs = !looksDate(fecha) && excelSerialToDate(fecha); if (fs) fecha = fs;
      out.push({
        n: out.length, linea: i + 1, fecha, ct: g(1), cuadro: g(2), salida: g(3), apoyo: g(4), tipo: g(5),
        inicio: g(6), fin: g(7), seccion: g(8), dist: g(9), obs: g(10), cod: g(11), defecto: g(12),
        mapaTxt: g(13), mapa: parseCoords(g(13)), raw, off, idxRaw: i
      });
    });
    return { filas: out, avisos };
  }

  // ───────────────────────── tabla de defectos ─────────────────────────
  // Campos no vacíos en orden: TIPO, CT, CÓDIGO, TEXTO, RUTA, NOMBRE IMAGEN, MAPA, extras…
  function parseDefects(rows) {
    const out = [], avisos = [];
    rows.forEach((raw, i) => {
      const f = raw.map(trim).filter(x => x !== '' && !x.includes('@'));
      if (!f.length) return;
      if (f.length && isInt(f[0]) && f[0].length <= 3 && !isInt(f[1] || 'x')) f.shift(); // numeración
      if (f.some(x => /^C[OÓ]DIGO|^DESCRIPCI/i.test(x))) return; // cabecera
      let ic = -1;
      for (let k = 0; k < f.length; k++) if (esCodigoDefecto(f[k])) { ic = k; break; }
      let codigo = '', desc = '';
      if (ic >= 0) {
        codigo = f[ic].toUpperCase();
        const d = f[ic + 1];
        if (d && !parseCoords(d) && !/[\\/]|\.(jpe?g|png)$/i.test(d)) desc = d;
      } else {
        for (const x of f) { const inf = inferirCodigo(x); if (inf) { codigo = inf.codigo; desc = inf.resto; break; } }
      }
      if (!codigo) { avisos.push(`Fila ${i + 1} de la tabla de defectos sin código de defecto reconocible: se ignora.`); return; }
      const ctIdx = f.findIndex((x, k) => k < (ic < 0 ? f.length : ic) && /^\d{3,6}$/.test(x));
      const coords = f.map(parseCoords).find(Boolean) || null;
      const explicitos = f.filter(x => /^\d{7,}[A-Z0-9_]*$/i.test(x) || /^(\d+_){2,3}\d+(_[A-Z0-9_]+)?$/i.test(x));
      out.push({ linea: i + 1, tipo: ic > 0 ? f[0] : '', ct: ctIdx >= 0 ? f[ctIdx] : '', codigo, desc, coords, explicitos, origen: 'tabla de defectos' });
    });
    return { defectos: out, avisos };
  }

  // ───────────────────────── modelo de red ─────────────────────────
  const nodeKey = (c, s, a) => `${+c}|${+s}|${+a}`;

  function buildModel(mainRows, defectRows, opts) {
    opts = opts || {};
    const avisos = [], notas = [];
    const pm = parseMain(mainRows); avisos.push(...pm.avisos);
    const filas = pm.filas;
    if (!filas.length) throw new Error('La tabla principal no tiene filas válidas.');

    // CT dominante y erratas
    const cnt = {}; filas.forEach(r => cnt[r.ct] = (cnt[r.ct] || 0) + 1);
    const ct = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    filas.forEach(r => { if (r.ct !== ct) { avisos.push(`Errata de CT en la fila ${r.linea}: "${r.ct}" normalizado a ${ct}.`); r.ctOriginal = r.ct; r.ct = ct; } });

    // Nodos
    const nodes = []; const byKey = {};
    let pt = null;
    filas.forEach(r => {
      const clase = claseTipo(r.tipo);
      const esPT = clase === 'PT' || (r.cuadro !== '' && +r.cuadro === 0 && +r.salida === 0 && +r.apoyo === 0);
      r.esPT = esPT;
      const key = esPT ? 'PT' : nodeKey(r.cuadro, r.salida, r.apoyo);
      if (byKey[key]) { avisos.push(`Apoyo duplicado en la tabla (fila ${r.linea}, ${key === 'PT' ? 'PT/CT' : 'apoyo ' + r.apoyo}): se usa la primera aparición para el mapa.`); r.node = byKey[key]; return; }
      const prefijoPT = /^CT/i.test(deaccent(r.tipo).trim()) ? 'CT' : 'PT';
      const code = esPT ? ct + '000000' : ct + pad2(+r.cuadro) + pad2(+r.salida) + pad2(+r.apoyo);
      const node = {
        key, row: r, esPT, clase: esPT ? 'PT' : clase, ct, cuadro: +r.cuadro || 0, salida: +r.salida || 0, apoyo: +r.apoyo || 0,
        code, ptCode: ct,
        name: esPT ? prefijoPT + ct : (clase === 'POST' || clase === 'GPAL' ? String(+r.apoyo) : code),
        coords: r.mapa, cgp: tieneCGP(r.tipo) || tieneCGP(r.obs), defectos: [], fotos: [], fotosCGP: []
      };
      if (!r.mapa) avisos.push(`Sin coordenadas válidas en la fila ${r.linea} (${node.name}): no se puede dibujar.`);
      nodes.push(node); byKey[key] = node; r.node = node; if (esPT) pt = node;
    });
    if (!pt) avisos.push('No se ha encontrado la fila del PT/CT (TIPO PT_CD o cuadro/salida/apoyo 0). Los tramos con INICIO 0 no se pueden dibujar.');

    const findNode = (tok, r) => {
      tok = trim(tok);
      if (tok === '' || tok === '0') return pt;
      if (!isInt(tok)) return null;
      const a = +tok;
      const own = byKey[nodeKey(r.cuadro, r.salida, a)];
      if (own) return own;
      const sameC = nodes.filter(n => !n.esPT && n.cuadro === +r.cuadro && n.apoyo === a);
      if (sameC.length === 1) return sameC[0];
      const any = nodes.filter(n => !n.esPT && n.apoyo === a);
      if (any.length === 1) return any[0];
      return null;
    };

    // Tramos INICIO → FIN literales
    const tramos = [];
    filas.forEach(r => {
      if (r.esPT) return;
      const i = trim(r.inicio), f = trim(r.fin);
      if (f === '') { avisos.push(`Fila ${r.linea} (apoyo ${r.apoyo}) sin FIN: sin tramo propio.`); return; }
      if ((i === '' ? '0' : i) === f || (i !== '' && f !== '' && +i === +f)) {
        notas.push(`Apoyo ${r.node.name}: INICIO=FIN (${i || 0}-${f}), se representa como marcador suelto sin tramo.`);
        r.sinTramo = true; return;
      }
      const a = findNode(i, r), b = findNode(f, r);
      if (!a || !b) { avisos.push(`Tramo ${i || 0}→${f} de la fila ${r.linea} (SAL${pad2(+r.salida)}): ${!a ? 'INICIO' : 'FIN'} no existe en la tabla. No se dibuja.`); return; }
      if (!b.esPT && b !== r.node && +f !== +r.apoyo) notas.push(`Fila ${r.linea}: FIN (${f}) distinto del Nº de apoyo propio (${r.apoyo}); se usa el par literal.`);
      if (b.salida && +r.salida && b.salida !== +r.salida && !b.esPT) notas.push(`Fila ${r.linea}: el tramo une SAL${pad2(+r.salida)} con un apoyo de SAL${pad2(b.salida)} (se deja tal cual).`);
      if (!a.esPT && a.salida !== +r.salida) notas.push(`Fila ${r.linea}: parte del apoyo ${a.name} de SAL${pad2(a.salida)} (tramo común/cambio de salida, se deja tal cual).`);
      const t = { row: r, a, b, cuadro: +r.cuadro, salida: +r.salida, dist: null };
      if (a.coords && b.coords) t.dist = haversine(a.coords, b.coords);
      else avisos.push(`Tramo ${a.name}→${b.name}: falta alguna coordenada, no se dibuja.`);
      tramos.push(t);
    });

    // Defectos: columnas de la tabla principal + tabla secundaria
    const defs = [];
    filas.forEach(r => {
      const codes = [];
      trim(r.cod).split(/[\s,;\/]+/).filter(Boolean).forEach(c => { if (esCodigoDefecto(c)) codes.push(c.toUpperCase()); });
      let desc = trim(r.defecto);
      if (!codes.length && desc) { const inf = inferirCodigo(desc); if (inf) { codes.push(inf.codigo); desc = inf.resto; } }
      else if (desc) { const inf = inferirCodigo(desc); if (inf && codes.includes(inf.codigo)) desc = inf.resto; }
      codes.forEach(c => defs.push({ codigo: c, desc, node: r.node, metodo: 'tabla principal', dist: 0, origen: 'tabla principal', linea: r.linea }));
    });
    const pd = parseDefects(defectRows || []); avisos.push(...pd.avisos);
    pd.defectos.forEach(d => {
      let node = null, metodo = '';
      for (const ex of d.explicitos) {
        let digits = null, c, s, a;
        const us = ex.match(/^(?:(\d+)_)?(\d+)_(\d+)_(\d+)/);
        if (/_/.test(ex) && us) { c = +us[2]; s = +us[3]; a = +us[4]; }
        else {
          digits = ex.match(/^\d+/)[0];
          if (digits.startsWith(ct)) {
            const rest = digits.slice(ct.length);
            if (/^0*$/.test(rest)) { node = pt; metodo = 'código explícito (PT/CT)'; break; }
            if (rest.length >= 6) { c = +rest.slice(0, 2); s = +rest.slice(2, 4); a = +rest.slice(4); }
          }
        }
        if (c != null) {
          if (c === 0 && s === 0 && a === 0) { node = pt; metodo = 'código explícito (PT/CT)'; break; }
          const n = byKey[nodeKey(c, s, a)];
          if (n) { node = n; metodo = 'código explícito ' + ex; break; }
        }
      }
      if (!node && d.coords) {
        let best = null, bd = Infinity;
        nodes.forEach(n => { if (n.coords) { const x = haversine(n.coords, d.coords); if (x < bd) { bd = x; best = n; } } });
        if (best) { node = best; metodo = 'proximidad'; }
      }
      if (!node) { avisos.push(`Defecto ${d.codigo} (fila ${d.linea} de defectos) sin apoyo asociado: no hay código ni coordenadas válidas.`); return; }
      const dist = d.coords && node.coords ? haversine(node.coords, d.coords) : null;
      // evitar duplicar un defecto que ya venía en la tabla principal
      if (defs.some(x => x.node === node && x.codigo === d.codigo && x.origen === 'tabla principal' && (!x.desc || upperEs(x.desc) === upperEs(d.desc)))) {
        const x = defs.find(x => x.node === node && x.codigo === d.codigo && x.origen === 'tabla principal'); if (!x.desc) x.desc = d.desc; return;
      }
      defs.push({ codigo: d.codigo, desc: d.desc, node, metodo, dist, origen: 'tabla de defectos', linea: d.linea, coords: d.coords });
    });
    defs.forEach(d => {
      d.lejos = d.dist != null && d.dist > 100;
      if (d.lejos) avisos.push(`Defecto ${d.codigo} asociado a ${d.node.name}: sus coordenadas están a ${fmtMiles(d.dist)} m del apoyo (revisar).`);
      d.fotos = [];
      d.node.defectos.push(d);
    });

    const model = { ct, pt, nodes, byKey, filas, tramos, defectos: defs, avisos, notas, opts, compartidos: [], findNode };
    aplicarCompartidos(model, opts.compartidos || '');
    return model;
  }




  // ───────────────────────── secciones ─────────────────────────
  const SECCIONES = ['RZ150', 'RZ95', 'RZ50', 'RZ25', 'RZ2X25', 'RZ2X16', 'RZ2X10', 'CU2X6', 'CU2X10', 'AL2X6', 'AL2X10', 'CU3X6', 'CU3X10', 'AL3X6', 'AL3X10', 'CU4X6', 'CU4X10', 'AL4X6', 'AL4X10', '2X6', '2X10', '2X16', '3X6', '3X10', '3X16', '4X6', '4X10', '4X16'];
  // Filas para el editor: sección propia y, si su tramo lo comparten otras salidas, la de cada una ("RZ95 / RZ50")
  function filasSecciones(model) {
    const comp = new Map();
    (model.compartidos || []).forEach(c => { const r = c.tramo.row; if (!comp.has(r)) comp.set(r, []); comp.get(r).push(c.salida); });
    return model.filas.filter(r => !r.esPT && r === r.node.row).map(r => {
      const extra = (comp.get(r) || []).slice();
      const partes = trim(r.seccion).split(/\s*\/\s*/);
      return { r, salida: +r.salida, cuadro: +r.cuadro, apoyo: r.apoyo, partes: partes.filter(Boolean), propia: partes[0] || '', compartidas: extra.map((s, i) => ({ salida: s, seccion: partes[i + 1] || '' })) };
    });
  }
  // Cambia celdas de la tabla principal manteniendo el resto del texto
  function editarTabla(mainText, model, cambios) {
    const sep = /\t/.test(mainText) ? '\t' : ';';
    const porIdx = new Map(model.filas.map(r => [r.idxRaw, r]));
    const porFila = new Map(cambios.map(c => [c.r, c]));
    const lineas = String(mainText).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
    return lineas.map((l, i) => {
      const r = porIdx.get(i), c = r && porFila.get(r);
      if (!c) return l;
      const f = l.split(sep);
      while (f.length <= r.off + 8) f.push('');
      f[r.off + 8] = c.seccion;
      return f.join(sep);
    }).join('\n');
  }
  const normSeccion = s => upperEs(deaccent(s)).replace(/\s+/g, '').replace(/[*×]/g, 'X');

  // ───────────────────────── numeración de apoyos ─────────────────────────
  // Huecos y repetidos por cuadro/salida (los apoyos deberían ir 1, 2, 3… sin saltos)
  // ¿La numeración de un cuadro sigue de una salida a otra (SAL01 1-5, SAL02 6-11…) o empieza en 1 en cada salida?
  function numeracionSeguida(model, cuadro) {
    const ns = model.nodes.filter(n => !n.esPT && n.cuadro === cuadro);
    const sals = [...new Set(ns.map(n => n.salida))];
    if (sals.length < 2) return false;
    const salidaDe = new Map(); let cruzan = false;
    ns.forEach(n => { if (salidaDe.has(n.apoyo) && salidaDe.get(n.apoyo) !== n.salida) cruzan = true; salidaDe.set(n.apoyo, n.salida); });
    if (cruzan) return false; // el mismo número en dos salidas → cada salida empieza en 1
    return sals.some(sa => !ns.some(n => n.salida === sa && n.apoyo === 1));
  }
  // Huecos y repetidos: por salida, o por cuadro si la numeración sigue entre salidas
  function analizarNumeracion(model) {
    const out = [];
    const cuadros = [...new Set(model.nodes.filter(n => !n.esPT).map(n => n.cuadro))].sort((a, b) => a - b);
    cuadros.forEach(cu => {
      const seguida = numeracionSeguida(model, cu);
      const grupos = {};
      model.filas.forEach(r => {
        if (r.esPT || !isInt(r.apoyo) || +r.cuadro !== cu) return;
        const k = seguida ? 'todo' : String(+r.salida);
        (grupos[k] = grupos[k] || { cuadro: cu, salida: seguida ? null : +r.salida, seguida, nums: [] }).nums.push(+r.apoyo);
      });
      Object.values(grupos).sort((a, b) => (a.salida || 0) - (b.salida || 0)).forEach(g => {
        const set = new Set(g.nums), max = Math.max(...g.nums);
        const faltan = []; for (let i = 1; i <= max; i++) if (!set.has(i)) faltan.push(i);
        const rep = [...new Set(g.nums.filter((n, i) => g.nums.indexOf(n) !== i))];
        if (faltan.length || rep.length) out.push({ cuadro: g.cuadro, salida: g.salida, seguida: g.seguida, total: g.nums.length, max, faltan, repetidos: rep });
      });
    });
    return out;
  }
  // Propuesta para quitar los huecos: cada apoyo pasa a su posición en orden (1..N), en la salida o en todo el cuadro
  function propuestaCompactar(model, cuadro, salida) {
    const ns = model.nodes.filter(n => !n.esPT && n.cuadro === cuadro && (salida == null || n.salida === salida)).sort((a, b) => a.apoyo - b.apoyo);
    return ns.map((n, i) => ({ node: n, nuevo: i + 1 })).filter(x => x.nuevo !== x.node.apoyo);
  }
  // Propuesta manual: el apoyo 'de' pasa a ser 'a' (y, si 'siguientes', los posteriores se desplazan igual).
  // Con numeración seguida entre salidas, "los siguientes" son los de todo el cuadro.
  function propuestaCambio(model, cuadro, salida, de, a, siguientes) {
    const d = a - de, seguida = numeracionSeguida(model, cuadro);
    return model.nodes.filter(n => !n.esPT && n.cuadro === cuadro && (siguientes ? n.apoyo >= de && (seguida || n.salida === salida) : n.apoyo === de && n.salida === salida)).map(n => ({ node: n, nuevo: n.apoyo + d }));
  }
  // Aplica la renumeración a los textos de las tablas. Devuelve los textos nuevos y el mapa de códigos viejo → nuevo.
  function renumerar(model, mainText, defText, cambios) {
    const nuevoDe = new Map(cambios.map(c => [c.node, c.nuevo]));
    // comprobación de choques en cada salida
    const errores = [];
    const grupos = new Set(cambios.map(c => `${c.node.cuadro}|${c.node.salida}`));
    grupos.forEach(g => {
      const [cu, sa] = g.split('|').map(Number);
      const finales = model.nodes.filter(n => !n.esPT && n.cuadro === cu && n.salida === sa).map(n => nuevoDe.has(n) ? nuevoDe.get(n) : n.apoyo);
      const dup = finales.filter((x, i) => finales.indexOf(x) !== i);
      if (dup.length) errores.push(`En ${salName(sa)} quedarían repetidos los números ${[...new Set(dup)].join(', ')}.`);
      if (finales.some(x => x < 1)) errores.push(`En ${salName(sa)} quedaría algún número de apoyo menor que 1.`);
    });
    [...new Set(cambios.map(c => c.node.cuadro))].forEach(cu => {
      if (!numeracionSeguida(model, cu)) return;
      const finales = model.nodes.filter(n => !n.esPT && n.cuadro === cu).map(n => nuevoDe.has(n) ? nuevoDe.get(n) : n.apoyo);
      const dup = finales.filter((x, i) => finales.indexOf(x) !== i);
      if (dup.length) errores.push(`La numeración sigue entre salidas y quedarían repetidos los números ${[...new Set(dup)].join(', ')}.`);
    });
    if (errores.length) return { errores: [...new Set(errores)] };
    const mapa = {};
    cambios.forEach(c => { const n = c.node; mapa[n.code] = model.ct + pad2(n.cuadro) + pad2(n.salida) + pad2(c.nuevo); });
    const claves = Object.keys(mapa).sort((a, b) => b.length - a.length);
    const re = claves.length ? new RegExp('(?<!\\d)(' + claves.join('|') + ')(?!\\d)', 'g') : null;
    const cambiarCodigos = t => re ? String(t).replace(re, m => mapa[m]) : String(t);
    const sepM = /\t/.test(mainText) ? '\t' : ';', sepD = /\t/.test(defText) ? '\t' : ';';
    const tramoDe = new Map(model.tramos.map(t => [t.row, t]));
    const lineasM = String(mainText).replace(/\r\n?/g, '\n').split('\n');
    const tabla = lineasM.filter(l => l.trim() !== '');
    // índice de línea de texto no vacía → fila del modelo
    const porIdx = new Map(model.filas.map(r => [r.idxRaw, r]));
    const nuevasM = tabla.map((l, i) => {
      const f = l.split(sepM).map(cambiarCodigos);
      const r = porIdx.get(i);
      if (r && !r.esPT) {
        const o = r.off, num = x => String(x);
        if (nuevoDe.has(r.node) && r === r.node.row) f[o + 4] = num(nuevoDe.get(r.node));
        const t = tramoDe.get(r);
        const ref = (tok, node) => { if (!node || node.esPT || !nuevoDe.has(node)) return tok; return trim(tok) === '' ? tok : num(nuevoDe.get(node)); };
        if (t) { f[o + 6] = ref(f[o + 6], t.a); f[o + 7] = ref(f[o + 7], t.b); }
        else {
          const ni = model.findNode(r.inicio, r), nf = model.findNode(r.fin, r);
          f[o + 6] = ref(f[o + 6], ni); f[o + 7] = ref(f[o + 7], nf);
        }
      }
      return f.join(sepM);
    });
    const nuevasD = String(defText || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.split(sepD).map(cambiarCodigos).join(sepD));
    return { mainText: nuevasM.join('\n'), defText: nuevasD.join('\n'), mapa, cambiarCodigos, errores: [] };
  }

  // ───────────────────────── tramos compartidos entre salidas ─────────────────────────
  // Una línea por indicación: "1-6 SAL02"  ·  "SAL01 1-6 SAL02"  ·  "0-3 SAL02 SAL03"
  // = los tramos del camino entre esos apoyos (por la red de la tabla) también los lleva SAL02 (y SAL03):
  // se dibuja una línea paralela del color de esa salida.
  function aplicarCompartidos(model, texto) {
    const lineas = String(texto || '').split(/\r?\n/).map(trim).filter(Boolean);
    const padre = new Map(); model.tramos.forEach(t => { if (t.dist != null && !padre.has(t.b)) padre.set(t.b, t); });
    const nodoPor = (num, sal) => {
      if (+num === 0) return model.pt;
      const c = model.nodes.filter(n => !n.esPT && n.apoyo === +num && (sal == null || n.salida === sal));
      return c.length === 1 ? c[0] : (c.length > 1 ? 'ambiguo' : null);
    };
    const camino = (desde, hasta) => { // sube desde 'hasta' por sus padres hasta llegar a 'desde'
      const out = []; let n = hasta, guard = 0;
      while (n && n !== desde && guard++ < 5000) { const t = padre.get(n); if (!t) return null; out.unshift(t); n = t.a; }
      return n === desde ? out : null;
    };
    const usosPorTramo = new Map();
    model.adicionales = [];
    const tramoEntre = (a, b) => model.tramos.find(t => t.dist != null && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
    const marcarCompartido = (t, sd) => {
      const usos = usosPorTramo.get(t) || []; if (usos.includes(sd)) return false;
      usos.push(sd); usosPorTramo.set(t, usos);
      model.compartidos.push({ tramo: t, salida: sd, orden: usos.length });
      return true;
    };
    lineas.forEach(l => {
      const L = deaccent(l).toUpperCase().replace(/\s+/g, ' ');
      // Modo recorrido: "SAL03: 0, 12, 7, 13, 14" → la salida pasa por esos apoyos en ese orden
      const rec = L.match(/^SAL(?:IDA)?\s*0*(\d+)\s*[:=]?\s*((?:\d+\s*[,;\-–\s]\s*)+\d+)\s*$/);
      if (rec) {
        const sd = +rec[1];
        const nums = rec[2].split(/[^\d]+/).filter(Boolean).map(Number);
        const nodos = []; let mal = false;
        nums.forEach((num, i) => {
          if (mal) return;
          let n = nodoPor(num, sd);
          if (n === null || n === 'ambiguo') {
            const todos = num === 0 ? [model.pt] : model.nodes.filter(x => !x.esPT && x.apoyo === num);
            const prev = nodos[i - 1];
            const vecinos = prev ? todos.filter(x => tramoEntre(prev, x)) : [];
            n = todos.length === 1 ? todos[0] : (vecinos.length === 1 ? vecinos[0] : (todos.length ? 'ambiguo' : null));
          }
          if (!n) { model.avisos.push(`Recorrido "${l}": el apoyo ${num} no está en la tabla.`); mal = true; return; }
          if (n === 'ambiguo') { model.avisos.push(`Recorrido "${l}": el apoyo ${num} existe en varias salidas y no sé cuál es. Revisa la numeración.`); mal = true; return; }
          nodos.push(n);
        });
        if (mal || nodos.length < 2) { if (!mal) model.avisos.push(`Recorrido "${l}": pon al menos dos apoyos.`); return; }
        let nComp = 0, nAd = 0;
        for (let i = 1; i < nodos.length; i++) {
          const a = nodos[i - 1], b = nodos[i];
          if (!a.coords || !b.coords || a === b) continue;
          const t = tramoEntre(a, b);
          if (t && t.salida === sd) continue;              // ya es un tramo de esta salida
          if (t) { if (marcarCompartido(t, sd)) nComp++; continue; } // tramo de otra salida → paralela
          if (!model.adicionales.some(x => x.salida === sd && ((x.a === a && x.b === b) || (x.a === b && x.b === a)))) {
            model.adicionales.push({ a, b, salida: sd, cuadro: +(a.esPT ? b : a).cuadro || 1, dist: haversine(a.coords, b.coords) }); nAd++;
          }
        }
        model.notas.push(`Recorrido de ${salName(sd)}: ${nodos.map(n => n.esPT ? 0 : n.apoyo).join('-')} → ${nComp} tramo${nComp === 1 ? '' : 's'} compartido${nComp === 1 ? '' : 's'} (paralela) y ${nAd} tramo${nAd === 1 ? '' : 's'} nuevo${nAd === 1 ? '' : 's'} que no estaba${nAd === 1 ? '' : 'n'} en la tabla.`);
        return;
      }
      const sals = [...L.matchAll(/SAL(?:IDA)?\s*0*(\d+)/g)].map(m => +m[1]);
      const ap = L.replace(/SAL(?:IDA)?\s*0*\d+/g, ' ').match(/(\d+)\s*(?:-|–|A|AL|HASTA)\s*(\d+)/);
      if (!ap || !sals.length) { model.avisos.push(`No entiendo "${l}". Escribe el recorrido de la salida, por ejemplo "SAL03: 0, 12, 7, 13", o un tramo compartido como "1-6 SAL02".`); return; }
      const conOrigen = /^(?:DE\s+|EN\s+)?SAL(?:IDA)?\s*0*\d+\s*[:,]?\s*(?:DEL?\s+|APOYOS?\s+)?\d/.test(L) && sals.length > 1;
      const origen = conOrigen ? sals[0] : null; const destinos = conOrigen ? sals.slice(1) : sals;
      let A = nodoPor(ap[1], origen), B = nodoPor(ap[2], origen);
      if ((A === 'ambiguo' || B === 'ambiguo') && origen == null) {
        // sin salida de origen: probar las salidas que no son destino y quedarse con la única que tenga ese camino
        const opciones = [...new Set(model.nodes.filter(n => !n.esPT).map(n => n.salida))].filter(x => !destinos.includes(x)).map(sal => {
          const a = nodoPor(ap[1], sal), b = nodoPor(ap[2], sal);
          return a && b && a !== 'ambiguo' && b !== 'ambiguo' && ((camino(a, b) || camino(b, a) || []).length) ? [a, b] : null;
        }).filter(Boolean);
        if (opciones.length === 1) [A, B] = opciones[0];
      }
      if (A === 'ambiguo' || B === 'ambiguo') { model.avisos.push(`Tramo compartido "${l}": hay varios apoyos con ese número en distintas salidas. Indica la salida de origen, por ejemplo "SAL01 ${ap[1]}-${ap[2]} ${salName(destinos[0])}".`); return; }
      if (!A || !B) { model.avisos.push(`Tramo compartido "${l}": el apoyo ${!A ? ap[1] : ap[2]} no está en la tabla.`); return; }
      let ts = camino(A, B) || camino(B, A);
      if (!ts || !ts.length) { model.avisos.push(`Tramo compartido "${l}": no hay un camino de línea entre esos dos apoyos en la tabla.`); return; }
      destinos.forEach(sd => {
        let n = 0;
        ts.forEach(t => { if (t.salida !== sd && marcarCompartido(t, sd)) n++; });
        model.notas.push(`Tramo compartido: ${salName(sd)} también va por ${A.name} → ${B.name} (${n} tramo${n === 1 ? '' : 's'}, línea paralela).`);
      });
    });
  }
  // Desplaza un segmento 'metros' a su izquierda (en el sentido a→b)
  function paralela(a, b, metros) {
    const lat0 = (a.lat + b.lat) / 2 * Math.PI / 180, mLat = 111320, mLon = 111320 * Math.cos(lat0);
    const dx = (b.lon - a.lon) * mLon, dy = (b.lat - a.lat) * mLat, L = Math.hypot(dx, dy) || 1;
    const ox = -dy / L * metros, oy = dx / L * metros;
    return [{ lat: a.lat + oy / mLat, lon: a.lon + ox / mLon }, { lat: b.lat + oy / mLat, lon: b.lon + ox / mLon }];
  }
  // Líneas que van por el mismo tramo: una al lado de otra en orden de salida (SAL01, SAL02, SAL03…),
  // centradas sobre el tramo. Con 2 líneas, 1,5 m entre ellas; con más, se juntan para que el haz no pase de 3 m.
  function desplazamiento(posicion, totalLineas) {
    if (totalLineas <= 1) return 0;
    const sep = totalLineas <= 3 ? 1.5 : 3 / (totalLineas - 1);
    return ((totalLineas - 1) / 2 - posicion) * sep; // positivo = a la izquierda: SAL01 queda a la izquierda mirando desde el PT
  }
  // Carril de cada salida: en cada tramo de salidas compartidas, las líneas de un mismo recorrido común
  // (tramos seguidos que comparten apoyos) tienen un carril fijo según su número de salida, para que no salten en los apoyos.
  function carriles(model) {
    if (model._carriles) return model._carriles;
    const conComp = model.tramos.filter(t => model.compartidos.some(c => c.tramo === t));
    const padre = new Map(conComp.map(t => [t, t]));
    const raiz = t => { while (padre.get(t) !== t) t = padre.get(t); return t; };
    const porNodo = new Map();
    conComp.forEach(t => [t.a, t.b].forEach(n => { if (porNodo.has(n)) padre.set(raiz(t), raiz(porNodo.get(n))); else porNodo.set(n, t); }));
    const salidas = new Map(), tramosGrupo = new Map();
    conComp.forEach(t => {
      const r = raiz(t); if (!salidas.has(r)) { salidas.set(r, new Set()); tramosGrupo.set(r, []); }
      const S = salidas.get(r); S.add(t.salida); tramosGrupo.get(r).push(t);
      model.compartidos.filter(c => c.tramo === t).forEach(c => S.add(c.salida));
    });
    // Orden de los carriles: por número de salida, pero las que se desvían a la izquierda van a la izquierda
    // (la que se desvía antes, más por fuera) y las que se desvían a la derecha, a la derecha. Así no se cruzan.
    const vec = (p, q) => ({ x: (q.lon - p.lon) * Math.cos(p.lat * Math.PI / 180), y: q.lat - p.lat });
    const prof = n => { let k = 0, x = n; const pad = new Map(model.tramos.filter(t => t.dist != null).map(t => [t.b, t])); while (x && pad.has(x) && k < 5000) { x = pad.get(x).a; k++; } return k; };
    const lineasDe = sal => {
      const L = [];
      model.tramos.forEach(t => { if (t.dist != null && t.salida === sal) L.push({ a: t.a, b: t.b, t }); });
      model.compartidos.forEach(c => { if (c.salida === sal) L.push({ a: c.tramo.a, b: c.tramo.b, t: c.tramo }); });
      (model.adicionales || []).forEach(x => { if (x.salida === sal) L.push({ a: x.a, b: x.b, t: null }); });
      return L;
    };
    const ordenes = new Map();
    salidas.forEach((S, r) => {
      const enGrupo = new Set(tramosGrupo.get(r));
      const info = [...S].map(sal => {
        const L = lineasDe(sal), dentro = L.filter(l => l.t && enGrupo.has(l.t)), fuera = L.filter(l => !l.t || !enGrupo.has(l.t));
        const nodosDentro = new Set(); dentro.forEach(l => { nodosDentro.add(l.a); nodosDentro.add(l.b); });
        let lado = 0, donde = Infinity;
        fuera.forEach(l => {
          const X = nodosDentro.has(l.a) ? l.a : (nodosDentro.has(l.b) ? l.b : null); if (!X || !X.coords) return;
          const Y = X === l.a ? l.b : l.a; if (!Y || !Y.coords) return;
          const entra = dentro.find(d => d.b === X) || dentro.find(d => d.a === X); if (!entra || !entra.a.coords || !entra.b.coords) return;
          const [p, q] = entra.b === X ? [entra.a, entra.b] : [entra.b, entra.a];
          const u = vec(p.coords, q.coords), v = vec(X.coords, Y.coords);
          const cruz = u.x * v.y - u.y * v.x, ang = Math.atan2(cruz, u.x * v.x + u.y * v.y) * 180 / Math.PI;
          if (Math.abs(ang) < 20) return; // sigue recto
          const d = prof(X); if (d < donde) { donde = d; lado = ang > 0 ? -1 : 1; } // -1 izquierda, +1 derecha
        });
        return { sal, lado, donde };
      });
      const izq = info.filter(i => i.lado < 0).sort((a, b) => a.donde - b.donde || a.sal - b.sal);
      const cen = info.filter(i => i.lado === 0).sort((a, b) => a.sal - b.sal);
      const der = info.filter(i => i.lado > 0).sort((a, b) => b.donde - a.donde || a.sal - b.sal);
      ordenes.set(r, izq.concat(cen, der).map(i => i.sal));
    });
    model._carriles = t => { if (!padre.has(t)) return null; return ordenes.get(raiz(t)); };
    return model._carriles;
  }
  function posicionEnTramo(model, t, sal) {
    const S = carriles(model)(t);
    if (!S) return { pos: 0, total: 1 };
    return { pos: S.indexOf(sal), total: S.length };
  }



  // ───────────────────────── fotografías ─────────────────────────
  // Asocia cada fichero a apoyo / CGP / defecto según su nombre.
  function asociarFotos(model, nombres, opts) {
    opts = opts || {};
    const codeMap = {};
    model.nodes.forEach(n => { codeMap[n.code] = n; if (n.esPT) codeMap[n.ptCode] = n; });
    const huerfanas = []; let asociadas = 0;
    const sortKey = s => s.replace(/\d+/g, d => d.padStart(6, '0'));
    const items = [];
    nombres.forEach(full => {
      const base = full.split(/[\\/]/).pop();
      const m = base.match(/^(\d+)(.*?)\.(jpe?g|png|gif|webp)$/i);
      if (!m) { if (/\.(jpe?g|png|gif|webp)$/i.test(base)) huerfanas.push({ nombre: full, motivo: 'el nombre no empieza por un código de apoyo' }); return; }
      const node = codeMap[m[1]];
      if (!node) { huerfanas.push({ nombre: full, motivo: m[1].startsWith(model.ct) ? `el código ${m[1]} no coincide con ningún apoyo de la tabla (¿tabla incompleta o errata?)` : `código ${m[1]} desconocido` }); return; }
      let suf = m[2].replace(/^[\s._-]+/, '');
      items.push({ full, base, node, suf });
    });
    items.forEach(it => {
      const { node, suf } = it;
      const codes = [...new Set(node.defectos.map(d => d.codigo))].sort((a, b) => b.length - a.length);
      const sufU = suf.toUpperCase();
      const dc = codes.find(c => sufU === c || sufU.startsWith(c + '_') || sufU.startsWith(c + '.') || sufU.startsWith(c + ' ') || sufU.startsWith(c + '-'));
      let destino;
      if (dc) destino = { tipo: 'defecto', codigo: dc };
      else if (/^(?:IMAGEN\s*)?CGP[-_ ]?C[GP]M\b/i.test(suf) || /^CGP\b|^CPM\b/i.test(suf)) destino = { tipo: 'cgp' };
      else if (suf === '' || /^IMAGEN\s*GENERAL/i.test(suf)) destino = { tipo: 'general' };
      else if (/^\d+$/.test(suf)) destino = opts.sufijo1EsCGP && +suf === 1 ? { tipo: 'cgp' } : { tipo: 'general' };
      else if (esCodigoDefecto(sufU.split(/[_.\s-]/)[0]) || sufU.startsWith('ZOBX')) {
        huerfanas.push({ nombre: it.full, motivo: `foto de defecto ${sufU.split(/[.\s-]/)[0]} pero ${node.name} no tiene ese defecto en las tablas` }); return;
      } else { huerfanas.push({ nombre: it.full, motivo: `sufijo "${suf}" no reconocido` }); return; }
      it.sk = sortKey(suf);
      if (destino.tipo === 'general') node.fotos.push(it);
      else if (destino.tipo === 'cgp') {
        if (!node.cgp) model.notas.push(`Foto de CGP/CPM ${it.base} en ${node.name}, que no tiene CGP/CPM en TIPO ni en OBSERVACIONES: se muestra en su popup.`);
        (node.cgp ? node.fotosCGP : node.fotos).push(it);
      } else {
        const d = node.defectos.find(x => x.codigo === destino.codigo); d.fotos.push(it);
      }
      asociadas++;
    });
    const byS = (a, b) => a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0;
    model.nodes.forEach(n => { n.fotos.sort(byS); n.fotosCGP.sort(byS); });
    model.defectos.forEach(d => d.fotos.sort(byS));
    const total = asociadas + huerfanas.length;
    model.fotos = { asociadas, total, huerfanas };
    huerfanas.forEach(h => model.avisos.push(`Foto sin asociar: ${h.nombre} — ${h.motivo}.`));
    return model.fotos;
  }

  // ───────────────────────── KML ─────────────────────────
  const SAL_COLORS = ['ff0000ff', 'ffff0000', 'ff00b400', 'ff00ffff', 'ffee82ee', 'ff7aa2c8', 'ff0080ff', 'ffffff00', 'ff8000ff', 'ff808080'];
  const SAL_HEX = ['#ff0000', '#0000ff', '#00b400', '#ffff00', '#ee82ee', '#c8a27a', '#ff8000', '#00ffff', '#ff0080', '#808080'];
  const salColor = s => SAL_COLORS[(Math.max(1, s) - 1) % SAL_COLORS.length];
  const salHex = s => SAL_HEX[(Math.max(1, s) - 1) % SAL_HEX.length];
  const salName = s => 'SAL' + pad2(s);
  const ICON = p => 'http://maps.google.com/mapfiles/kml/' + p;

  function styleIcon(id, href, hot, color) {
    return `\t<Style id="${id}">\n\t\t<IconStyle>\n${color ? `\t\t\t<color>${color}</color>\n` : ''}\t\t\t<scale>1.2</scale>\n\t\t\t<Icon>\n\t\t\t\t<href>${href}</href>\n\t\t\t</Icon>\n\t\t\t${hot}\n\t\t</IconStyle>\n\t\t<LabelStyle>\n\t\t\t<scale>0.9</scale>\n\t\t</LabelStyle>\n\t</Style>\n`;
  }
  const HOT_PIN = '<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>';
  const HOT_C = '<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>';
  const HOT_FLAG = '<hotSpot x="0.5" y="0" xunits="fraction" yunits="fraction"/>';
  const HOT_PAD = '<hotSpot x="32" y="1" xunits="pixels" yunits="pixels"/>';

  const coordStr = c => `${c.lon},${c.lat},0`;
  const imgs = (fotos, nameOf) => fotos.map(f => `<img src="files/${nameOf(f)}" width="420"/>`).join('<br/>');

  function popupNodo(n, nameOf) {
    const r = n.row, L = [];
    const add = (k, v) => { if (trim(v) !== '') L.push(`<b>${k}:</b> ${escHtml(v)}`); };
    add('Tipo de apoyo', r.tipo);
    add('PT/CT', n.ct);
    if (!n.esPT) { add('Cuadro', r.cuadro === '' ? '' : String(+r.cuadro)); add('Salida', r.salida === '' ? '' : salName(+r.salida)); add('Nº apoyo', r.apoyo === '' ? '' : String(+r.apoyo)); }
    add('Sección', r.seccion);
    add('Distancia', r.dist ? r.dist + ' m' : '');
    add('Observaciones', r.obs);
    let h = L.join('<br/>') + '<br/>';
    if (n.fotos.length) h += '<br/>' + imgs(n.fotos, nameOf);
    if (n.cgp) h += '<b>CGP/CPM:</b> Sí<br/>'; // mismo orden que el KMZ de referencia
    return h;
  }
  function popupCGP(n, nameOf) {
    let h = '<b>CGP/CPM:</b> Sí<br/>';
    if (trim(n.row.obs)) h += `<b>Observaciones:</b> ${escHtml(n.row.obs)}<br/>`;
    if (n.fotosCGP.length) h += '<br/>' + imgs(n.fotosCGP, nameOf);
    return h;
  }
  function popupDef(d, nameOf) {
    let h = `<b>Código de defecto:</b> ${escHtml(d.codigo)}<br/>`;
    if (trim(d.desc)) h += `<b>Descripción:</b> ${escHtml(d.desc)}<br/>`;
    h += `<b>Apoyo asociado:</b> ${escHtml(d.node.esPT ? d.node.name : d.node.code)}<br/>`;
    if (d.lejos) h += `<b>Aviso:</b> las coordenadas del defecto están a ${fmtMiles(d.dist)} m del apoyo asociado.<br/>`;
    if (d.fotos.length) h += '<br/>' + imgs(d.fotos, nameOf);
    return h;
  }

  function placemark(ind, name, desc, style, c, id) {
    return `${ind}<Placemark${id ? ` id="${id}"` : ''}>\n${ind}\t<name>${escXml(name)}</name>\n${desc != null ? `${ind}\t<description>${cdata(desc)}</description>\n` : ''}${ind}\t<styleUrl>#${style}</styleUrl>\n${ind}\t<Point>\n${ind}\t\t<coordinates>${coordStr(c)}</coordinates>\n${ind}\t</Point>\n${ind}</Placemark>\n`;
  }

  function leyendaFilas(model) {
    const ns = model.nodes.filter(n => n.coords);
    const rows = [{ k: 'APOYO' }, { k: 'APOYO_CGP' }, { k: 'CGP' }];
    if (ns.some(n => n.clase === 'POST')) rows.push({ k: 'POST' });
    if (ns.some(n => n.clase === 'GPAL')) rows.push({ k: 'GPAL' });
    const dc = model.defectos.filter(d => d.node.coords).map(d => d.codigo);
    if (dc.some(c => c !== 'ZOBX' && c !== 'ZOBX_Q91X')) rows.push({ k: 'DEF' });
    if (dc.includes('ZOBX')) rows.push({ k: 'ZOBX' });
    if (dc.includes('ZOBX_Q91X')) rows.push({ k: 'Q91X' });
    [...new Set(model.tramos.filter(t => t.dist != null).map(t => t.salida).concat((model.compartidos || []).map(c => c.salida), (model.adicionales || []).map(x => x.salida)))].sort((a, b) => a - b).forEach(s => rows.push({ k: 'SAL', salida: s, color: salHex(s), label: salName(s) }));
    const labels = { APOYO: 'APOYO', APOYO_CGP: 'APOYO CON CGP/CPM', CGP: 'CGP/CPM', POST: 'POST', GPAL: 'G/PAL', DEF: 'DEFECTO', ZOBX: 'ZOBX', Q91X: 'ZOBX_Q91X' };
    rows.forEach(r => { if (!r.label) r.label = labels[r.k]; });
    return rows;
  }

  // nameOf(foto) → nombre del fichero dentro de files/
  function buildKml(model, nameOf, legend) {
    nameOf = nameOf || (f => f.base);
    const ptName = model.pt ? model.pt.name : 'PT' + model.ct;
    let k = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">\n<Document>\n\t<name>ANEXO I - ${escXml(model.ct)}</name>\n\t<open>1</open>\n`;
    k += styleIcon('sApoyo', ICON('pushpin/ylw-pushpin.png'), HOT_PIN);
    k += styleIcon('sApoyoCGP', ICON('pushpin/grn-pushpin.png'), HOT_PIN);
    k += styleIcon('sPost', ICON('pushpin/ltblu-pushpin.png'), HOT_PIN);
    k += styleIcon('sPT', ICON('pushpin/red-pushpin.png'), HOT_PIN);
    k += styleIcon('sCGP', ICON('shapes/placemark_circle.png'), HOT_C, 'ff006400');
    k += styleIcon('sGPal', ICON('shapes/square.png'), HOT_C, 'ffff0000');
    k += styleIcon('sDef', ICON('shapes/flag.png'), HOT_FLAG, 'ff0000ff');
    k += styleIcon('sZOBX', ICON('paddle/red-diamond.png'), HOT_PAD);
    k += styleIcon('sQ91X', ICON('paddle/blu-diamond.png'), HOT_PAD);
    const salidas = [...new Set(model.tramos.map(t => t.salida).concat((model.compartidos || []).map(c => c.salida), (model.adicionales || []).map(x => x.salida)))].sort((a, b) => a - b);
    salidas.forEach(s => { k += `\t<Style id="sSAL${pad2(s)}">\n\t\t<LineStyle>\n\t\t\t<color>${salColor(s)}</color>\n\t\t\t<width>2</width>\n\t\t</LineStyle>\n\t</Style>\n`; });

    // APOYOS
    k += '\t<Folder>\n\t\t<name>APOYOS</name>\n';
    const ordenados = [...model.nodes].sort((a, b) => (b.esPT - a.esPT) || a.row.n - b.row.n);
    ordenados.forEach(n => {
      if (!n.coords) return;
      const st = n.esPT ? 'sPT' : n.clase === 'POST' ? 'sPost' : n.clase === 'GPAL' ? 'sGPal' : n.cgp ? 'sApoyoCGP' : 'sApoyo';
      k += placemark('\t\t', n.name, popupNodo(n, nameOf), st, n.coords, 'n_' + (n.esPT ? 'PT' : n.cuadro + '_' + n.salida + '_' + n.apoyo));
    });
    k += '\t</Folder>\n';

    // SALIDAS
    k += '\t<Folder>\n\t\t<name>SALIDAS</name>\n';
    const cuadros = [...new Set(model.tramos.map(t => t.cuadro))];
    const grupos = {};
    model.tramos.forEach(t => { if (t.dist == null) return; const g = (cuadros.length > 1 ? `CUADRO ${pad2(t.cuadro)} - ` : '') + salName(t.salida); (grupos[g] = grupos[g] || { s: t.salida, c: t.cuadro, t: [] }).t.push(t); });
    (model.adicionales || []).forEach(x => { const g = (cuadros.length > 1 ? `CUADRO ${pad2(x.cuadro)} - ` : '') + salName(x.salida); (grupos[g] = grupos[g] || { s: x.salida, c: x.cuadro, t: [] }).t.push({ a: x.a, b: x.b, salida: x.salida, adicional: true }); });
    (model.compartidos || []).forEach(c => { const t = c.tramo; const g = (cuadros.length > 1 ? `CUADRO ${pad2(t.cuadro)} - ` : '') + salName(c.salida); (grupos[g] = grupos[g] || { s: c.salida, c: t.cuadro, t: [] }).t.push({ a: t.a, b: t.b, salida: c.salida, compartido: c }); });
    Object.keys(grupos).sort((a, b) => grupos[a].c - grupos[b].c || grupos[a].s - grupos[b].s).forEach(g => {
      k += `\t\t<Folder>\n\t\t\t<name>${g}</name>\n`;
      grupos[g].t.forEach(t => {
        const base = t.compartido ? t.compartido.tramo : (t.adicional ? null : t);
        const pe = base ? posicionEnTramo(model, base, t.salida) : { pos: 0, total: 1 };
        const off = desplazamiento(pe.pos, pe.total);
        const cs = off ? paralela(t.a.coords, t.b.coords, off) : [t.a.coords, t.b.coords];
        const nom = `${t.a.code} → ${t.b.code}` + (t.compartido ? ` (compartido con ${salName(t.compartido.tramo.salida)})` : t.adicional ? ` (recorrido ${salName(t.salida)})` : '');
        k += `\t\t\t<Placemark>\n\t\t\t\t<name>${nom}</name>\n\t\t\t\t<styleUrl>#sSAL${pad2(t.salida)}</styleUrl>\n\t\t\t\t<LineString>\n\t\t\t\t\t<tessellate>1</tessellate>\n\t\t\t\t\t<coordinates>\n\t\t\t\t\t\t${coordStr(cs[0])} ${coordStr(cs[1])} \n\t\t\t\t\t</coordinates>\n\t\t\t\t</LineString>\n\t\t\t</Placemark>\n`;
      });
      k += '\t\t</Folder>\n';
    });
    k += '\t</Folder>\n';

    // CGP_CPM
    k += '\t<Folder>\n\t\t<name>CGP_CPM</name>\n';
    ordenados.forEach(n => { if (n.cgp && n.coords) k += placemark('\t\t', 'CGP/CPM', popupCGP(n, nameOf), 'sCGP', n.coords); });
    k += '\t</Folder>\n';

    // ZOBX y DEFECTOS
    const defOrd = [...model.defectos].filter(d => d.node.coords);
    k += '\t<Folder>\n\t\t<name>ZOBX</name>\n';
    defOrd.filter(d => d.codigo === 'ZOBX' || d.codigo === 'ZOBX_Q91X').forEach(d => { k += placemark('\t\t', d.codigo, popupDef(d, nameOf), d.codigo === 'ZOBX' ? 'sZOBX' : 'sQ91X', d.node.coords); });
    k += '\t</Folder>\n';
    k += '\t<Folder>\n\t\t<name>DEFECTOS</name>\n';
    defOrd.filter(d => d.codigo !== 'ZOBX' && d.codigo !== 'ZOBX_Q91X').forEach(d => { k += placemark('\t\t', d.codigo, popupDef(d, nameOf), 'sDef', d.node.coords); });
    k += '\t</Folder>\n';

    if (legend) {
      k += `\t<ScreenOverlay>\n\t\t<name>Leyenda</name>\n\t\t<Icon>\n\t\t\t<href>files/leyenda.png</href>\n\t\t</Icon>\n\t\t<overlayXY x="1" y="1" xunits="fraction" yunits="fraction"/>\n\t\t<screenXY x="0.99" y="0.98" xunits="fraction" yunits="fraction"/>\n\t\t<rotationXY x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>\n\t\t<size x="${legend.w}" y="${legend.h}" xunits="pixels" yunits="pixels"/>\n\t</ScreenOverlay>\n`;
    }
    k += '</Document>\n</kml>\n';
    return k;
  }

  // Distancias totales (prompt KMZ §19)
  function distancias(model) {
    const porSalida = {}; let total = 0;
    model.tramos.forEach(t => { if (t.dist == null) return; const g = salName(t.salida); porSalida[g] = (porSalida[g] || 0) + t.dist; total += t.dist; });
    (model.compartidos || []).forEach(c => { if (c.tramo.dist == null) return; const g = salName(c.salida); porSalida[g] = (porSalida[g] || 0) + c.tramo.dist; total += c.tramo.dist; }); // cada línea que va por un tramo compartido cuenta sus metros
    (model.adicionales || []).forEach(x => { const g = salName(x.salida); porSalida[g] = (porSalida[g] || 0) + x.dist; total += x.dist; });
    return { porSalida, total };
  }

  // ───────────────────────── lectura de KMZ (modificado) ─────────────────────────
  const CARPETAS = ['APOYOS', 'SALIDAS', 'CGP_CPM', 'ZOBX', 'DEFECTOS'];
  const decodeEnt = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const textoDe = s => { s = String(s || ''); const cd = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/); return cd ? s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : decodeEnt(s); };
  const campoPopup = (html, k) => { const m = String(html || '').match(new RegExp('<b>\\s*' + k + '\\s*:?\\s*</b>\\s*:?\\s*([\\s\\S]*?)(?:<br\\s*/?>|$)', 'i')); return m ? decodeEnt(m[1].replace(/<[^>]+>/g, '')).trim() : null; };
  const imgsPopup = html => { const out = []; String(html || '').replace(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi, (m, src) => { out.push(src); return m; }); return out; };

  // Lee el KML respetando las carpetas (APOYOS, SALIDAS, CGP_CPM, ZOBX, DEFECTOS)
  function parseKml(kml) {
    const puntos = [], lineas = [];
    const re = /<Folder\b[^>]*>|<\/Folder>|<Placemark\b([^>]*)>([\s\S]*?)<\/Placemark>/g; let m;
    const stack = [];
    const num = s => s.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(p => p.length >= 2 && isFinite(p[0]) && isFinite(p[1]));
    while ((m = re.exec(kml))) {
      if (m[0].startsWith('<Folder')) {
        let rest = kml.slice(re.lastIndex, re.lastIndex + 3000);
        const cut = rest.search(/<Placemark\b|<Folder\b/); if (cut >= 0) rest = rest.slice(0, cut);
        const nm = rest.match(/<name>([\s\S]*?)<\/name>/);
        stack.push(nm ? textoDe(nm[1]).trim().toUpperCase() : '');
        continue;
      }
      if (m[0] === '</Folder>') { stack.pop(); continue; }
      const body = m[2];
      const carpeta = [...stack].reverse().find(f => CARPETAS.includes(f)) || '';
      const idm = m[1].match(/\bid="([^"]*)"/);
      const nm = body.match(/<name>([\s\S]*?)<\/name>/);
      const name = nm ? textoDe(nm[1]).trim() : '';
      const dm = body.match(/<description>([\s\S]*?)<\/description>/);
      const desc = dm ? textoDe(dm[1]) : '';
      const pc = body.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
      const lc = body.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
      if (pc) { const p = num(pc[1])[0]; if (p) puntos.push({ carpeta, id: idm ? idm[1] : '', name, lat: p[1], lon: p[0], desc, imgs: imgsPopup(desc) }); }
      else if (lc) { const ps = num(lc[1]); if (ps.length >= 2) lineas.push({ carpeta, name, ini: { lat: ps[0][1], lon: ps[0][0] }, fin: { lat: ps[ps.length - 1][1], lon: ps[ps.length - 1][0] } }); }
    }
    return { puntos, lineas };
  }


  // Comprobador de metros: mide todas las líneas de cualquier KMZ/KML, agrupadas por la carpeta en la que están.
  // Cada línea dibujada cuenta entera, así que un tramo compartido por dos salidas (dos líneas paralelas) cuenta dos veces.
  function medirKml(kml) {
    const grupos = new Map(); let total = 0, n = 0, compartidas = 0;
    const re = /<Folder\b[^>]*>|<\/Folder>|<Document\b[^>]*>|<\/Document>|<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g; let m;
    const stack = [];
    const num = s => s.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(p => p.length >= 2 && isFinite(p[0]) && isFinite(p[1])).map(p => ({ lat: p[1], lon: p[0] }));
    while ((m = re.exec(kml))) {
      if (/^<(Folder|Document)\b/.test(m[0])) {
        let rest = kml.slice(re.lastIndex, re.lastIndex + 3000);
        const cut = rest.search(/<Placemark\b|<Folder\b/); if (cut >= 0) rest = rest.slice(0, cut);
        const nm = rest.match(/<name>([\s\S]*?)<\/name>/);
        stack.push(nm ? textoDe(nm[1]).trim() : '');
        continue;
      }
      if (m[0] === '</Folder>' || m[0] === '</Document>') { stack.pop(); continue; }
      const body = m[1];
      const ls = [...body.matchAll(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)];
      if (!ls.length) continue;
      const nm = body.match(/<name>([\s\S]*?)<\/name>/);
      const name = nm ? textoDe(nm[1]).trim() : '';
      let d = 0;
      ls.forEach(x => { const ps = num(x[1]); for (let i = 1; i < ps.length; i++) d += haversine(ps[i - 1], ps[i]); });
      const carpeta = stack.length > 1 ? stack[stack.length - 1] || '(sin carpeta)' : '(sin carpeta)';
      const g = grupos.get(carpeta) || { carpeta, metros: 0, lineas: 0, compartidas: 0 };
      const comp = /compartid/i.test(name);
      g.metros += d; g.lineas++; if (comp) { g.compartidas++; compartidas++; }
      grupos.set(carpeta, g); total += d; n++;
    }
    return { grupos: [...grupos.values()], total, lineas: n, compartidas };
  }

  // Punto del KMZ (carpeta APOYOS) que corresponde a cada nodo de la tabla
  function puntosDesdeKmz(model, kd) {
    const avisos = [];
    const conCarpeta = kd.puntos.some(p => p.carpeta === 'APOYOS');
    const ap = kd.puntos.filter(p => conCarpeta ? p.carpeta === 'APOYOS' : !['CGP_CPM', 'ZOBX', 'DEFECTOS'].includes(p.carpeta));
    const byName = {}; ap.forEach(p => { (byName[p.name] = byName[p.name] || []).push(p); });
    const byId = {}; ap.forEach(p => { if (p.id) byId[p.id] = p; });
    const pto = new Map();
    model.nodes.forEach(n => {
      const id = 'n_' + (n.esPT ? 'PT' : n.cuadro + '_' + n.salida + '_' + n.apoyo);
      let cands = (byName[n.name] || []).concat(byName[n.code] || []);
      if (n.esPT) cands = cands.concat(byName['PT' + n.ct] || [], byName['CT' + n.ct] || [], byName[n.ct] || []);
      cands = [...new Set(cands)];
      let p = null;
      if (cands.length === 1) p = cands[0];
      else if (cands.length > 1) {
        p = cands.find(c => c.id === id) || null;
        if (!p && n.coords) p = cands.slice().sort((a, b) => haversine(a, n.coords) - haversine(b, n.coords))[0];
        if (!p) p = cands[0];
      } else if (byId[id]) p = byId[id];
      if (p) {
        pto.set(n, p);
        if (n.coords) { const mv = haversine(p, n.coords); if (mv > 0.5) avisos.push(`${n.name}: movido ${mv < 10 ? mv.toFixed(1).replace('.', ',') : Math.round(mv)} m en el KMZ respecto a la tabla; se usa la posición del KMZ.`); }
      } else avisos.push(`${n.name}: no aparece en la carpeta APOYOS del KMZ; su DIST. queda en blanco y se usan los datos de la tabla.`);
    });
    return { pto, avisos };
  }

  // Orden de gravedad por defecto (más grave primero). ZOBX siempre lo último.
  const GRAVEDAD_DEFECTO = ['A21X', 'C11X', 'D13X', 'D15X', 'D16X', 'D17X', 'G56X', 'H43X', 'H62X', 'L23X', 'L24X', 'L62X', 'P11X', 'P21X', 'P31X', 'QA1X', 'Q92Y', 'Q91X', 'ZOBX_Q91X', 'ZOBX'];
  function rangoGravedad(lista) {
    lista = (lista && lista.length ? lista : GRAVEDAD_DEFECTO).map(x => trim(x).toUpperCase()).filter(Boolean);
    return code => {
      const i = lista.indexOf(code); if (i >= 0) return i;
      if (code === 'ZOBX') return 10000;
      if (code === 'ZOBX_Q91X') return 9000;
      return 5000; // código no listado: más grave que ZOBX, menos que los listados
    };
  }

  // ───────────────────────── ANEXO III ─────────────────────────
  // El KMZ modificado manda en: posiciones (DIST.), defectos (código, apoyo, descripción),
  // observaciones de los apoyos y fotos. Las tablas aportan FECHA, CT, CUADRO, SALIDA, Nº, TIPO, INICIO, FIN y SECCIÓN.
  function buildAnexo(model, kd, opts) {
    opts = opts || {};
    const avisos = [], resumen = [];
    const { pto, avisos: av } = puntosDesdeKmz(model, kd); avisos.push(...av);
    const pos = n => pto.get(n) || null;
    const tramoDe = new Map(model.tramos.map(t => [t.row, t]));

    // Topología: por nombre de la línea (A → B) o por extremos
    const near = (a, b) => haversine(a, b) < 1;
    const usadas = new Set();
    model.tramos.forEach(t => {
      const A = pos(t.a), B = pos(t.b); if (!A || !B) return;
      const nombres = [`${t.a.code} → ${t.b.code}`, `${t.b.code} → ${t.a.code}`];
      let L = kd.lineas.findIndex((l, i) => !usadas.has(i) && !/\((compartido|recorrido)/i.test(l.name) && nombres.includes(l.name.replace(/\s*(->|→)\s*/, ' → ')));
      if (L < 0) L = kd.lineas.findIndex((l, i) => !usadas.has(i) && !/\((compartido|recorrido)/i.test(l.name) && ((haversine(l.ini, A) < 4 && haversine(l.fin, B) < 4) || (haversine(l.ini, B) < 4 && haversine(l.fin, A) < 4)));
      if (L < 0) avisos.push(`Topología: el tramo ${t.a.name} → ${t.b.name} de la tabla no tiene línea en SALIDAS del KMZ.`);
      else {
        usadas.add(L); const l = kd.lineas[L];
        const cerca = (p, q) => haversine(p, q) < 4; // las líneas de tramos compartidos van desplazadas hasta 1,5 m
        const ok = (cerca(l.ini, A) && cerca(l.fin, B)) || (cerca(l.ini, B) && cerca(l.fin, A));
        if (!ok) resumen.push(`La línea ${t.a.name} → ${t.b.name} no llega exactamente a la posición de los apoyos en el KMZ (¿apoyo movido sin mover la línea?). DIST. se calcula entre apoyos.`);
      }
    });
    kd.lineas.forEach((l, i) => { if (!usadas.has(i) && !/\((compartido|recorrido)/i.test(l.name)) avisos.push(`Topología: la línea "${l.name}" del KMZ no corresponde a ningún tramo INICIO/FIN de la tabla.`); });

    // Defectos desde las carpetas ZOBX y DEFECTOS del KMZ
    const marcas = kd.puntos.filter(p => p.carpeta === 'ZOBX' || p.carpeta === 'DEFECTOS');
    const defPorNodo = new Map();
    const conPos = model.nodes.filter(n => pos(n));
    let fuenteDef = 'KMZ';
    if (!marcas.length && model.defectos.length) {
      fuenteDef = 'tablas';
      avisos.push('El KMZ no tiene marcadores en las carpetas ZOBX ni DEFECTOS: se usan los defectos de las tablas.');
      model.defectos.forEach(d => { if (!defPorNodo.has(d.node)) defPorNodo.set(d.node, []); defPorNodo.get(d.node).push({ codigo: d.codigo, desc: d.desc, imgs: d.fotos.map(f => 'files/' + f.base) }); });
    }
    marcas.forEach(p => {
      let codigo = trim(p.name).toUpperCase();
      if (!esCodigoDefecto(codigo)) { const c = campoPopup(p.desc, 'C[oó]digo de defecto'); if (c && esCodigoDefecto(c)) codigo = c.toUpperCase(); }
      if (!esCodigoDefecto(codigo)) { avisos.push(`Marcador "${p.name}" en ${p.carpeta} sin código de defecto reconocible: se ignora.`); return; }
      const antes = campoPopup(p.desc, 'Apoyo asociado');
      const nAntes = antes ? model.nodes.find(n => n.code === antes || n.name === antes) : null;
      let best = null, bd = Infinity;
      if (nAntes && nAntes.coords && pos(nAntes) && haversine(p, nAntes.coords) < 1) { best = nAntes; bd = 0; } // marcador sin mover: sigue con su apoyo aunque el apoyo se haya movido
      else conPos.forEach(n => { const x = haversine(pos(n), p); if (x < bd) { bd = x; best = n; } });
      if (!best) return;
      if (bd > 3) avisos.push(`Defecto ${codigo}: el marcador está a ${fmtMiles(bd)} m del apoyo más cercano (${best.name}); se asigna a ese apoyo.`);
      const desc = campoPopup(p.desc, 'Descripci[oó]n') || '';
      if (antes && antes !== best.code && antes !== best.name) resumen.push(`Defecto ${codigo} movido en el KMZ: de ${antes} a ${best.esPT ? best.name : best.code}.`);
      if (!defPorNodo.has(best)) defPorNodo.set(best, []);
      defPorNodo.get(best).push({ codigo, desc, imgs: p.imgs });
    });
    // Defectos de las tablas que ya no están en el KMZ (informativo)
    if (fuenteDef === 'KMZ') model.defectos.forEach(d => { const l = defPorNodo.get(d.node) || []; if (!l.some(x => x.codigo === d.codigo)) resumen.push(`El defecto ${d.codigo} de ${d.node.esPT ? d.node.name : d.node.code} está en las tablas pero no en el KMZ en ese apoyo: no se pone en el Excel.`); });

    const grav = rangoGravedad(opts.gravedad);
    const filas = model.filas.map(r => {
      const n = r.node, p = r === n.row ? pos(n) : null;
      let inicio = trim(r.inicio), fin = trim(r.fin);
      if (!r.esPT && inicio === '' && fin !== '') { inicio = '0'; resumen.push(`INICIO vacío completado a 0 en el apoyo ${r.apoyo} (sale del PT/CT).`); }
      let tipo = normTipo(r.tipo);
      if (tipo == null) { tipo = upperEs(r.tipo); avisos.push(`TIPO "${r.tipo}" (fila ${r.linea}) sin abreviatura conocida: se deja tal cual.`); }
      let dist = '';
      const t = tramoDe.get(r);
      if (!r.esPT && t && !r.sinTramo) { const A = pos(t.a), B = pos(t.b); if (A && B) dist = Math.round(haversine(A, B)); }
      // Observaciones: las del popup del KMZ si el apoyo está (pueden haberse corregido)
      let obs = trim(r.obs);
      if (p) {
        const o = campoPopup(p.desc, 'Observaciones');
        const k = o == null ? '' : o;
        if (k !== obs) resumen.push(`Observaciones del apoyo ${n.esPT ? n.name : r.apoyo} tomadas del KMZ: "${k}"${obs ? ` (tabla: "${obs}")` : ''}.`);
        obs = k;
      }
      if (tieneCGP(r.tipo) && !tieneCGP(obs)) { obs = obs ? obs + ' / CON CGP' : 'CON CGP'; resumen.push(`Apoyo ${r.apoyo}: TIPO con CGP/CPM y sin mención en observaciones → añadido "CON CGP".`); }
      const ds = r === n.row ? (defPorNodo.get(n) || []) : [];
      const codigos = [], q91 = [], descs = [];
      ds.forEach(d => {
        if (d.codigo === 'ZOBX_Q91X') { if (!q91.includes(d.codigo)) q91.push(d.codigo); }
        else if (!codigos.includes(d.codigo)) codigos.push(d.codigo);
        const de = trim(d.desc);
        if (de && !descs.some(x => upperEs(x) === upperEs(de))) descs.push(de);
      });
      // FOTO: PT → foto general "_1"; apoyos con defecto → 1ª foto del defecto más grave
      let foto = null, fotoMotivo = '';
      if (n.esPT && r === n.row && p) {
        const re1 = new RegExp('(^|/)' + (n.ct) + '(000000)?_0*1\\.(jpe?g|png)$', 'i');
        const i1 = p.imgs.find(s => re1.test(decodeURIComponent(s)));
        if (i1) { foto = i1; fotoMotivo = 'foto general _1 del PT/CT'; }
        else if (p.imgs.length) { foto = p.imgs[0]; fotoMotivo = 'el PT/CT no tiene foto _1: se pone su primera foto general'; avisos.push(`El PT/CT no tiene foto general "_1" en el KMZ: en FOTO se pone su primera foto (${p.imgs[0].split('/').pop()}).`); }
      } else if (ds.length) {
        const conFoto = ds.map((d, i) => ({ d, i })).filter(x => x.d.imgs.length);
        if (conFoto.length) {
          conFoto.sort((a, b) => grav(a.d.codigo) - grav(b.d.codigo) || a.i - b.i);
          foto = conFoto[0].d.imgs[0];
          fotoMotivo = ds.length > 1 ? `${conFoto[0].d.codigo} (el más grave de ${[...new Set(ds.map(d => d.codigo))].join(', ')})` : conFoto[0].d.codigo;
        } else avisos.push(`El apoyo ${r.apoyo} tiene defecto (${ds.map(d => d.codigo).join(', ')}) pero ninguna foto del defecto en el KMZ: FOTO queda vacía.`);
      }
      // Candidatas para que el usuario elija la foto
      let candidatas = [];
      if (n.esPT && r === n.row && p) candidatas = p.imgs.map(src => ({ src, etiqueta: 'General' }));
      else if (ds.length) ds.forEach(d => d.imgs.forEach(src => { if (!candidatas.some(c => c.src === src)) candidatas.push({ src, etiqueta: d.codigo }); }));
      const clave = r === n.row && candidatas.length ? n.code : '';
      const eleg = opts.fotoElegida || {};
      if (clave && Object.prototype.hasOwnProperty.call(eleg, clave) && (eleg[clave] === '' || candidatas.some(c => c.src === eleg[clave]))) {
        foto = eleg[clave] || null; fotoMotivo = eleg[clave] ? 'elegida a mano' : 'sin foto (elegido a mano)';
      }
      const partes = [obs].concat(descs).filter(x => trim(x) !== '');
      return { clave, candidatas,
        fecha: r.fecha, ct: model.ct, cuadro: r.cuadro, salida: r.salida, apoyo: r.apoyo, tipo,
        inicio: r.esPT ? (inicio || '0') : inicio, fin: r.esPT ? (fin || '0') : fin, seccion: r.seccion, dist,
        defec: codigos.join(' / '), q91x: q91.join(' / '), obs: upperEs(partes.join(' / ')), foto: '', fotoSrc: foto, fotoMotivo
      };
    });
    const totalDist = filas.reduce((s, f) => s + (f.dist === '' ? 0 : f.dist), 0);
    // Datos para la app de informes: todos los defectos menos ZOBX, en orden de apoyos
    const defectosInforme = [];
    model.filas.forEach(r => {
      if (r !== r.node.row) return;
      (defPorNodo.get(r.node) || []).forEach(d => {
        if (d.codigo === 'ZOBX') return;
        defectosInforme.push({ apoyo: r.node.code, cod: d.codigo === 'ZOBX_Q91X' ? 'Q91X' : d.codigo, des: '', linea: model.ct, obs: upperEs(trim(d.desc)) });
      });
    });
    const isoDe = f => { const m = trim(f).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); if (!m) return ''; const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`; };
    const fechaInforme = model.filas.map(r => isoDe(r.fecha)).filter(Boolean).sort().pop() || '';
    return { filas, avisos, resumen, totalDist, fuenteDef, informe: { centro: model.ct, fecha: fechaInforme, defectos: defectosInforme } };
  }

  // ───────────────────────── imágenes dentro de celda (como el ANEXO III real) ─────────────────────────
  // imagenes: [{ ext:'jpeg'|'png' }] en orden; devuelve las partes XML que hay que añadir al xlsx.
  function anexoRichData(imagenes) {
    const n = imagenes.length;
    const metadata = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes><futureMetadata name="XLRICHVALUE" count="${n}">` +
      imagenes.map((_, i) => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`).join('') +
      `</futureMetadata><valueMetadata count="${n}">` + imagenes.map((_, i) => `<bk><rc t="1" v="${i}"/></bk>`).join('') + '</valueMetadata></metadata>';
    const rdrichvalue = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="${n}">` + imagenes.map((_, i) => `<rv s="0"><v>${i}</v><v>5</v></rv>`).join('') + '</rvData>';
    const estructura = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>';
    const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><global><keyFlags><key name="_Self"><flag name="ExcludeFromFile" value="1"/><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_DisplayString"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Flags"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Format"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_SubLabel"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Attribution"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Icon"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Display"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_CanonicalPropertyNames"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_ClassificationId"><flag name="ExcludeFromCalcComparison" value="1"/></key></keyFlags></global></rvTypesInfo>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + imagenes.map((_, i) => `<rel r:id="rId${i + 1}"/>`).join('') + '</richValueRels>';
    const relsRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + imagenes.map((im, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.${im.ext}"/>`).join('') + '</Relationships>';
    return {
      'xl/metadata.xml': metadata, 'xl/richData/rdrichvalue.xml': rdrichvalue, 'xl/richData/rdrichvaluestructure.xml': estructura,
      'xl/richData/rdRichValueTypes.xml': tipos, 'xl/richData/richValueRel.xml': rels, 'xl/richData/_rels/richValueRel.xml.rels': relsRels
    };
  }
  function anexoContentTypes(ct, exts) {
    exts.forEach(e => { if (!new RegExp(`Extension="${e}"`, 'i').test(ct)) ct = ct.replace('<Default ', `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/><Default `); });
    const add = (part, type) => { if (!ct.includes(`PartName="${part}"`)) ct = ct.replace('</Types>', `<Override PartName="${part}" ContentType="${type}"/></Types>`); };
    add('/xl/metadata.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml');
    add('/xl/richData/richValueRel.xml', 'application/vnd.ms-excel.richvaluerel+xml');
    add('/xl/richData/rdrichvalue.xml', 'application/vnd.ms-excel.rdrichvalue+xml');
    add('/xl/richData/rdrichvaluestructure.xml', 'application/vnd.ms-excel.rdrichvaluestructure+xml');
    add('/xl/richData/rdRichValueTypes.xml', 'application/vnd.ms-excel.rdrichvaluetypes+xml');
    return ct;
  }
  function anexoWorkbookRels(rels) {
    const add = (type, target) => { if (rels.includes(`Target="${target}"`)) return; let i = 1; while (rels.includes(`Id="rId${i}"`)) i++; rels = rels.replace('</Relationships>', `<Relationship Id="rId${i}" Type="${type}" Target="${target}"/></Relationships>`); };
    add('http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata', 'metadata.xml');
    add('http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue', 'richData/rdrichvalue.xml');
    add('http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure', 'richData/rdrichvaluestructure.xml');
    add('http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes', 'richData/rdRichValueTypes.xml');
    add('http://schemas.microsoft.com/office/2022/10/relationships/richValueRel', 'richData/richValueRel.xml');
    return rels;
  }

  // Escribe las filas en la hoja de la plantilla (XML), conservando estilos.
  function anexoSheetXml(sheetXml, filas, ct) {
    const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row r="(\d+)"[^>]*\/>/g;
    const rows = {}; let m;
    while ((m = rowRe.exec(sheetXml))) rows[+(m[1] || m[3])] = m[0];
    const stylesOf = xml => { const s = {}; (xml.match(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(c => { const col = c.match(/r="([A-Z]+)/)[1]; const st = c.match(/ s="(\d+)"/); s[col] = st ? st[1] : '0'; }); return s; };
    const cols = 'ABCDEFGHIJKLMN'.split('');
    const tplLast = Math.max(...Object.keys(rows).map(Number));
    const lastData = 6 + filas.length;
    const hayDist = filas.some(f => f.dist !== '');
    const sumRow = hayDist ? lastData + 2 : null;
    const lastRow = Math.max(tplLast, sumRow || lastData);
    const rowAttrs = r => (rows[r] || rows[tplLast]).match(/^<row[^>]*?(\/?)>/)[0].replace(/ r="\d+"/, ` r="${r}"`).replace(/\/>$/, '>');
    const cell = (ref, s, v) => {
      if (v === '' || v == null) return `<c r="${ref}" s="${s}"/>`;
      if (typeof v === 'object' && v.vm) return `<c r="${ref}" s="${s}" t="e" vm="${v.vm}"><v>#VALUE!</v></c>`;
      if (typeof v === 'object' && v.f) return `<c r="${ref}" s="${s}"><f>${v.f}</f><v>${v.v}</v></c>`;
      if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) return `<c r="${ref}" s="${s}"><v>${+v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
    };
    let out = '';
    for (let r = 1; r <= lastRow; r++) {
      if (r <= 6 && rows[r]) {
        let x = rows[r];
        if (r === 3) x = x.replace(/<c r="A3"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/, (_, a) => `<c r="A3"${a.replace(/ t="\w+"/, '').replace(/\/$/, '')}><v>${+ct}</v></c>`);
        out += x; continue;
      }
      const st = stylesOf(rows[r] || rows[tplLast]);
      const f = filas[r - 7];
      let x = rowAttrs(r);
      cols.forEach((c, i) => {
        let v = '';
        if (f) v = [f.fecha, f.ct, f.cuadro, f.salida, f.apoyo, f.tipo, f.inicio, f.fin, f.seccion, f.dist, f.defec, f.q91x, f.obs, f.fotoVm ? { vm: f.fotoVm } : f.foto][i];
        if (r === sumRow && c === 'J') v = { f: `SUM(J7:J${lastData})`, v: filas.reduce((s, q) => s + (q.dist === '' ? 0 : q.dist), 0) };
        if (f && c === 'A') v = String(v); // FECHA como texto, igual que el ANEXO III real
        x += cell(c + r, st[c] || '9', v);
      });
      out += x + '</row>';
    }
    return sheetXml
      .replace(/<sheetData>[\s\S]*<\/sheetData>|<sheetData\/>/, '<sheetData>' + out + '</sheetData>')
      .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:N${lastRow}"/>`)
      .replace(/<selection [^>]*\/>/, '<selection activeCell="A7" sqref="A7"/>');
  }
  function anexoWorkbookXml(wbXml, lastRow) {
    return wbXml.replace(/(_xlnm\.Print_Area"[^>]*>)[^<]*/, (m0, a) => a + 'Sheet1!$A$1:$N$' + lastRow)
      .replace(/<calcPr ([^>]*?)\/>/, (m, a) => /fullCalcOnLoad/.test(a) ? m : `<calcPr ${a} fullCalcOnLoad="1"/>`);
  }


  // Monta el xlsx final sobre la plantilla (objeto JSZip ya cargado).
  // leerImagen(src) → Promise<Uint8Array|null> con los bytes de la foto referenciada en el KMZ.
  async function generarAnexoXlsx(tpl, an, ct, leerImagen) {
    const imgs = []; const porSrc = new Map(); const avisos = [];
    for (const f of an.filas) {
      if (!f.fotoSrc) continue;
      if (porSrc.has(f.fotoSrc)) { f.fotoVm = porSrc.get(f.fotoSrc); continue; }
      const data = await leerImagen(f.fotoSrc);
      if (!data) { avisos.push(`No se encuentra en el KMZ la foto ${f.fotoSrc} (apoyo ${f.apoyo}): FOTO queda vacía.`); continue; }
      const png = data[0] === 0x89 && data[1] === 0x50;
      imgs.push({ ext: png ? 'png' : 'jpeg', data });
      f.fotoVm = imgs.length; porSrc.set(f.fotoSrc, imgs.length);
    }
    const sx = anexoSheetXml(await tpl.file('xl/worksheets/sheet1.xml').async('string'), an.filas, ct);
    const last = +sx.match(/<dimension ref="A1:N(\d+)"/)[1];
    tpl.file('xl/worksheets/sheet1.xml', sx, { createFolders: false });
    tpl.file('xl/workbook.xml', anexoWorkbookXml(await tpl.file('xl/workbook.xml').async('string'), last), { createFolders: false });
    if (imgs.length) {
      imgs.forEach((im, i) => tpl.file(`xl/media/image${i + 1}.${im.ext}`, im.data, { compression: 'STORE', createFolders: false }));
      const parts = anexoRichData(imgs); Object.keys(parts).forEach(k => tpl.file(k, parts[k], { createFolders: false }));
      tpl.file('[Content_Types].xml', anexoContentTypes(await tpl.file('[Content_Types].xml').async('string'), [...new Set(imgs.map(i => i.ext))]), { createFolders: false });
      tpl.file('xl/_rels/workbook.xml.rels', anexoWorkbookRels(await tpl.file('xl/_rels/workbook.xml.rels').async('string')), { createFolders: false });
    }
    return { avisos, nFotos: imgs.length };
  }

  const api = { medirKml, numeracionSeguida, SECCIONES, filasSecciones, editarTabla, normSeccion, analizarNumeracion, propuestaCompactar, propuestaCambio, renumerar, haversine, parseCoords, splitTable, parseMain, parseDefects, buildModel, asociarFotos, buildKml, leyendaFilas, distancias,
    parseKml, buildAnexo, anexoSheetXml, anexoWorkbookXml, anexoRichData, anexoContentTypes, anexoWorkbookRels, GRAVEDAD_DEFECTO, generarAnexoXlsx, normTipo, claseTipo, tieneCGP, salHex, salName, fmtMiles, pad2, upperEs, excelSerialToDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
