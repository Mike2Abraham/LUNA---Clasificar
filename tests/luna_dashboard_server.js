const http = require('http');
const fs = require('fs');
const path = require('path');
const { getFFmpegPath } = require('../Servicios/ResolverPathffmpeg.js');
const LUNA = require('../LUNA_clasificador.js');

const PORT = 3466;
const HTML_PATH = path.join(__dirname, 'luna_dashboard.html');

//http://localhost:3466/

// Solo id + ruta. El nombre se deriva del nombre de archivo.
function getRandomizedCases() {
  const rutas = [
    'D:\\ANIME\\Thunder 3 [Temp 1] [2026] [Caps 12]\\La Novia - 107 [15-10-2026] [Corregido].mp4',
    'D:\\ANIME\\Thunder 3 [Temp 1] [2026] [Caps 12]\\Dueña de Mi - 139 [16-10-2026].mp4',
    'D:\\ANIME\\Peliculas\\John Wick 4.mkv',
    'D:\\ANIME\\Peliculas\\Harry Potter La Piedra Filosofal.mkv',
    'D:\\ANIME\\Code Geass 2\\[D-SnF] Code Geass - Lelouch of the Rebellion R2 - 11 [BD 1080p].mkv',
    'D:\\TV\\The Bear\\The Bear - S02E07.mkv',
    'D:\\SERIES\\Silo\\Season 2\\Silo - 204.mkv',
    'D:\\PROGRAMAS\\MasterChef\\MasterChef - 008 [HD].mp4',
    'D:\\PERSONAL\\VID_20240101_214500.mp4',
    'D:\\VIDEOS\\clip_demo.mp4',
    'D:\\SERIES\\One Piece\\One Piece - 1034.mp4',
    'D:\\ANIME\\Shingeki no Kyojin\\Shingeki no Kyojin - 012 [1080p].mkv',
    'D:\\SHOWS\\La Voz\\La Voz - 010 [TV].mp4',
    'D:\\PELICULAS\\Dune Part Two (2024).mkv',
    'D:\\NOVELAS\\La Promesa 18.mp4',
    'D:\\MISC\\sample_01.mp4',
    'D:\\SECCION CUBA\\Novelas\\La Vida Que Me Robaste 21.mp4',
    'D:\\FOTOS\\WhatsApp Video 2024-10-10 at 20.00.00.mp4',
    'D:\\Anime\\Blue Lock\\Blue Lock - S01E03 [Sub].mkv',
    'D:\\Cine\\The Batman [4K UHD] [2022].mkv'
  ];

  return rutas
    .map((ruta, i) => ({ id: `case-${String(i + 1).padStart(2, '0')}`, ruta }))
    .sort(() => Math.random() - 0.5)
    .slice(0, 20);
}

function nombreDesdeRuta(ruta) {
  if (!ruta) return '—';
  const base = ruta.split(/[\\/]/).pop() || ruta;
  return base.replace(/\.[^.]+$/, '');
}

// Normaliza la salida de LUNA a un objeto plano y consistente.
// No inventa datos: solo propaga lo que LUNA devuelve.
function serializeResult(item, data) {
  const base = {
    id: item.id,
    ruta: item.ruta,
    estado: 'ok',
    titulo: null,
    subtitulo: null,
    categoriaHumana: null,
    etiquetaVariado: null,
    detalles: [], // Solo datos reales
    error: null
  };

  if (!data || !data.salida) {
    base.estado = 'error';
    base.error = 'No hubo salida de LUNA';
    return base;
  }

  const s = data.salida || {};
  const info = s.info || {};

  // Traducir la categoría técnica a lenguaje humano
  const catMap = {
    'esPELI': 'Película',
    'esSERIE': 'Serie',
    'esPROGRAM': 'Programa',
    'esNOVELA': 'Novela',
    'esVARIADO': 'Variado'
  };
  base.categoriaHumana = catMap[s.esCC] || null;

  // El título principal: nombreLimpio (ej: "La Vida Que Me Robaste")
  base.titulo = s.nombreLimpio || info.nombreLimpio || null;

  // El subtítulo: Puede ser el título del episodio O la temporada/capítulo
  let subParts = [];
  if (info.tituloLimpio) subParts.push(info.tituloLimpio); // Ej: "Lelouch of the Rebellion"
  
  if (info.temporada) subParts.push(`Temporada ${info.temporada}`);
  if (info.capituloNumero) subParts.push(`Capítulo ${info.capituloNumero}`);
  
  if (subParts.length > 0) {
    base.subtitulo = subParts.join(' · ');
  }

  const etiquetaVariado = info.Etiqueta_V || s.Etiqueta_V || null;
  if (etiquetaVariado) {
    base.etiquetaVariado = etiquetaVariado;
    if (s.esCC === 'esVARIADO') {
      base.subtitulo = etiquetaVariado;
    }
    base.detalles.push({ etiqueta: 'Etiqueta', valor: etiquetaVariado });
  }

  // Detalles: Solo lo que existe y es útil
  if (info.serie) base.detalles.push({ etiqueta: 'Serie', valor: info.serie });
  if (info.anio) base.detalles.push({ etiqueta: 'Año', valor: info.anio });
  if (s.fechaExtra) base.detalles.push({ etiqueta: 'Fecha', valor: s.fechaExtra });
  
  if (s.duracion && s.duracion > 0) {
    const mins = Math.floor(s.duracion / 60);
    base.detalles.push({ etiqueta: 'Duración', valor: `${mins} min` });
  }
  
  if (s.extension) base.detalles.push({ etiqueta: 'Formato', valor: s.extension.toUpperCase() });
  if (s.esCC === 'esSERIE' || s.esCC === 'esNOVELA') {
     if (info.DBmetadata && info.DBmetadata.nombreOficial) {
         base.detalles.push({ etiqueta: 'Nombre Oficial', valor: info.DBmetadata.nombreOficial });
     }
  }

  if (data.errores && data.errores.length) {
    base.estado = 'warning';
    base.error = data.errores[0].mensaje || 'Hay errores';
  }

  return base;
}

async function ejecutarCasos(casos) {
  const resultados = [];

  for (const caso of casos) {
    try {
      const resultado = await LUNA.LUNA(caso.ruta);
      resultados.push(serializeResult(caso, resultado));
    } catch (error) {
      resultados.push({
        id: caso.id,
        ruta: caso.ruta,
        estado: 'error',
        categoria: null,
        esCC: null,
        nombreLimpio: null,
        extension: null,
        tipoArchivo: null,
        duracion: null,
        fechaExtra: null,
        serie: null,
        temporada: null,
        capitulo: null,
        pelicula: null,
        programa: null,
        novela: null,
        error: error.message || 'Error desconocido'
      });
    }
  }

  return {
    ejecutado: new Date().toISOString(),
    total: resultados.length,
    ok: resultados.filter(r => r.estado === 'ok').length,
    warning: resultados.filter(r => r.estado === 'warning').length,
    error: resultados.filter(r => r.estado === 'error').length,
    resultados
  };
}

async function ejecutarSuite() {
  return ejecutarCasos(getRandomizedCases());
}

// ---------------------------------------------------------------
// FFmpeg: se intenta cargar, pero si falla LUNA sigue funcionando
// por nombre (sin duración). No se lanza excepción hacia arriba.
// ---------------------------------------------------------------
function configurarFFmpeg() {
  try {
    //const ffmpegExe = getFFmpegPath();
    //const carpeta = path.dirname(ffmpegExe) + path.sep;
    LUNA.setBinariosFromFolder('D:\\NAtifevierddd\\ffmpeg-static');
    console.log('[dashboard] FFmpeg configurado correctamente.');
    return true;
  } catch (e) {
    console.warn('[dashboard] FFmpeg no disponible, LUNA seguirá funcionando por nombre:', e.message);
    return false;
  }
}

configurarFFmpeg();

function leerBodyJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ---- Suite de 20 casos fijos ----
  if (req.method === 'GET' && url.pathname === '/api/run') {
    try {
      const payload = await ejecutarSuite();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Casos personalizados desde el HTML (POST) ----
  if (req.method === 'POST' && url.pathname === '/api/run-custom') {
    try {
      const body = await leerBodyJSON(req);
      const casos = Array.isArray(body.casos) ? body.casos : [];

      const limpios = casos
        .map((c, i) => {
          const ruta = typeof c?.ruta === 'string' ? c.ruta.trim() : '';
          if (!ruta) return null;
          return { id: `custom-${i + 1}`, ruta };
        })
        .filter(Boolean);

      if (limpios.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'No se recibieron rutas válidas.' }));
        return;
      }

      const payload = await ejecutarCasos(limpios);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Metadata de la DB ----
  if (req.method === 'GET' && url.pathname === '/api/meta') {
    try {
      const meta = typeof LUNA.infoDBMetadata === 'function' ? LUNA.infoDBMetadata() : null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, meta }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  // ---- Health ----
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'luna-dashboard', port: PORT }));
    return;
  }

  // ---- HTML ----
  if (req.method === 'GET') {
    fs.readFile(HTML_PATH, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No se pudo cargar la vista HTML.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
});

server.listen(PORT, () => {
  console.log(`\n====================================================`);
  console.log(`LUNA dashboard activo en: http://localhost:${PORT}`);
  console.log(`Prueba visual en: http://localhost:${PORT}`);
  console.log(`====================================================\n`);
});