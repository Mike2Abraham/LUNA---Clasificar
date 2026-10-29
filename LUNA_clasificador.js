// ============================================================================
// ClasificadorPipeline.js
// Pipeline de clasificacion de archivos multimedia (peli / serie / variado)
//
// FIXES APLICADOS:
//   C1 - extraerInfoDelNombre ya NO duplica regex: delega en Clasificacion.js
//   C4 - tomarDecision enriquece archivo.info con las detecciones de banderas
//   M1 - nombreLimpio se calcula segun categoria ganadora (serie vs peli)
//   limpieza - eliminado el bloque duplicado que asignaba nombreLimpio 2 veces
// ============================================================================

const fs = require('fs');
const path = require('path');
const { setBinariosFromFolder, procesarDuracionMediainfo } = require('./Servicios/ProcesosCore.js');
const Clasificador = require('./Clasificacion.js');
const { guardarLogDebug } = require('./Debug/LUNA_Logger.js');
const VERSION_LUNA = '1.0.0';
var seEjecuto = false;
var seEjecutoIPC = false;


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////// [RUTA DEL BINARIO DE FFMPEG] //////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

setBinariosFromFolder(''); //cambialo a merced ej: D:\\NAtifevierddd\\ffmpeg-static\\

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// ============================================================================
// BANNER DE INICIO
// Se imprime en consola al cargar el módulo.
// Incluye: nombre ASCII, versión, DB metadata, créditos.
// ============================================================================

function imprimirBannerLUNA() {
    if(seEjecuto === true) return
    const meta = (() => {
        try {
            if (typeof infoDBMetadata === 'function') {
                return infoDBMetadata();
            }
        } catch (e) {}
        return { ok: false };
    })();


    const banner = `
     ██╗     ██╗   ██╗███╗   ██╗ █████╗ 
     ██║     ██║   ██║████╗  ██║██╔══██╗
     ██║     ██║   ██║██╔██╗ ██║███████║
     ██║     ██║   ██║██║╚██╗██║██╔══██║
     ███████╗╚██████╔╝██║ ╚████║██║  ██║
     ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝

     Clasificador de archivos multimedia
     ─────────────────────────────────────
     Version LUNA:      ${VERSION_LUNA}
     DB:                ${meta.ok ? 'cargada' : 'NO cargada'}
     DB version:        ${meta.ok ? (meta.version || 'N/A') : 'N/A'}
     DB fecha:          ${meta.ok ? (meta.fechaActualizacion || 'N/A') : 'N/A'}
     DB fuente:         ${meta.ok ? (meta.fuente || 'N/A') : 'N/A'}
     DB categorias:     ${meta.ok ? meta.categorias.join(', ') : 'N/A'}
     DB aliases:        ${meta.ok ? meta.totalAliases : 0}
     ─────────────────────────────────────
     Desarrollado por Abraham de Jesus Piniri Megret
     Agradecimientos: DeepSeek
     ─────────────────────────────────────
     (◕‿◕)  Ready to classify  ♪♫
    `;

    seEjecuto = true;

    console.log(banner);
}

// ============================================================================
// 1. INPUTs
// ============================================================================
async function LUNA(entrada) {
    imprimirBannerLUNA();
    const paquete = crearPaqueteVacio();
    paquete.meta.inicio = Date.now();
    const t0 = Date.now(); // <--- NUEVO

    try {
        normalizarEntrada(paquete, entrada);
        await extraerDatos(paquete);
        await clasificarPorBanderas(paquete);
        tomarDecision(paquete);
        transformarSalida(paquete);
        
        const result = exponerResultado(paquete);
        // === LOG DE DEBUG ===
        guardarLogDebug(entrada, result, Date.now() - t0);
        return result;

    } catch (error) {
        paquete.errores.push({
            etapa: 'LUNA - procesarEntrada',
            mensaje: error.message
        });
        paquete.meta.fin = Date.now();
        const result = exponerResultado(paquete);
        // === LOG DE DEBUG EN CASO DE ERROR ===
        guardarLogDebug(entrada, result, Date.now() - t0);
        return result;
    }
}
// ============================================================================
// PAQUETE DE TRABAJO
// ============================================================================
function crearPaqueteVacio() {
    return {
        entradaOriginal: null,
        tipoEntrada: null,

        rutas: [],
        opciones: {
            sin_metadato: false,
            metadatos: [],
            formatoSalida: 'json'
        },

        archivos: [],

        puntajes: { pelicula: 0, serie: 0, variado: 0 },
        banderas: {},

        resultados: [],

        salida: null,

        errores: [],
        meta: { inicio: 0, fin: 0, duracionMs: 0 }
    };
}

// ============================================================================
// 2. NORMALIZAR
// ============================================================================
function normalizarEntrada(paquete, entrada) {
    paquete.entradaOriginal = entrada;

    if (typeof entrada === 'string') {
        paquete.tipoEntrada = 'string';
        paquete.rutas = [entrada];
        return;
    }

    if (esObjetoConfig(entrada)) {
        paquete.tipoEntrada = 'objeto';
        paquete.rutas = [entrada.ruta];
        paquete.opciones.sin_metadato = entrada.sin_metadato === true;
        paquete.opciones.metadatos = Array.isArray(entrada.metadatos) ? entrada.metadatos : [];
        return;
    }

    if (Array.isArray(entrada) && entrada.every(e => typeof e === 'string')) {
        paquete.tipoEntrada = 'array';
        paquete.rutas = [...entrada];
        return;
    }

    if (Array.isArray(entrada) && entrada.every(esObjetoConfig)) {
        paquete.tipoEntrada = 'array';
        paquete.rutas = entrada.map(e => e.ruta);
        const primera = entrada[0];
        paquete.opciones.sin_metadato = primera.sin_metadato === true;
        paquete.opciones.metadatos = Array.isArray(primera.metadatos) ? primera.metadatos : [];
        return;
    }

    paquete.errores.push({
        etapa: 'normalizarEntrada',
        mensaje: 'Formato de entrada no soportado'
    });
}

function esObjetoConfig(valor) {
    return valor !== null
        && typeof valor === 'object'
        && !Array.isArray(valor)
        && typeof valor.ruta === 'string';
}

// ============================================================================
// 3. EXTRAER DATOS
// Por cada ruta: duracion real, fecha de creacion, metadatos.
// NO clasifica ni extrae info del nombre: eso lo hace clasificarPorBanderas
// via Clasificacion.js (unica fuente de verdad).
// ============================================================================
async function extraerDatos(paquete) {
    for (const ruta of paquete.rutas) {
        try {
            const archivo = {
                nombreOriginal: path.basename(ruta),
                ruta: ruta,
                duracion: 0,
                fecha: null,
                nombreLimpio: null,
                info: {},          // se rellena en clasificarPorBanderas -> enriquecerInfoDesdeReporte
                metadatos: Array.isArray(paquete.opciones.metadatos) ? paquete.opciones.metadatos : []
            };

            const resultadoDuracion = await obtenerDuracionSegura(ruta);
            if (resultadoDuracion && resultadoDuracion.success) {
                archivo.duracion = resultadoDuracion.segundos || 0;
            }

            archivo.fecha = obtenerFechaCreacion(ruta);

            paquete.archivos.push(archivo);

        } catch (error) {
            paquete.errores.push({
                etapa: 'extraerDatos',
                ruta: ruta,
                mensaje: error.message
            });
        }
    }
}

// Wrapper con timeout para no colgar el pipeline si falla la duracion
async function obtenerDuracionSegura(ruta) {
    try {
        return await conTimeout(
            procesarDuracionMediainfo(ruta),
            25000,
            `Timeout obteniendo duracion: ${path.basename(ruta)}`
        );
    } catch (error) {
        return { segundos: 0, success: false, ruta: ruta };
    }
}

function conTimeout(promesa, ms, mensaje) {
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => reject(new Error(mensaje)), ms);
        promesa
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(id));
    });
}

// Fecha de creacion del archivo formateada como DD-MM-YY
function obtenerFechaCreacion(ruta) {
    try {
        const stats = fs.statSync(ruta);
        const fecha = stats.birthtime;
        const dia = String(fecha.getDate()).padStart(2, '0');
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const anio = String(fecha.getFullYear()).slice(-2);
        return `${dia}-${mes}-${anio}`;
    } catch (error) {
        return null;
    }
}

// ============================================================================
// 4. CLASIFICAR POR BANDERAS
// Delega TODO en Clasificacion.js. Despues enriquece archivo.info y
// archivo.nombreLimpio a partir del reporte.
//
// FIX C1: ya NO existe extraerInfoDelNombre con regex propias.
// FIX M1: nombreLimpio se calcula segun categoria ganadora.
// ============================================================================
async function clasificarPorBanderas(paquete) {
    paquete.banderas = [];
    paquete.puntajes = { pelicula: 0, serie: 0, variado: 0 };

    for (const archivo of paquete.archivos) {
        try {
            const reporte = await Clasificador.clasificarArchivo(archivo);

            paquete.banderas.push({ ruta: archivo.ruta, reporte });

            paquete.puntajes.pelicula += (reporte.pelicula && reporte.pelicula.puntos) || 0;
            paquete.puntajes.serie    += (reporte.serie && reporte.serie.puntos)    || 0;
            paquete.puntajes.variado  += (reporte.variado && reporte.variado.puntos) || 0;

            archivo._clasificacion = reporte;

            // Enriquecer info + nombreLimpio desde las detecciones de las banderas
            enriquecerArchivoDesdeReporte(archivo, reporte);

        } catch (e) {
            paquete.errores.push({
                etapa: 'clasificarPorBanderas',
                ruta: archivo.ruta,
                mensaje: e.message
            });
        }
    }
}

/**
 * FIX C1 + M1
 * Deriva archivo.info y archivo.nombreLimpio a partir del reporte de banderas.
 * No recalcula regex: solo lee lo que las banderas ya detectaron.
 *
 * Selecciona la categoria "ganadora" por puntos para decidir:
 *   - que limpiador usar (serie vs pelicula)
 *   - si marcar esEstructuraSerie
 *
 * Mantiene compatibilidad con los campos que el consumidor ya usaba:
 *   info.nombreLimpio, info.serie, info.temporada, info.capituloNumero,
 *   info.anio, info.esEstructuraSerie, info.puntajeDeteccion
 */
function enriquecerArchivoDesdeReporte(archivo, reporte) {
    const pPeli  = (reporte.pelicula && reporte.pelicula.puntos) || 0;
    const pSerie = (reporte.serie    && reporte.serie.puntos)    || 0;
    const pVari  = (reporte.variado  && reporte.variado.puntos)  || 0;

    const dSerie = (reporte.serie    && reporte.serie.detecciones)    || {};
    const dPeli  = (reporte.pelicula && reporte.pelicula.detecciones) || {};

    let ganadora = 'variado';
    if (pSerie > pPeli && pSerie > pVari) ganadora = 'serie';
    else if (pPeli > pSerie && pPeli > pVari) ganadora = 'pelicula';

    const tieneDeteccionSerie = (
        dSerie.temporada !== undefined && dSerie.temporada !== null
    ) || (
        dSerie.capitulo !== undefined && dSerie.capitulo !== null
    ) || (
        dSerie.nombreSerie !== undefined && dSerie.nombreSerie !== null
    );

    const puntajeDeteccion = Math.max(pSerie, pPeli, pVari);

    // ¿El nombre del archivo tiene contenido propio? (no es solo "33", "Ep 5", "Cap-2")
    const baseSinExt = String(archivo.nombreOriginal).replace(/\.[a-z0-9]{2,5}$/i, '').trim();
    const archivoTieneNombrePropio = /[a-záéíóúñü]{3,}/i.test(baseSinExt)
        && !/^(?:cap|capitulo|capítulo|ep|episodio|episode|video|clip)\b/i.test(baseSinExt);

    // nombreLimpio: SIEMPRE intentar desde el archivo primero.
    // Solo caer a lo que dijo la bandera (carpeta) si el archivo NO tiene nombre propio.
    let nombreLimpio = null;
    try {
        if (archivoTieneNombrePropio) {
            // El archivo manda: limpiar su propio nombre
            if (ganadora === 'pelicula') {
                const r = Clasificador.limpiarNombrePelicula(archivo.nombreOriginal);
                nombreLimpio = r.nombreLimpio || null;
            } else {
                const r = Clasificador.limpiarNombreSerieAvanzado(archivo.nombreOriginal);
                nombreLimpio = r.nombreLimpio || null;
            }
            // Si por lo que sea el limpiador no devolvió nada, caer al de la bandera
            if (!nombreLimpio && dSerie.nombreSerie) nombreLimpio = dSerie.nombreSerie;
        } else {
            // Archivo sin nombre propio ("33.mp4", "Ep 5.mp4"): usar lo que dijo la carpeta
            if (ganadora === 'serie' && dSerie.nombreSerie) {
                nombreLimpio = dSerie.nombreSerie;
            } else if (ganadora === 'pelicula') {
                const r = Clasificador.limpiarNombrePelicula(archivo.nombreOriginal);
                nombreLimpio = r.nombreLimpio || null;
            } else {
                const r = Clasificador.limpiarNombreSerieAvanzado(archivo.nombreOriginal);
                nombreLimpio = r.nombreLimpio || null;
            }
        }
    } catch (e) {
        nombreLimpio = null;
    }

    archivo.info = {
        nombreLimpio: nombreLimpio,
        serie:        dSerie.nombreSerie || null,
        temporada:    (dSerie.temporada !== undefined ? dSerie.temporada : null),
        capituloNumero: (dSerie.capitulo !== undefined ? dSerie.capitulo : null),
        anio:         (dPeli.anio !== undefined ? dPeli.anio : null),
        esEstructuraSerie: tieneDeteccionSerie,
        puntajeDeteccion: puntajeDeteccion,
        categoriaGanadora: ganadora
    };

    archivo.nombreLimpio = nombreLimpio;
}
// ============================================================================
// DB DE NOMBRES CONOCIDOS (luna_db.json)
// ----------------------------------------------------------------------------
// Se usa SOLO para reclasificar esSERIE -> esPROGRAM / esNOVELA.
// No suma puntos. No compite con banderas. Solo cambia la etiqueta final
// cuando el nombre limpio matchea en la DB.
//
// Carga lazy: la primera llamada lee el archivo, después es cache en memoria.
// Si el archivo no existe o está malformado, no rompe: devuelve null.
//
// Estructura esperada:
// {
//   version, fechaActualizacion, fuente,
//   categorias: { serie: {nombres}, pelicula: {nombres}, programa: {nombres},
//                 novela: {nombres}, variado: {nombres} },
//   aliases: { "variante": "nombre canonico", ... }
// }
// ============================================================================

const DB_NOMBRES_PATH = path.join(__dirname, 'BD', 'luna_db.json');

let _dbCache = null;
let _dbCargada = false;
let _dbError = null;

function cargarDB() {
    if (_dbCargada) return _dbCache;
    _dbCargada = true;
    try {
        if (!fs.existsSync(DB_NOMBRES_PATH)) {
            _dbError = 'archivo no existe: ' + DB_NOMBRES_PATH;
            return null;
        }
        const raw = fs.readFileSync(DB_NOMBRES_PATH, 'utf8');
        _dbCache = JSON.parse(raw);
        return _dbCache;
    } catch (e) {
        _dbError = e.message;
        return null;
    }
}

// API util para consultar metadata de la DB (version, fecha, fuente)
function LUNAVersion() {
    const db = cargarDB();
    if (!db) return { ok: false, error: _dbError };
    return {
        versionLUNA: VERSION_LUNA,
        Creador: 'Abraham de Jesús Piñirí Megret',
        Comentario: 'LUNA es un codigo muy complejo para clasificar multimedia reslueve el problema de forma local y optimizada cuando se necesita saber que es la multimedia que se tiene un el PC, muchas gracias por usar este codigo, al ser abierto puedes mejorarlo a tu gusto!!',
        ok: true,
        versionDB: db.version || null,
        fechaActualizacion: db.fechaActualizacion || null,
        fuente: db.fuente || null,
        categorias: db.categorias ? Object.keys(db.categorias) : [],
        totalAliases: db.aliases ? Object.keys(db.aliases).length : 0
    };
}

function infoDBMetadata() {
    const db = cargarDB();
    if (!db) return { ok: false, error: _dbError };
    return {
        ok: true,
        version: db.version || null,
        fechaActualizacion: db.fechaActualizacion || null,
        fuente: db.fuente || null,
        categorias: db.categorias ? Object.keys(db.categorias) : [],
        totalAliases: db.aliases ? Object.keys(db.aliases).length : 0
    };
}

// Normaliza un nombre para comparar contra la DB:
// - quita acentos, lowercase, colapsa espacios, quita separadores
function normalizarClaveDB(nombre) {
    if (!nombre) return '';
    return String(nombre)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\uFF01-\uFF5E]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/\u3000/g, ' ')
        .replace(/[\(\)\[\]\{\}]+/g, ' ')
        .replace(/[_\.\-=\+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// Busca un nombre en una categoria concreta.
// Estrategia:
//   1. aliases (global, fuera de categoria) -> nombre canonico
//   2. match exacto en nombres
//   3. match por prefijo (por si el limpiador dejo cola)
function buscarEnCategoriaDB(db, nombreLimpio, categoria) {
    if (!db || !db.categorias) return null;
    const bucket = db.categorias[categoria];
    if (!bucket || !bucket.nombres) return null;

    const claveOriginal = normalizarClaveDB(nombreLimpio);
    if (!claveOriginal) return null;

    // 1. Resolver aliases (pueden encadenarse, max 3 saltos)
    let clave = claveOriginal;
    if (db.aliases) {
        for (let salto = 0; salto < 3; salto++) {
            const destino = db.aliases[clave];
            if (!destino) break;
            const destinoNorm = normalizarClaveDB(destino);
            if (!destinoNorm || destinoNorm === clave) break;
            clave = destinoNorm;
        }
    }

    // 2. Match exacto
    const entrada = bucket.nombres[clave];
    if (entrada) {
        return {
            categoria,
            nombreOficial: entrada.nombreOficial || clave,
            confianza: entrada.confianza || 1.0,
            viaAlias: clave !== claveOriginal
        };
    }

    // 3. Match por prefijo (solo si el nombre empieza por una clave de la DB
    //    seguida de espacio). Evita falsos positivos tipo "el" que matchearia
    //    media DB.
    for (const key of Object.keys(bucket.nombres)) {
        if (key.length < 4) continue;
        if (clave.startsWith(key + ' ')) {
            const e = bucket.nombres[key];
            return {
                categoria,
                nombreOficial: e.nombreOficial || key,
                confianza: e.confianza || 1.0,
                viaAlias: false,
                viaPrefijo: true
            };
        }
    }

    return null;
}

/**
 * Reclasifica esSERIE -> esPROGRAM / esNOVELA consultando la DB.
 * Solo se llama cuando esCC === 'esSERIE' y todo el proceso ya terminó.
 * No suma puntos. No compite con banderas. Solo cambia la etiqueta.
 *
 * Devuelve { esCC, info } con info.DBmetadata actualizado si reclasificó.
 */
function reclasificarDesdeDB(archivo, esCC, info) {
    if (esCC !== 'esSERIE') return { esCC, info };

    const db = cargarDB();
    if (!db) return { esCC, info };

    const nombreLimpio = (info && info.nombreLimpio) || null;
    if (!nombreLimpio) return { esCC, info };

    // Orden de prioridad: programa primero, novela segundo.
    // (si manana anades mas, solo ponlas aqui)
    for (const cat of ['programa', 'novela']) {
        const match = buscarEnCategoriaDB(db, nombreLimpio, cat);
        if (!match) continue;

        const nuevoEsCC = (cat === 'programa') ? 'esPROGRAM' : 'esNOVELA';

        const infoNueva = {
            ...info,
            categoriaGanadora: cat,
            DBmetadata: {
                fuente: db.fuente || null,
                version: db.version || null,
                fechaActualizacion: db.fechaActualizacion || null,
                categoriaDB: cat,
                nombreOficial: match.nombreOficial,
                viaAlias: !!match.viaAlias,
                viaPrefijo: !!match.viaPrefijo
            }
        };

        return { esCC: nuevoEsCC, info: infoNueva };
    }

    return { esCC, info };
}
// ============================================================================
// 5. TOMAR DECISION
// Decide esCC comparando los puntajes de las banderas.
// Fallback coherente con info (FIX C4) cuando hay empate o todo cero.
// ============================================================================
function tomarDecision(paquete) {
    paquete.resultados = [];

    for (const archivo of paquete.archivos) {
        try {
            const rep = archivo._clasificacion || null;

            if (!rep) {
                paquete.resultados.push({ esCC: null, archivo });
                continue;
            }

            const pPeli  = (rep.pelicula && rep.pelicula.puntos) || 0;
            const pSerie = (rep.serie    && rep.serie.puntos)    || 0;
            const pVari  = (rep.variado  && rep.variado.puntos)  || 0;

            let elegido = null;

            if (pPeli > pSerie && pPeli > pVari) elegido = 'esPELI';
            else if (pSerie > pPeli && pSerie > pVari) elegido = 'esSERIE';
            else if (pVari > pPeli && pVari > pSerie) elegido = 'esVARIADO';

            // Desempate / todo cero
            if (elegido === null) {
                // FIX C4: primero mirar las detecciones concretas de banderas
                const dSerie = (rep.serie && rep.serie.detecciones) || {};
                const dPeli  = (rep.pelicula && rep.pelicula.detecciones) || {};
                const dVari  = (rep.variado && rep.variado.detecciones) || {};

                if (dSerie.temporada != null || dSerie.capitulo != null || dSerie.nombreSerie) {
                    elegido = 'esSERIE';
                } else if (dPeli.anio != null || dPeli.parte != null) {
                    elegido = 'esPELI';
                } else if (dVari.duracionTipica) {
                    elegido = 'esVARIADO';
                } else {
                    // Ultimo recurso: heuristica por duracion
                    const d = archivo.duracion || 0;
                    if (d >= 45 * 60) elegido = 'esPELI';
                    else if (d >= 17 * 60) elegido = 'esSERIE';
                    else elegido = 'esVARIADO';
                }
            }

            // === RESCATE: si gano serie y info esta vacio, intentar sacar
            // serie/temporada/capitulo desde la carpeta y el nombre del archivo ===
            if (elegido === 'esSERIE' && archivo.info && !archivo.info.serie) {
                try {
                    archivo.info = rescatarInfoDesdeCarpeta(archivo, elegido, archivo.info);
                    // actualizar nombreLimpio para que la salida lo refleje
                    if (archivo.info && archivo.info.nombreLimpio) {
                        archivo.nombreLimpio = archivo.info.nombreLimpio;
                    }
                } catch (e) {
                    paquete.errores.push({
                        etapa: 'tomarDecision.rescate',
                        ruta: archivo.ruta,
                        mensaje: e.message
                    });
                }
            }

                        // === RECLASIFICACION DB: esSERIE -> esPROGRAM / esNOVELA ===
            // Solo si gano serie y todo el proceso ya termino.
            // No suma puntos, solo cambia la etiqueta final consultando luna_db.json.
            if (elegido === 'esSERIE') {
                try {
                    const rec = reclasificarDesdeDB(archivo, elegido, archivo.info || {});
                    elegido = rec.esCC;
                    archivo.info = rec.info;
                } catch (e) {
                    paquete.errores.push({
                        etapa: 'tomarDecision.db',
                        ruta: archivo.ruta,
                        mensaje: e.message
                    });
                }
            }

            paquete.resultados.push({ esCC: elegido, archivo });

        } catch (e) {
            paquete.errores.push({
                etapa: 'tomarDecision',
                ruta: archivo.ruta,
                mensaje: e.message
            });
            paquete.resultados.push({ esCC: null, archivo });
        }
    }
}
// ============================================================================
// RESCATADOR: info desde carpeta cuando el nombre es solo número
// ----------------------------------------------------------------------------
// Se activa SOLO cuando:
//   - esCC === 'esSERIE'
//   - info.serie === null (las banderas no pudieron extraer nombre)
//   - el nombre del archivo es puro número o "Ep N"/"Cap N"/"Episodio N"
//
// Estrategia:
//   1. Si hay consecutividad en la carpeta (>=2 hermanos numericos) -> rescatar
//   2. Si no hay consecutividad y hay 1 solo video -> rescatar SI la ruta
//      grita serie/anime/manga/novela/programa/show
//   3. Si no cumple ninguna -> NO rescatar
//
// Temporada:
//   - busca en el nombre original (por si trae "Temp 1")
//   - busca en todas las carpetas de la ruta
//   - fallback: temporada = 1
// ============================================================================
function rescatarInfoDesdeCarpeta(archivo, esCC, info) {
    // 1. Solo si gano serie
    if (esCC !== 'esSERIE') return info;

    // 2. Solo si las banderas no pudieron sacar nombreSerie
    if (info.serie) return info;

    // 3. Extraer nombre base sin extension
    const nombreOrig = Clasificador.quitarExtension(archivo.nombreOriginal);

    // 4. Aceptar: "33", "Ep 33", "Cap 33", "Episodio 33", "Cap-33", "Ep.33"
    //    (los que ya matchean serie_capitulo_texto no llegan aqui porque
    //     habrian rellenado info.serie; pero por seguridad excluimos SxxExx/NxN)
    if (/\b[sStT]\d{1,2}\s*[_\-\s]*[eE]\d{1,2}\b/.test(nombreOrig)) return info;
    if (/\b\d{1,2}\s*[xX]\s*\d{1,3}\b/.test(nombreOrig)) return info;

    let capitulo = null;
    let m = nombreOrig.match(/^\s*(\d{1,4})\s*$/);
    if (m) {
        capitulo = parseInt(m[1]);
    } else {
        m = nombreOrig.match(/\b(?:ep|cap|episodio|capitulo)\s*[-._\s]?\s*(\d{1,4})\s*$/i);
        if (m) capitulo = parseInt(m[1]);
    }
    if (capitulo === null || capitulo < 1 || capitulo > 9999) return info;

    // 5. Analizar la carpeta: consecutividad + total de hermanos
    let consecutivos = 0;
    let totalHermanos = 0;
    try {
        const carpeta = path.dirname(archivo.ruta);
        const entradas = fs.readdirSync(carpeta, { withFileTypes: true });

        const numeros = [];
        for (const e of entradas) {
            if (!e.isFile()) continue;
            const ext = path.extname(e.name).toLowerCase();
            if (!['.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.m4v',
                  '.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.3gp', '.ogv', '.divx']
                .includes(ext)) continue;
            totalHermanos++;

            const base = Clasificador.quitarExtension(e.name).trim();
            let num = null;
            if (/^\d{1,4}$/.test(base)) {
                num = parseInt(base);
            } else {
                const mm = base.match(/\b(?:ep|cap|episodio|capitulo)\s*[-._\s]?\s*(\d{1,4})\s*$/i);
                if (mm) num = parseInt(mm[1]);
            }
            if (num !== null) numeros.push(num);
        }

        // Consecutividad: cuantos numeros forman una secuencia +1 a +1 a partir del minimo
        if (numeros.length >= 2) {
            numeros.sort((a, b) => a - b);
            consecutivos = 1;
            for (let i = 1; i < numeros.length; i++) {
                if (numeros[i] === numeros[i - 1] + 1) consecutivos++;
                else break;
            }
        }
    } catch (e) {
        // Si no se puede leer la carpeta, no rescatamos
        return info;
    }

    // 6. Decidir si hay evidencia suficiente
    const tieneConsecutividad = consecutivos >= 2;
    const esUnicoVideo = totalHermanos === 1;

    if (!tieneConsecutividad && !esUnicoVideo) {
        // Ni consecutividad ni video unico -> no rescatar
        return info;
    }

    // Si NO hay consecutividad y NO es unico video, ya salimos arriba.
    // Ahora: si no hay consecutividad, exigimos que la ruta grite serie.
    if (!tieneConsecutividad && esUnicoVideo) {
        const rutaTexto = Clasificador.obtenerCarpetasDeRuta(archivo.ruta).join(' ').toLowerCase();
        const rutaGritaSerie = /(series?|animes?|mangas?|novelas?|doramas?|programas?|shows?|capitulos?|episodios?|temporadas?)/.test(rutaTexto);
        if (!rutaGritaSerie) return info;
    }

    // 7. Nombre de la serie desde la carpeta padre
    const nombreSerie = Clasificador.nombreDesdeCarpetaPadre(archivo.ruta);
    if (!nombreSerie) return info;

    // 8. Temporada: primero en el nombre original, luego en cada carpeta de la ruta
    let temporada = null;

    // 8a. En el nombre del archivo (por si trae "Sengoku Youko temp 1 33.mp4")
    const mTempNombre = nombreOrig.match(
        /\b(?:t|temp(?:erada)?|season)\s*[.\-_\s]?\s*(\d{1,2})\b/i
    );
    if (mTempNombre) temporada = parseInt(mTempNombre[1]);

    // 8b. En las carpetas de la ruta
    if (temporada === null) {
        const carpetas = Clasificador.obtenerCarpetasDeRuta(archivo.ruta);
        for (let i = carpetas.length - 1; i >= 0; i--) {
            const c = carpetas[i];
            // [T2] / [T 2] / [T.2] / [T_2] / [Temp 2] / [Temporada 2] / [Season 2]
            let mm = c.match(
                /\[\s*(?:t|temp(?:erada)?|season)\s*[.\-_\s]?\s*(\d{1,2})\s*\]/i
            );
            if (mm) { temporada = parseInt(mm[1]); break; }

            // Temp 2 / Temporada 2 / Season 2 / T2 / T 2 / T.2 / T_2 / T-2
            mm = c.match(
                /\b(?:temp(?:erada)?|season|t)\s*[.\-_\s]?\s*(\d{1,2})\b/i
            );
            if (mm && /^(?:temp(?:erada)?|season|t)$/i.test(mm[0].replace(/[.\-_\s\d]/g, ''))) {
                // Solo aceptar si la carpeta es "solo" temporada (Temp 2, T2, Temporada 2)
                // no si es "Sengoku Youko temp 2" mezclado con nombre de serie
                const soloTemp = c.replace(/\b(?:temp(?:erada)?|season|t)\s*[.\-_\s]?\s*\d{1,2}\b/i, '').trim();
                if (soloTemp === '' || /^[\[\]\s()\-._]+$/.test(soloTemp)) {
                    temporada = parseInt(mm[1]);
                    break;
                }
            }

            // "Sengoku Youko temp 1" (nombre + temp al final)
            mm = c.match(/\b(?:temp(?:erada)?|season)\s*[.\-_\s]?\s*(\d{1,2})\s*$/i);
            if (mm) { temporada = parseInt(mm[1]); break; }
        }
    }

    // 8c. Fallback: temporada 1
    if (temporada === null) temporada = 1;

    // 9. Devolver info enriquecida
    return {
        ...info,
        serie: nombreSerie,
        temporada: temporada,
        capituloNumero: info.capituloNumero != null ? info.capituloNumero : capitulo,
        nombreLimpio: nombreSerie,
        rescatadoDesdeCarpeta: true,
        rescatadoEvidencia: {
            consecutivos,
            totalHermanos,
            teniaConsecutividad: tieneConsecutividad,
            eraUnicoVideo: esUnicoVideo
        }
    };
}
// ============================================================================
// 6. TRANSFORMAR SALIDA
// ============================================================================
function transformarSalida(paquete) {
    const sinMetadato = paquete.opciones.sin_metadato;

    paquete.salida = paquete.resultados.map(item => {
        const archivo = item.archivo;

        if (sinMetadato) {
            return { esCC: item.esCC };
        }

        return {
            nombreOriginal: archivo.nombreOriginal,
            nombreLimpio: archivo.nombreLimpio,
            ruta: archivo.ruta,
            info: archivo.info,
            duracion: archivo.duracion,
            esCC: item.esCC
        };
    });

    if (paquete.tipoEntrada === 'string' || paquete.tipoEntrada === 'objeto') {
        paquete.salida = paquete.salida[0] || null;
    }
}

// ============================================================================
// 7. EXPONER RESULTADO
// ============================================================================
function exponerResultado(paquete) {
    paquete.meta.fin = Date.now();
    paquete.meta.duracionMs = paquete.meta.fin - paquete.meta.inicio;

    return {
        exito: paquete.errores.length === 0,
        salida: paquete.salida,
        errores: paquete.errores,
        meta: paquete.meta
    };
}





module.exports = {
    LUNA,
    normalizarEntrada,
    extraerDatos,
    clasificarPorBanderas,
    tomarDecision,
    rescatarInfoDesdeCarpeta,
    transformarSalida,
    exponerResultado,

    // DB / reclasificacion
    reclasificarDesdeDB,
    infoDBMetadata,
    LUNAVersion,
    cargarDB,
    // Exportada por si necesitas testear el enriquecimiento por separado
    enriquecerArchivoDesdeReporte
};