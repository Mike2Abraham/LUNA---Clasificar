// ============================================================================
// Clasificacion.js
// Banderas de clasificacion por categoria (serie / pelicula / variado).
// Cada bandera es pura: recibe un archivo y devuelve { puntos, detecciones }.
// Ninguna bandera decide. Solo puntuan. Quien decide es tomarDecision.
//
// Banderas SINCRONAS: analizan nombre + ruta + duracion. Baratas.
// Banderas ASINCRONAS: leen el filesystem (investigar carpeta hermana).
//                    Una sola lectura sirve para serie Y pelicula.
//
// FIXES APLICADOS:
//   C2  - peli_anio ya no captura [Colombia - 2026]
//   C3  - serie_capitulo_programa registrada + peso definido
//   I1  - serie_nxm captura T2xC3 / T2xC03
//   I3  - serie_temporada_en_nombre acota T genérica
//   I4  - serie_capitulo_texto no cuenta E22 dentro de S04_E22
//   I5  - peli_sin_patron_serie ve [Gala - N] y [Programa - N]
//   I6  - normalizarParaMatching limpia fullwidth / unicode raro
//   M2  - serie_capitulo_en_corchete acepta [Cap_4]
//   M3  - serie_temporada_en_nombre captura S03 suelto
//   M4  - peli_secuela_numero no pisa nombres con [Cap-N]
// ============================================================================


const fs   = require('fs');
const fsp  = require('fs').promises;
const path = require('path');


// ============================================================================
// BRETERO: Contexto por ruta (Carpeta más cercana al archivo)
// ============================================================================
const BRETERO_PESO = 60;
const BRETERO_CARPETAS = {
    novela: ['novelas', 'novela', 'Novela', 'telenovelas', 'telenovela'],
    programa: ['programas', 'programa', 'shows', 'show', 'concursos', 'concurso', 'reality', 'realitys'],
    pelicula: ['peliculas', 'pelicula', 'pelis', 'peli', 'movies', 'movie', 'films', 'film'],
    serie: ['series', 'serie', 'anime', 'animes', 'manga', 'mangas', 'dorama', 'doramas', 'kdrama', 'kdramas']
};

// ----------------------------------------------------------------------------
// CONFIGURACION GLOBAL
// ----------------------------------------------------------------------------
const DURACION = {
    PELICULA_MIN: 45 * 60,       // 45 min
    PELICULA_MAX: 4 * 60 * 60,   // 4 h
    SERIE_MIN:    17 * 60,       // 17 min
    SERIE_MAX:    2 * 60 * 60,   // 2 h
    VARIADO_MIN:  0.5 * 60,      // 30 seg
    VARIADO_MAX:  7 * 60         // 7 min
};


// ----------------------------------------------------------------------------
// PESOS DE LAS BANDERAS DE SERIE
// ----------------------------------------------------------------------------
const PESOS_SERIE = {
    // --- Nombre del archivo ---
    sxxexx:                     50,
    nxm:                        45,
    capitulo_texto:             45,
    capitulo_en_corchete:       45,
    capitulo_programa:          45,   // FIX C3: [Programa - NNN] / [Gala - NNN]
    capitulo_numero_suelto:     30,
    temporada_en_nombre:        35,
    idioma_marca:                5,

    // --- Ruta (carpetas) ---
    ruta_novela:                40,
    ruta_series:                40,
    ruta_doramas:               40,
    ruta_shows:                 35,
    ruta_concursos:             35,
    ruta_cuba:                  35,
    ruta_temporada_carpeta:     35,
    ruta_pista_debil:           15,

    // --- Duracion ---
    duracion_tipica_serie:      20,

    // --- Investigacion de carpeta hermana ---
    investigar_consecutivo_fuerte: 60,
    investigar_consecutivo_debil:  20,
    investigar_muchos_hermanos:    25,
    investigar_nombres_serie:      40
};


// ----------------------------------------------------------------------------
// PESOS DE LAS BANDERAS DE PELICULA
// ----------------------------------------------------------------------------
const PESOS_PELICULA = {
    // --- Nombre del archivo ---
    anio:                       50,   // [2018], (2004), .2019., 2018 aislado
    secuela_numero:             30,   // Terrifier 2, Cocktail 2
    secuela_romano:             30,   // John Wick II, Rocky IV
    secuela_palabra:            30,   // Part 2, Parte II
    sin_patron_serie:           15,   // por descarte

    // --- Ruta (carpetas) ---
    ruta_pelicula:              40,   // Peliculas, Películas, PELIS, Pelis, Movies
    ruta_pelicula_tag:          15,   // [HD], [Estreno], [4K], [Clasicas], [2020-2026]
    ruta_genero:                25,   // Accion, Terror, Comedia, Drama, Suspenso

    // --- Duracion ---
    duracion_tipica_pelicula:   25,

    // --- Tags de calidad/idioma ---
    calidad_tag:                10,   // [1080p], [4K UHD HDR10], [BluRay]
    idioma_marca:               10,   // [Dual Audio], [Castellano], [Latino]

    // --- Investigacion de carpeta hermana ---
    investigar_un_solo_video:   25,   // 1 solo video en la carpeta
    investigar_pocos_videos:    15,   // 2-3 videos (posible saga)
    investigar_sin_consecutivo: 15    // cero consecutivos numericos
};

// ----------------------------------------------------------------------------
// PESOS DE LAS BANDERAS DE VARIADO
// ----------------------------------------------------------------------------
const PESOS_VARIADO = {
    // --- Duracion ---
    duracion_corta:             40,   // 30 seg - 7 min: la senal mas fuerte
    duracion_muy_corta:         20,   // < 30 seg (clips, samples)

    // --- Ruta (carpetas) ---
    ruta_variados:              40,   // Variados, Varios, Random, Misc, Otros
    ruta_personal:              35,   // Personal, Mis Videos, Camara, Celular, Telefono
    ruta_documental:            30,   // Documentales, Documental
    ruta_animados_variados:     25,   // Animados Variados
    ruta_interesantes:          25,   // Interesantes, Seccion Interesantes
    ruta_cuba_generica:         20,   // Seccion Cuba SIN "novelas"

    // --- Nombre del archivo ---
    nombre_personal:            40,   // IMG_, VID_, WhatsApp, VID-20, MVI_, DSC_, grabacion
    nombre_generico:            15,   // "video", "clip", "sample", numeros sueltos
    sin_patron_conocido:        20,   // no tiene ni patron serie ni patron peli

    // --- Metadatos regalados ---
    metadato_camara:            50,   // metadata dice camara/telefono
    metadato_personal:          40    // metadata dice algo personal
};

// Umbral: si el puntaje serie ya supera este numero, NO se ejecuta la
// investigacion de carpeta (ya sabemos que es serie, no gastamos IO).
const UMBRAL_SALTAR_INVESTIGACION = 80;


// ----------------------------------------------------------------------------
// UTILIDADES GENERALES
// ----------------------------------------------------------------------------

function quitarExtension(nombre) {
    return String(nombre).replace(/\.[a-z0-9]{2,5}$/i, '');
}

/**
 * FIX I6: normalizarParaMatching ahora limpia caracteres fullwidth y
 * unicode raro (： ／ ～ etc.) que rompen el matching de anime y nombres
 * asiaticos. Tambien colapsa espacios y quita acentos opcionales.
 */
function normalizarParaMatching(nombre) {
    return String(nombre)
        // 1. Fullwidth ASCII (U+FF01–U+FF5E) -> ASCII normal
        .replace(/[\uFF01-\uFF5E]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        // 2. Ideographic space U+3000 -> espacio normal
        .replace(/\u3000/g, ' ')
        // 3. Puntuacion unicode rara comun en anime
        .replace(/[：:]/g, ' ')
        .replace(/[／]/g, ' ')
        .replace(/[～]/g, ' ')
        .replace(/[！]/g, ' ')
        .replace(/[？]/g, ' ')
        .replace(/[＊]/g, ' ')
        // 4. Separadores comunes
        .replace(/[\(\)\[\]\{\}]+/g, ' ')
        .replace(/[_\.\-=\+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function extraerNombreAntesDe(nombreOriginal, posicion) {
    if (posicion <= 0) return null;
    const bruto = nombreOriginal.substring(0, posicion);
    return limpiarNombreSerieAvanzado(bruto).nombreLimpio;
}

function extraerNombreDespuesDe(nombreOriginal, posicion, longitudMatch) {
    const inicio = posicion + longitudMatch;
    if (inicio >= nombreOriginal.length) return null;
    const bruto = nombreOriginal.substring(inicio);
    return limpiarNombreSerieAvanzado(bruto).nombreLimpio;
}

function limpiarNombreSerie(texto) {
    if (!texto) return null;

    let limpio = String(texto)
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^\}]*\}/g, ' ')
        .replace(/\((?:\s*(?:dual|audio|castellano|latino|espa|ingl|sub|hd|sd|1080p|720p|4k|uhd)\s*)\)/gi, ' ')
        .replace(/\b(1080p|720p|2160p|4k|uhd|hdr|hdr10|hevc|x264|x265|aac|ac3|dts|bluray|webrip|web-dl|hdtv|dvdrip|repack|proper|internal|sample|dual\s*a(?:udio)?|dual\s*audio|castellano|latino|espa[ñn]ol|ingles|english|sub(?:s|titulado[s]?)?|vose|vo)\b/gi, ' ')
        .replace(/[_\.\-=\+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!limpio || limpio.length < 2) return null;
    if (!/[a-záéíóúñü]/i.test(limpio)) return null;

    return limpio;
}

function obtenerCarpetasDeRuta(ruta) {
    if (!ruta) return [];
    const partes = String(ruta).split(/[\\\/]+/);
    partes.pop();
    return partes.filter(Boolean);
}

function carpetasComoTexto(ruta) {
    return obtenerCarpetasDeRuta(ruta).join(' ').toLowerCase();
}

function minutos(segundos) {
    return Math.round((segundos || 0) / 60);
}

function bretero(archivo) {
    if (!archivo || !archivo.ruta) return { puntos: {}, detecciones: {} };

    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    // Recorremos la ruta desde la carpeta más cercana al archivo hasta la raíz (de atrás hacia adelante)
    for (let i = carpetas.length - 1; i >= 0; i--) {
        const carpeta = carpetas[i];
        const cMin = carpeta.toLowerCase().trim();
        // Limpiar tags [..] para que "Series [HD]" quede "series"
        const cSinTags = cMin.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

        // Revisamos a qué categoría pertenece esta carpeta
        for (const categoria of ['novela', 'programa', 'pelicula', 'serie']) {
            const palabras = BRETERO_CARPETAS[categoria];

            for (const palabra of palabras) {
                // Match como palabra completa
                const re = new RegExp(`(?:^|\\s)${palabra}(?:\\s|$)`, 'i');
                if (re.test(cSinTags)) {
                    return {
                        puntos: { [categoria]: BRETERO_PESO },
                        detecciones: {
                            bretero: categoria,
                            breteroPalabra: palabra,
                            breteroCarpeta: carpeta
                        }
                    };
                }
            }
        }
    }

    return { puntos: {}, detecciones: {} };
}
// ----------------------------------------------------------------------------
// HELPER: nombre desde carpeta padre
// ----------------------------------------------------------------------------
function nombreDesdeCarpetaPadre(ruta) {
    const carpetas = obtenerCarpetasDeRuta(ruta);
    if (!carpetas.length) return null;

    const ignorar = [
        'omega', 'paquete', 'hoy', 'seccion cuba', 'sección cuba',
        'peliculas', 'películas', 'pelis', 'peli', 'movies', 'films',
        'series', 'series tx', 'novelas', 'novelas finalizadas',
        'novelas estreno', 'animados', 'data', 'conver', 'temp'
    ];

    for (let i = carpetas.length - 1; i >= 0; i--) {
        const c = carpetas[i];
        const cMin = c.toLowerCase().trim();

        if (!cMin) continue;
        if (ignorar.some(ig => cMin === ig)) continue;
        if (/^[a-z]:$/i.test(cMin)) continue;
        if (/^\d+$/.test(cMin)) continue;
        if (/^\[.*\]$/.test(cMin)) continue;
        if (/^temporada\s*\d+$/i.test(cMin)) continue;
        if (/^temp\s*-?\s*\d+$/i.test(cMin)) continue;

        const limpio = limpiarNombreSerieAvanzado(c).nombreLimpio;
        if (limpio && limpio.length >= 2) {
            return limpio;
        }
    }

    return null;
}


// ============================================================================
// BANDERAS SINCRONAS DE SERIE
// ============================================================================


function serie_sxxexx(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);
    const nombre = normalizarParaMatching(nombreOrig);

    const match = nombre.match(/\b[sS](\d{1,2})\s*[_\-\s]*[eE](\d{1,2})\b/)
              || nombre.match(/\b[tT](\d{1,2})\s*[_\-\s]*[eE](\d{1,2})\b/)
              || nombre.match(/\[\s*[sS]\s*(\d{1,2})\s*\]\s*\[\s*[eE]\s*(\d{1,2})\s*\]/)
              || nombre.match(/\[\s*(?:s|season)\s*(\d{1,2})\s*\]\s*\[\s*(?:e|episode)\s*(\d{1,2})\s*\]/i);

    if (!match) return { puntos: {}, detecciones: {} };

    const temporada = parseInt(match[1]);
    const capitulo = parseInt(match[2]);

    let nombreSerie = null;
    const matchOriginal = nombreOrig.match(/[SsTt](\d{1,2})\s*[_\-\s]*[Ee](\d{1,2})/);
    if (matchOriginal && matchOriginal.index > 0) {
        nombreSerie = extraerNombreAntesDe(nombreOrig, matchOriginal.index);
    }
    if (!nombreSerie) {
        nombreSerie = nombreDesdeCarpetaPadre(archivo.ruta);
    }

    return {
        puntos: { serie: PESOS_SERIE.sxxexx },
        detecciones: { temporada, capitulo, nombreSerie, patron: 'sxxexx' }
    };
}


/**
 * FIX I1: serie_nxm ahora captura:
 *   - 1x09, 01x09          (formato NxN clasico)
 *   - T2xC3, T2xC03        (formato T...xC...)
 *   - T2x03                (T + NxN)
 * Mantiene el guard de numeros < 100.
 */
function serie_nxm(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);
    const nombre = normalizarParaMatching(nombreOrig);

    // Orden de intentos: del mas especifico al mas general
    const match =
        nombre.match(/\b[tT](\d{1,2})\s*[xX]\s*[cC](\d{1,3})\b/)   // T2xC3 / T2xC03
     || nombre.match(/\b[tT](\d{1,2})\s*[xX]\s*(\d{1,3})\b/)       // T2x03
     || nombre.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/);          // 1x09

    if (!match) return { puntos: {}, detecciones: {} };

    const a = parseInt(match[1]);
    const b = parseInt(match[2]);
    // Guard: si el "capitulo" parece un año o numero absurdo, descartar
    if (a >= 100 || b >= 100) return { puntos: {}, detecciones: {} };

    let nombreSerie = null;
    // Buscar el match en el original respetando los 3 formatos
    const matchOriginal =
        nombreOrig.match(/\b[tT](\d{1,2})\s*[xX]\s*[cC]?(\d{1,3})\b/)
     || nombreOrig.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/);
    if (matchOriginal && matchOriginal.index > 0) {
        nombreSerie = extraerNombreAntesDe(nombreOrig, matchOriginal.index);
    }
    if (!nombreSerie) {
        nombreSerie = nombreDesdeCarpetaPadre(archivo.ruta);
    }

    return {
        puntos: { serie: PESOS_SERIE.nxm },
        detecciones: { temporada: a, capitulo: b, nombreSerie, patron: 'nxm' }
    };
}


/**
 * FIX I4: serie_capitulo_texto ya NO matchea el E22 dentro de S04_E22.
 * Antes, "S04_E22" -> normalizado "s04 e22" -> el regex E\s*22 matcheaba
 * y sumaba +45 extra. Ahora se excluye si el nombre contiene un SxxExx
 * completo (que serie_sxxexx ya captura).
 */
function serie_capitulo_texto(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);
    const nombre = normalizarParaMatching(nombreOrig);

    // FIX I4: si ya hay un SxxExx completo, no contar el E suelto de nuevo
    if (/\b[sStT]\d{1,2}\s*[_\-\s]*[eE]\d{1,2}\b/.test(nombre)) {
        return { puntos: {}, detecciones: {} };
    }

    const regex = /\b(?:cap(?:[ií]tulo)?|capitulo|ep(?:isodio)?|episode|e)\s*[-.]?\s*(\d{1,4})\b/i;
    const match = nombre.match(regex);
    if (!match) return { puntos: {}, detecciones: {} };

    const capitulo = parseInt(match[1]);
    if (isNaN(capitulo) || capitulo < 0) return { puntos: {}, detecciones: {} };

    let nombreSerie = null;
    const regexOriginal = /\b(?:cap(?:[ií]tulo)?|capitulo|ep(?:isodio)?|episode)\b/i;
    const matchOriginal = nombreOrig.match(regexOriginal);
    if (matchOriginal && matchOriginal.index > 0) {
        nombreSerie = extraerNombreAntesDe(nombreOrig, matchOriginal.index);
    }
    if (!nombreSerie) {
        nombreSerie = nombreDesdeCarpetaPadre(archivo.ruta);
    }

    return {
        puntos: { serie: PESOS_SERIE.capitulo_texto },
        detecciones: { temporada: null, capitulo, nombreSerie, patron: 'capitulo_texto' }
    };
}


function serie_capitulo_numero_suelto(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);

    // Excluir contadores tipo "(1) [28-08-26]" o "(6) [30-08-26]" que son videos sueltos / animados variados,
    // no capítulos de serie.
    if (/\(\d{1,2}\)\s*\[[0-9]{2}-[0-9]{2}-[0-9]{2}\]$/.test(nombreOrig)) {
        return { puntos: {}, detecciones: {} };
    }

    const match = nombreOrig.match(/^(.*?)[\s\-_]+(\d{1,4})$/);
    if (!match) return { puntos: {}, detecciones: {} };

    const numeroStr = match[2];
    const numero = parseInt(numeroStr);

    if (numero >= 1900 && numero <= 2099) return { puntos: {}, detecciones: {} };

    const tieneGuionSeparador = /[\s\-_]+/.test(match[0].substring(match[1].length, match[0].length - numeroStr.length));
    const esPadding = numeroStr.length >= 3 || numeroStr.startsWith('0');

    if (!esPadding && !tieneGuionSeparador) return { puntos: {}, detecciones: {} };

    let nombreSerie = limpiarNombreSerieAvanzado(match[1].trim()).nombreLimpio;
    if (!nombreSerie) {
        nombreSerie = nombreDesdeCarpetaPadre(archivo.ruta);
    }

    let puntos = PESOS_SERIE.capitulo_numero_suelto;
    if (!esPadding) puntos = Math.round(puntos * 0.6);

    return {
        puntos: { serie: puntos },
        detecciones: {
            temporada: null,
            capitulo: numero,
            nombreSerie,
            patron: 'numero_suelto',
            padding: esPadding
        }
    };
}


/**
 * FIX M2: acepta [Cap_4] / [Cap-4] / [Cap.4] / [E_4].
 * El separador entre la palabra y el numero ahora incluye _ .
 */
function serie_capitulo_en_corchete(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);

    // 1. Prioridad: [Cap 4], [Ep 3], [Capitulo 12], [E003] (los explícitos)
    let match = nombreOrig.match(/\[\s*(?:cap(?:[ií]tulo)?|capitulo|ep(?:isodio)?|episode|e)\s*[-._]?\s*(\d{1,4})\s*\]/i);
    let capitulo = null;
    let patron = 'capitulo_en_corchete';

    if (match) {
        capitulo = parseInt(match[1]);
    } else {
        // 2. Fallback: [NNN] puro, PERO excluyendo años, resoluciones y calidades
        const todosLosCorchetes = [...nombreOrig.matchAll(/\[\s*(\d{1,4})\s*\]/g)];
        for (const m of todosLosCorchetes) {
            const num = parseInt(m[1]);

            // Excluir años (1900-2099)
            if (num >= 1900 && num <= 2099) continue;

            // Excluir resoluciones comunes (480, 576, 720, 1080, 1440, 2160, 4320)
            if ([480, 576, 720, 1080, 1440, 2160, 4320].includes(num)) continue;

            // Excluir números "4", "8" que podrían ser 4K/8K
            if (num === 4 || num === 8) continue;

            // Excluir 0
            if (num === 0) continue;

            // Aceptar como capítulo
            match = m;
            capitulo = num;
            patron = 'capitulo_en_corchete_puro';
            break;
        }
    }

    if (capitulo === null || isNaN(capitulo)) return { puntos: {}, detecciones: {} };

    const nombreSerie = extraerNombreAntesDe(nombreOrig, match.index)
                     || nombreDesdeCarpetaPadre(archivo.ruta);

    return {
        puntos: { serie: PESOS_SERIE.capitulo_en_corchete },
        detecciones: { temporada: null, capitulo, nombreSerie, patron }
    };
}


/**
 * FIX C3: [Programa - 004] / [Gala - 002] / [Concurso - 12] -> capitulo.
 * Extrae el numero y opcionalmente la temporada si esta cerca ([T11]).
 * NOTA: el peso esta en PESOS_SERIE.capitulo_programa (45).
 */
function serie_capitulo_programa(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);

    const match = nombreOrig.match(/\[\s*(?:programa|gala|concurso|emision|emisión)\s*[-._]?\s*(\d{1,4})\s*\]/i);
    if (!match) return { puntos: {}, detecciones: {} };

    const capitulo = parseInt(match[1]);
    if (isNaN(capitulo)) return { puntos: {}, detecciones: {} };

    const nombreSerie = extraerNombreAntesDe(nombreOrig, match.index)
                     || nombreDesdeCarpetaPadre(archivo.ruta);

    // Intentar recuperar temporada de un [T11] cercano
    let temporada = null;
    const mTemp = nombreOrig.match(/\[\s*[tT]\s*(\d{1,2})\s*\]/);
    if (mTemp) temporada = parseInt(mTemp[1]);

    return {
        puntos: { serie: PESOS_SERIE.capitulo_programa },
        detecciones: {
            temporada,
            capitulo,
            nombreSerie,
            patron: 'capitulo_programa',
            tipoPrograma: match[0].replace(/[\[\]]/g, '').trim().toLowerCase()
        }
    };
}


/**
 * FIX I3: se acota el T generico para no matchear "Part T3" ni similares.
 *   - S03 suelto (FIX M3) se acepta si esta entre separadores o brackets.
 *   - T3 solo se acepta si va con prefijo claro (T3, Temp3, Temporada 3) Y
 *     no esta precedido por una palabra que lo haga ambiguo.
 */
function serie_temporada_en_nombre(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);
    const nombre = normalizarParaMatching(nombreOrig);

    // 1) Brackets explicitos: [T11], [Temp 3], [Temporada 2], [Season 1]
    let m = nombre.match(/\[\s*(?:t|temp(?:erada)?|season)\s*\.?\s*(\d{1,2})\s*\]/i);
    if (m) {
        return {
            puntos: { serie: PESOS_SERIE.temporada_en_nombre },
            detecciones: { temporada: parseInt(m[1]), patron: 'temporada_nombre_bracket' }
        };
    }

    // 2) Palabra explicita: Season 2 / Temporada 2 / Temp 2 (no abreviado)
    m = nombre.match(/\b(?:season|temp(?:erada)?)\s*\.?\s*(\d{1,2})\b/i);
    if (m) {
        return {
            puntos: { serie: PESOS_SERIE.temporada_en_nombre },
            detecciones: { temporada: parseInt(m[1]), patron: 'temporada_nombre' }
        };
    }

    // 3) FIX M3: S03 suelto (con separador o bracket, no dentro de otra palabra)
    m = nombreOrig.match(/(?:^|[\s_\-\.\[])[sS](\d{1,2})(?:[\s_\-\.\]]|$)/);
    if (m) {
        return {
            puntos: { serie: PESOS_SERIE.temporada_en_nombre },
            detecciones: { temporada: parseInt(m[1]), patron: 'temporada_s_suelta' }
        };
    }

    // 4) FIX I3: T3 solo si va precedido por separador, NO por letra
    //    (evita "Part T3", "Toy T3", etc. que ya caerian en el 3 por S).
    //    Ademas exigimos que NO venga precedido por palabra alfabetica distinta
    //    de un separador, para reducir falsos positivos.
    m = nombreOrig.match(/(?:^|[\s_\-\.\[])t(\d{1,2})(?:[\s_\-\.\]]|$)/i);
    if (m) {
        return {
            puntos: { serie: PESOS_SERIE.temporada_en_nombre },
            detecciones: { temporada: parseInt(m[1]), patron: 'temporada_t_suelta' }
        };
    }

    return { puntos: {}, detecciones: {} };
}


function serie_ruta_novela(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    if (/\bnovelas?\b/.test(texto)) {
        return {
            puntos: { serie: PESOS_SERIE.ruta_novela },
            detecciones: { rutaPista: 'novela', patron: 'ruta_novela' }
        };
    }
    return { puntos: {}, detecciones: {} };
}


function serie_ruta_series(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    if (/\bseries?\b/.test(texto)) {
        return {
            puntos: { serie: PESOS_SERIE.ruta_series },
            detecciones: { rutaPista: 'series', patron: 'ruta_series' }
        };
    }
    return { puntos: {}, detecciones: {} };
}


function serie_ruta_doramas(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    if (/\bdoramas?\b/.test(texto)) {
        return {
            puntos: { serie: PESOS_SERIE.ruta_doramas },
            detecciones: { rutaPista: 'doramas', patron: 'ruta_doramas' }
        };
    }
    return { puntos: {}, detecciones: {} };
}


function serie_ruta_shows(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    if (/\bshows?\b/.test(texto) || /programas?\s*television/.test(texto)) {
        return {
            puntos: { serie: PESOS_SERIE.ruta_shows },
            detecciones: { rutaPista: 'shows', patron: 'ruta_shows' }
        };
    }
    return { puntos: {}, detecciones: {} };
}


function serie_ruta_concursos(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    if (/concursos?\s*de\s*participaci[oó]n/.test(texto)) {
        return {
            puntos: { serie: PESOS_SERIE.ruta_concursos },
            detecciones: { rutaPista: 'concursos', patron: 'ruta_concursos' }
        };
    }
    return { puntos: {}, detecciones: {} };
}


function serie_ruta_cuba(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    if (/secci[oó]n\s*cuba|novelas?\s*cubanas?/.test(texto)) {
        return {
            puntos: { serie: PESOS_SERIE.ruta_cuba },
            detecciones: { rutaPista: 'cuba', patron: 'ruta_cuba' }
        };
    }
    return { puntos: {}, detecciones: {} };
}


function serie_ruta_temporada_carpeta(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    // ¿El archivo tiene nombre propio? (letras suficientes, no solo número/Ep/Cap)
    const nombreArchivoBase = quitarExtension(archivo.nombreOriginal);
    const archivoTieneNombrePropio = /[a-záéíóúñü]{3,}/i.test(nombreArchivoBase)
        && !/^(?:cap|capitulo|capítulo|ep|episodio|episode|video|clip)\b/i.test(nombreArchivoBase.trim());

    for (let i = carpetas.length - 1; i >= 0; i--) {
        const c = carpetas[i];

        let m = c.match(/\[(?:temporada|temp|season)\s*[-.]?\s*(\d{1,2})\]/i);
        if (m) {
            return {
                puntos: { serie: PESOS_SERIE.ruta_temporada_carpeta },
                detecciones: {
                    temporada: parseInt(m[1]),
                    nombreSerie: archivoTieneNombrePropio
                        ? null
                        : limpiarNombreSerieAvanzado(c.replace(/\[[^\]]*\]/g, ' ')).nombreLimpio,
                    patron: 'ruta_temporada_carpeta'
                }
            };
        }

        m = c.match(/^(.*?)\s+(\d{1,2})$/);
        if (m) {
            const posibleNombre = limpiarNombreSerieAvanzado(m[1]).nombreLimpio;
            const num = parseInt(m[2]);
            if (posibleNombre && num >= 1 && num <= 30 && !/\b(19|20)\d{2}\b/.test(c)) {
                return {
                    puntos: { serie: PESOS_SERIE.ruta_temporada_carpeta },
                    detecciones: {
                        temporada: num,
                        nombreSerie: archivoTieneNombrePropio ? null : posibleNombre,
                        patron: 'ruta_temporada_carpeta_numero'
                    }
                };
            }
        }
    }

    return { puntos: {}, detecciones: {} };
}


function serie_ruta_pista_debil(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    if (/\b(capitulos?|episodios?|episodes?)\b/.test(texto)) {
        return {
            puntos: { serie: PESOS_SERIE.ruta_pista_debil },
            detecciones: { rutaPista: 'capitulos', patron: 'ruta_pista_debil' }
        };
    }
    return { puntos: {}, detecciones: {} };
}


function serie_duracion(archivo) {
    const d = archivo.duracion || 0;
    if (d === 0) return { puntos: {}, detecciones: {} };

    if (d >= DURACION.SERIE_MIN && d <= DURACION.SERIE_MAX) {
        return {
            puntos: { serie: PESOS_SERIE.duracion_tipica_serie },
            detecciones: {
                duracionTipica: 'serie',
                duracionSegundos: d,
                patron: 'duracion_serie'
            }
        };
    }

    return { puntos: {}, detecciones: {} };
}


function serie_idioma_marca(archivo) {
    const nombre = archivo.nombreOriginal;
    const m = nombre.match(/\[(?:esp|dual\s*[- ]?a(?:udio)?|dual\s*audio|castellano|latino|espa[ñn]ol)\]/i);

    if (!m) return { puntos: {}, detecciones: {} };

    return {
        puntos: { serie: PESOS_SERIE.idioma_marca },
        detecciones: {
            idioma: m[0].replace(/[\[\]]/g, '').toLowerCase(),
            patron: 'idioma_marca'
        }
    };
}


// ============================================================================
// BANDERAS SINCRONAS DE PELICULA
// ============================================================================


/**
 * FIX C2: peli_anio ya NO captura años que estan dentro de un corchete con
 * contexto de programa/ciudad/pais. Casos:
 *   "[Colombia - 2026]"  -> NO es año de pelicula
 *   "[Gala - 2024]"      -> NO es año de pelicula
 *   "Pelicula (2019)"    -> SI
 *   "Movie.2019.1080p"   -> SI
 *
 * Regla nueva: si el año esta dentro de [] y hay CUALQUIER otra palabra
 * alfabetica antes en ese mismo corchete, se descarta (porque es contexto
 * tipo "[Colombia - 2026]", "[Gala - 2024]"). Si el corchete es solo el
 * año (["2019"] o "[(2019)]"), se acepta.
 */
function peli_anio(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);

    // --- Caso 1: año entre corchetes ---
    // Capturamos el contenido completo del corchete para inspeccionarlo
    const corchetes = [...nombreOrig.matchAll(/[\[\(]\s*([^\]\)]*?)\s*[\]\)]/g)];
    for (const c of corchetes) {
        const contenido = c[1].trim();
        const mAnio = contenido.match(/^((?:19|20)\d{2})$/);  // solo el año
        if (mAnio) {
            return {
                puntos: { pelicula: PESOS_PELICULA.anio },
                detecciones: { anio: parseInt(mAnio[1]), patron: 'anio_corchete_solo' }
            };
        }
        // Si el corchete contiene OTRA palabra alfabetica ademas del año
        // (ej: "Colombia - 2026"), NO es año de pelicula -> ignorar este corchete.
        // El año de pelicula debe estar aislado o al final del nombre.
    }

    // --- Caso 2: año aislado separado por . _ - espacio (fuera de corchetes) ---
    // Quitamos primero los corchetes para no matchear dentro de ellos
    const sinCorchetes = nombreOrig.replace(/[\[\(][^\]\)]*[\]\)]/g, ' ');
    const match = sinCorchetes.match(/[\s\._\-]((?:19|20)\d{2})(?:[\s\._\-]|$)/);
    if (match) {
        return {
            puntos: { pelicula: PESOS_PELICULA.anio },
            detecciones: { anio: parseInt(match[1]), patron: 'anio_separador' }
        };
    }

    return { puntos: {}, detecciones: {} };
}


/**
 * FIX M4: peli_secuela_numero ya no matchea si el nombre tiene [Cap-N],
 * [Ep-N], [Programa-N], [Gala-N] u otro patron de serie. Antes "El chapo 2
 * [Cap-1].avi" disparaba secuela_numero por el "2" final del titulo.
 */
function peli_secuela_numero(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);

    // FIX M4: descartar si hay patron de serie en cualquier parte
    if (/\[\s*(?:cap|ep|episodio|capitulo|programa|gala|concurso)\s*[-._]?\s*\d{1,4}\s*\]/i.test(nombreOrig)) {
        return { puntos: {}, detecciones: {} };
    }

    // Numero al final del nombre, con espacio antes, 1-2 digitos, no año
    const match = nombreOrig.match(/\s+(\d{1,2})$/);
    if (!match) return { puntos: {}, detecciones: {} };

    const num = parseInt(match[1]);

    // Excluir años y numeros fuera de rango razonable de secuela
    if (num < 2 || num > 20) return { puntos: {}, detecciones: {} };

    // Excluir si el resto del nombre parece serie (para no robar a serie)
    const resto = nombreOrig.substring(0, match.index);
    if (/[\s\-_]\d{2,4}$/.test(resto)) return { puntos: {}, detecciones: {} };
    if (/\bs\d{1,2}\s*e\d{1,2}\b/i.test(resto)) return { puntos: {}, detecciones: {} };
    if (/\b\d{1,2}x\d{1,2}\b/i.test(resto)) return { puntos: {}, detecciones: {} };

    return {
        puntos: { pelicula: PESOS_PELICULA.secuela_numero },
        detecciones: { parte: num, patron: 'secuela_numero' }
    };
}

// ============================================================================
// LIMPIADOR DE NOMBRE PARA PELICULA
// Adaptado de limpiarTituloParaPelicula (codigo probado en produccion).
// Diferencia con el original: devuelve { nombreLimpio, anio } en vez de string,
// para no duplicar el anio (que LUNA ya extrae en info.anio).
// ============================================================================
function limpiarNombrePelicula(nombreOriginal) {
    if (!nombreOriginal) return { nombreLimpio: null, anio: null };

    let limpio = String(nombreOriginal);

    // 1. Quitar extension
    limpio = limpio.replace(/\.(mp4|mkv|avi|mov|webm|wmv|flv|m4v|mpg|mpeg|ts|m2ts|mts|vob|3gp|ogv|divx)$/i, '');

    // 2. Extraer anio (priorizar entre parentesis/corchetes, sino el ultimo 19xx/20xx)
    let anio = null;
    const parentesisAnio = limpio.match(/[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]/);
    if (parentesisAnio) {
        anio = parseInt(parentesisAnio[1]);
        limpio = limpio.replace(new RegExp(`[\\[\(]\\s*${anio}\\s*[\\]\)]`), ' ');
    } else {
        const todosLosAnios = limpio.match(/\b(19|20)\d{2}\b/g);
        if (todosLosAnios && todosLosAnios.length) {
            anio = parseInt(todosLosAnios[todosLosAnios.length - 1]);
            limpio = limpio.replace(new RegExp(`\\b${anio}\\b`), ' ');
        }
    }

    // 3. Eliminar corchetes y llaves completos (tags de release)
    limpio = limpio.replace(/\[[^\]]*\]/g, ' ');
    limpio = limpio.replace(/\{[^\}]*\}/g, ' ');

    // 4. Eliminar cualquier otro parentesis (ya no contienen anio)
    limpio = limpio.replace(/\([^)]*\)/g, ' ');

    // 5. Normalizar separadores
    limpio = limpio.replace(/[_\-+=]+/g, ' ');
    limpio = limpio.replace(/\./g, ' ');
    limpio = limpio.replace(/\bE T\b/gi, 'E.T.');
    limpio = limpio.replace(/\bU S\b/gi, 'U.S.');

    // 6. Lista negra de terminos tecnicos
    const basuraTecnica = [
        'proper', 'repack', 'rarbg', 'supergroup', 'fgt', 'regret', 'troll',
        'cultopelis', 'reddit', 'jordanpeele', 'blumhouse', 'universal',
        'disney', 'pixar', 'marvel', 'dc', 'warner', 'sony', 'paramount',
        'netflix', 'amazon', 'hulu', 'apple', 'dsnp',
        'web-dl', 'webrip', 'hdtv', 'dvdrip', 'bdrip', 'bluray', 'uhd',
        '1080p', '2160p', '720p', '480p', '4k', '8k', '10bit', '8bit',
        'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'vp9', 'av1',
        'hdr', 'hdr10', 'hdr10\\+', 'dv', 'dolbyvision', 'hlg', 'pq', 'bt2020',
        'dolby atmos', 'atmos', 'truehd', 'dts-hd', 'dts', 'ac3', 'eac3', 'aac',
        'mp3', 'flac', 'opus', 'ddp', 'ddp5\\.1', 'ddp5 1', '7\\.1', '5\\.1', '2\\.0',
        'stereo', 'mono', 'ma', 'imax', 'cam', 'ts', 'tc', 'scr', 'r5', 'r6',
        'hd', 'fhd', 'qhd', 'remastered', 'restored', 'criterion', 'special',
        'limited', 'collector', 'ultimate', 'definitive', 'complete',
        'dual', 'dubbed', 'subbed', 'sub', 'subs', 'subtitles', 'vose', 'vo',
        'latino', 'español', 'castellano', 'ingles', 'english', 'japanese',
        'multi', 'multisub', 'softsub', 'hardsub', 'oneshot', 'silent mode',
        'black and white', 'black & chrome', 'edition', 'version',
        'commentary', 'feature', 'bonus', 'extra'
    ];
    const regexBasura = new RegExp(`\\b(${basuraTecnica.join('|')})\\b`, 'gi');
    limpio = limpio.replace(regexBasura, ' ');

    // 7. Basura numerica especifica
    const basuraNumerica = [
        '360p', '480p', '576p', '720p', '1080p', '1440p', '2160p', '4320p',
        '480i', '576i', '1080i',
        '4k', '8k', '10k',
        'hd', 'fhd', 'qhd', 'uhd', 'suhd',
        '2k', '2.5k', '5k', '6k',
        '8bit', '10bit', '12bit', '16bit',
        'hdr', 'hdr10', 'hdr10+', 'hdr10plus', 'hlg', 'pq', 'dv', 'dolbyvision',
        'bt2020', 'bt709', 'p3', 'srgb',
        'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'mpeg2', 'mpeg4',
        'vp8', 'vp9', 'av1', 'av01', 'theora', 'dirac',
        'xvid', 'divx', 'wmv', 'vc1',
        'aac', 'ac3', 'eac3', 'dts', 'dtshd', 'dtsma', 'truehd', 'mlp',
        'mp3', 'mp2', 'flac', 'opus', 'vorbis', 'pcm', 'lpcm',
        'stereo', 'mono', 'surround', 'quadro',
        'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v', '3gp',
        'avchd', 'm2ts', 'ts', 'mts',
        'bluray', 'bd25', 'bd50', 'bd66', 'bd100',
        'webdl', 'webrip', 'hdtv', 'hdtvrip', 'dvdrip', 'dvdr', 'tvrip',
        'cam', 'camrip', 'tc', 'scr', 'r5', 'r6', 'hdrip', 'sdtv',
        'directorscut', 'extendedcut', 'unrated', 'uncut', 'finalcut',
        'remastered', 'restored', 'criterion', 'specialedition',
        'limited', 'collectors', 'ultimate', 'definitive',
        'proper', 'repack', 'rerip', 'realproper', 'internal',
        'sample', 'samples', 'fix', 'fixed',
        '3d', 'sbs', 'hsbs', 'ou', 'hous', 'anaglyph',
        '60fps', '120fps', '24fps', '25fps', '30fps', '50fps'
    ];
    const regexNumBasura = new RegExp(`\\b(${basuraNumerica.join('|')})\\b`, 'gi');
    limpio = limpio.replace(regexNumBasura, ' ');

    // 8. Eliminar el anio del texto (por si quedo despues de la extraccion inicial)
    if (anio) {
        limpio = limpio.replace(new RegExp(`\\b${anio}\\b`, 'g'), ' ');
    }

    // 9. Limpiar espacios multiples
    limpio = limpio.replace(/\s+/g, ' ').trim();

    // 10. Capitalizacion inteligente (preserva romanos y abreviaturas)
    limpio = limpio.split(' ')
        .map(palabra => {
            if (!palabra) return '';
            if (palabra === palabra.toUpperCase() && palabra.length > 1) {
                return palabra;
            }
            return palabra[0].toUpperCase() + palabra.slice(1).toLowerCase();
        })
        .join(' ');

    // 11. Devolver nombreLimpio SIN el anio (el anio va aparte en info.anio)
    return {
        nombreLimpio: limpio || null,
        anio: anio
    };
}
// ============================================================================
// LIMPIADOR AVANZADO DE NOMBRE PARA SERIE
// Adaptado de limpiarTitulo (codigo probado en produccion) + extras.
// Diferencia con el original: devuelve objeto con nombreLimpio + metadata
// extraida (temporada, capitulo, anio) por si el limpiador detecta algo
// que las banderas no vieron. NO reemplaza a limpiarNombreSerie (la simple).
// ============================================================================
function limpiarNombreSerieAvanzado(nombreOriginal) {
    if (!nombreOriginal) return { nombreLimpio: null, temporada: null, capitulo: null, anio: null };

    let limpio = String(nombreOriginal);

    // 1. Quitar extension primero
    limpio = limpio.replace(/\.(mkv|mp4|avi|srt|m4v|webm|mov|wmv|mpg|mpeg|ts|m2ts|mts|vob|3gp|ogv|divx)$/i, '');

    // 2. Extraer metadata ANTES de limpiar (para no perderla)
    let temporada = null;
    let capitulo = null;
    let anio = null;

    // SxxExx y variantes con guiones/guion bajo / separados en corchetes
    let m = limpio.match(/\b[Ss](\d{1,2})\s*[_\-\s]*[Ee](\d{1,2})\b/);
    if (m) {
        temporada = parseInt(m[1]);
        capitulo = parseInt(m[2]);
    }

    if (temporada === null) {
        m = limpio.match(/\[\s*[Ss]\s*(\d{1,2})\s*\]\s*\[\s*[Ee]\s*(\d{1,2})\s*\]/i);
        if (m) {
            temporada = parseInt(m[1]);
            capitulo = parseInt(m[2]);
        }
    }

    // NxN
    if (temporada === null) {
        m = limpio.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,2})\b/);
        if (m) {
            temporada = parseInt(m[1]);
            capitulo = parseInt(m[2]);
        }
    }

    // Season N (ingles)
    if (temporada === null) {
        m = limpio.match(/\b[Ss]eason\s*\.?\s*(\d{1,2})\b/i);
        if (m) temporada = parseInt(m[1]);
    }

    // Temporada N / Temp N (espanol)
    if (temporada === null) {
        m = limpio.match(/\b[Tt](?:emporada|emp)\s*\.?\s*(\d{1,2})\b/i);
        if (m) temporada = parseInt(m[1]);
    }

    // Episodio N / Capitulo N / Cap N / Ep N / [E003], [E22]
    if (capitulo === null) {
        m = limpio.match(/\b(?:Episodio|Capitulo|Cápitulo|cápitulo|Cap|Ep|Episode|E)\s*\.?\s*(\d{1,4})\b/i)
          || limpio.match(/\[\s*(?:E|Ep|Episode|Episodio)\s*\.?\s*(\d{1,4})\s*\]/i);
        if (m) capitulo = parseInt(m[1]);
    }

    // Anio
    m = limpio.match(/[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]/);
    if (m) {
        anio = parseInt(m[1]);
    } else {
        const anios = limpio.match(/\b(?:19|20)\d{2}\b/g);
        if (anios && anios.length) anio = parseInt(anios[anios.length - 1]);
    }

    // 3. Eliminar corchetes y llaves completos (tags)
    limpio = limpio.replace(/\[[^\]]*\]/g, ' ');
    limpio = limpio.replace(/\{[^\}]*\}/g, ' ');

    // 4. Eliminar parentesis que ya no contienen anio (o cualquier otro)
    limpio = limpio.replace(/\([^)]*\)/g, ' ');

    // 5. Eliminar patrones de serie del texto
    //    (ya extraidos arriba, ahora solo se borran del nombre)
    limpio = limpio.replace(/\b[Ss]\d{1,2}\s*[_\-\s]*[Ee]\d{1,2}\b/g, ' ');
    limpio = limpio.replace(/\[\s*[Ss]\s*\d{1,2}\s*\]\s*\[\s*[Ee]\s*\d{1,2}\s*\]/gi, ' ');
    limpio = limpio.replace(/\b\d{1,2}\s*[xX]\s*\d{1,2}\b/g, ' ');
    limpio = limpio.replace(/\b[Ss]eason\s*\.?\s*\d{1,2}\b/gi, ' ');
    limpio = limpio.replace(/\b[Tt](?:emporada|emp)\s*\.?\s*\d{1,2}\b/gi, ' ');
    limpio = limpio.replace(/\b(?:Episodio|Capitulo|Cápitulo|cápitulo|Cap|Ep|Episode)\s*\.?\s*\d{1,4}\b/gi, ' ');
    limpio = limpio.replace(/\b[Ss]eason\b/gi, ' ');
    limpio = limpio.replace(/\b[Tt](?:emporada|emp)\b/gi, ' ');

    // 6. Eliminar anio del texto (ya extraido)
    if (anio) {
        limpio = limpio.replace(new RegExp(`\\b${anio}\\b`, 'g'), ' ');
    }

    // 7. Normalizar separadores
    limpio = limpio.replace(/[\\/]+/g, ' ');
    limpio = limpio.replace(/[_\.\-=\+]+/g, ' ');
    limpio = limpio.replace(/[,\(\)\[\]\{\}]+/g, ' ');

    // 8. Eliminar resoluciones, codecs, formatos
    limpio = limpio.replace(/\b(480p|720p|1024p|1080p|2160p|4k|HD|DVD|bluray|brrip|webrip|x264|x265|dvdrip|HDRip|HDTV|WEB-DL|CAM|Repack|Final|Special|hdr|hevc|aac|ac3|dts|xvid|r5|ts|FULL|Full|full)\b/ig, ' ');

    // 9. Eliminar ordinales (1st, 2nd, etc.)
    limpio = limpio.replace(/\b(1st|9th|8th|7th|6th|5th|4th|2nd|3rd|1ro|9no|8vo|7mo|6to|5to|4to|2do|3ro)\b/ig, ' ');

    // 10. Eliminar OVA/ONA/Special/Movie/Pelicula
    limpio = limpio.replace(/\b(OVA|ONA|Special|MonosChinos|Monoschinos|Movie|Pel[ií]cula)\b/ig, ' ');

    // 11. Eliminar palabras de idioma (lista de limpiarTitulo)
    limpio = limpio.replace(/\b(Español|español|Castellano|castellano|Latino|latino|Inglés|inglés|English|english|Japonés|japonés|Japanese|japanese|Alemán|alemán|German|german|Francés|francés|French|french|Italiano|italiano|Italian|italian|Portugués|portugués|Portuguese|portuguese|Ruso|ruso|Russian|russian|Chino|chino|Chinese|chinese|Coreano|coreano|Korean|korean|Árabe|árabe|Arabic|arabic|Hindi|hindi|Turco|turco|Turkish|turkish|Polaco|polaco|Polish|polish|Sueco|sueco|Swedish|swedish|Danés|danés|Danish|danish|Holandés|holandés|Dutch|dutch|Griego|griego|Greek|greek|Checo|checo|Czech|czech|Húngaro|húngaro|Hungarian|hungarian|Rumano|rumano|Romanian|romanian|Tailandés|tailandés|Thai|thai|Vietnamita|vietnamita|Vietnamese|vietnamese|Hebreo|hebreo|Hebrew|hebrew|Noruego|noruego|Norwegian|norwegian|Finlandés|finlandés|Finnish|finnish|Catalán|catalán|Catalan|catalan|Gallego|gallego|Galician|galician|Vasco|vasco|Basque|basque|Serbio|serbio|Serbian|serbian|Croata|croata|Croatian|croatian|Búlgaro|búlgaro|Bulgarian|bulgarian|Eslovaco|eslovaco|Slovak|slovak|Esloveno|esloveno|Slovenian|slovenian|Lituano|lituano|Lithuanian|lithuanian|Letón|letón|Latvian|latvian|Estonio|estonio|Estonian|estonian|Islandés|islandés|Icelandic|icelandic|Macedonio|macedonio|Macedonian|macedonian|Albanés|albanés|Albanian|albanian|Bosnio|bosnio|Bosnian|bosnian|Georgiano|georgiano|Georgian|georgian|Armenio|armenio|Armenian|armenian|Persa|persa|Persian|persian|Urdú|urdú|Urdu|urdu|Bengalí|bengalí|Bengali|bengali|Tagalo|tagalo|Tagalog|tagalog|Malayo|malayo|Malay|malay|Indonesio|indonesio|Indonesian|indonesian|Ucraniano|ucraniano|Ukrainian|ukrainian|Bielorruso|bielorruso|Belarusian|belarusian|Mongol|mongol|Mongolian|mongolian|Nepalí|nepalí|Nepali|nepali|Sinhala|sinhala|Sinhalese|sinhalese|Camboyano|camboyano|Khmer|khmer|Laosiano|laosiano|Lao|lao|Birmano|birmano|Burmese|burmese)\b/ig, ' ');

    // 12. Eliminar Subs/Sub/Subtitulos
    limpio = limpio.replace(/\b(Sub|sub|Subs|subs|Subtítulos|subtítulos|Subtitulos|subtitulos|Subtitle|subtitle|Subtitles|subtitles|Subbed|subbed|Softsub|softsub|Hardsub|hardsub)\b/ig, ' ');

    // 13. Eliminar Dual/Doblado/VOSE
    limpio = limpio.replace(/\b(Dual|dual|Dual Audio|dual audio|Doblado|doblado|Dubbed|dubbed|Latino Doblado|latino doblado|Castellano Doblado|castellano doblado|VOSE|vose|VO|vo|VOS|vos|SubEsp|subesp|SubEng|subeng|ESP-ENG|esp-eng)\b/ig, ' ');

    // 14. Eliminar calidad de audio
    limpio = limpio.replace(/\b(AC3|ac3|AAC|aac|MP3|mp3|DTS|dts|DTS-HD|dts-hd|FLAC|flac|Opus|opus|EAC3|eac3|TrueHD|truehd|Atmos|atmos)\b/ig, ' ');

    // 15. Eliminar grupos de fansub
    limpio = limpio.replace(/\b(AnimeFLV|animeflv|JKAnime|jkanime|MonosChinos|[EXTENDED]|[REMASTERED]|[DC]|[Director's Cut]|[CENSURADO]|[UNCUT]|[UNRATED]|[CULT]|[RETRO]|[CLASICA]|[CLASICO]|[ESTRENO]|[SD]|[PREMIUM]|[VIP]|[TX]|[FHD]|[UHD]|monoschinos|MundoAnime|mundoanime|LegionAnime|legionanime|Henshin|henshin|Kagura|kagura|Ohys-Raws|ohys-raws|Erai-raws|erai-raws|SubsPlease|subsplease|Judas|judas|BD|bd|BDRip|bdrip)\b/ig, ' ');

    // 16. Reducir espacios multiples
    limpio = limpio.replace(/\s{2,}/g, ' ').trim();

    // 17. Capitalizacion tipo Title Case
    limpio = limpio
        .split(' ')
        .map(palabra => palabra ? palabra[0].toUpperCase() + palabra.slice(1).toLowerCase() : '')
        .join(' ')
        .trim();

    return {
        nombreLimpio: limpio || null,
        temporada: temporada,
        capitulo: capitulo,
        anio: anio
    };
}
// ----------------------------------------------------------------------------
// Bandera 3: Secuela con numero romano
// John Wick II, Rocky IV, Rambo III, Harry Potter VII
// Acepta II, III, IV, V, VI, VII, VIII, IX, X
// ----------------------------------------------------------------------------
function peli_secuela_romano(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);

    // Numero romano aislado al final del nombre
    const match = nombreOrig.match(/\s+(X|IX|VIII|VII|VI|IV|V|III|II)\b/);
    if (!match) return { puntos: {}, detecciones: {} };

    const romanos = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    const num = romanos[match[1].toUpperCase()];

    if (!num || num < 2) return { puntos: {}, detecciones: {} };

    return {
        puntos: { pelicula: PESOS_PELICULA.secuela_romano },
        detecciones: { parte: num, patron: 'secuela_romano', parteRomano: match[1] }
    };
}


// ----------------------------------------------------------------------------
// Bandera 4: Secuela con palabra
// Part 2, Parte II, Chapter 3, Book 2, Volume 4
// ----------------------------------------------------------------------------
function peli_secuela_palabra(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);

    const match = nombreOrig.match(/\b(?:part|parte|chapter|capitulo|book|volume|vol)\s*\.?\s*(\d{1,2}|I{1,3}|IV|V|VI{0,3}|IX|X)\b/i);
    if (!match) return { puntos: {}, detecciones: {} };

    const valor = match[1];
    let num = null;

    if (/^\d+$/.test(valor)) {
        num = parseInt(valor);
    } else {
        const romanos = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
        num = romanos[valor.toUpperCase()] || null;
    }

    if (!num || num < 2) return { puntos: {}, detecciones: {} };

    return {
        puntos: { pelicula: PESOS_PELICULA.secuela_palabra },
        detecciones: { parte: num, patron: 'secuela_palabra' }
    };
}


// ----------------------------------------------------------------------------
// Bandera 5: Ruta padre contiene "Películas" / "Peliculas" / "PELIS" / "Pelis" / "Movies"
// Ampliada con variantes con tilde/sin tilde, singular/plural, y tags.
// ----------------------------------------------------------------------------
function peli_ruta_pelicula(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    // Buscar palabra exacta como token en alguna carpeta
    const palabrasClave = [
        'pelicula', 'peliculas', 'películas',
        'peli', 'pelis',
        'movies', 'movie',
        'films', 'film'
    ];

    for (const c of carpetas) {
        const cMin = c.toLowerCase().trim();

        // Limpiamos tags tipo "[HD]" o "[Estreno]" para que "Peliculas [HD]" quede "peliculas"
        const cSinTags = cMin.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

        for (const clave of palabrasClave) {
            // Match como palabra completa dentro de la carpeta
            const re = new RegExp(`(?:^|\\s)${clave}(?:\\s|$)`, 'i');
            if (re.test(cSinTags)) {
                return {
                    puntos: { pelicula: PESOS_PELICULA.ruta_pelicula },
                    detecciones: { rutaPista: 'pelicula', patron: 'ruta_pelicula' }
                };
            }
        }
    }

    return { puntos: {}, detecciones: {} };
}


// ----------------------------------------------------------------------------
// Bandera 6: Ruta padre contiene tag tipico de carpeta de pelicula
// Ej: "Peliculas [Estreno] [4K]", "Peliculas [HD] [2020-2026]", "Peliculas [Clasicas]"
// ----------------------------------------------------------------------------
function peli_ruta_pelicula_tag(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    const tags = [
        'estreno', 'clasica', 'clásica', 'clasicas', 'clásicas',
        'hd', '4k', 'uhd', 'bluray', 'blu-ray',
        '2020-2026', '2010-2019', '2000-2009', '1990-1999'
    ];

    for (const c of carpetas) {
        const cMin = c.toLowerCase();
        // Solo dentro de corchetes para no disparar con cualquier cosa
        const tagsEnCarpeta = [...cMin.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());
        for (const tag of tagsEnCarpeta) {
            if (tags.includes(tag)) {
                return {
                    puntos: { pelicula: PESOS_PELICULA.ruta_pelicula_tag },
                    detecciones: { rutaPista: `tag_${tag}`, patron: 'ruta_pelicula_tag' }
                };
            }
        }
    }

    return { puntos: {}, detecciones: {} };
}


// ----------------------------------------------------------------------------
// Bandera 7: Ruta padre contiene genero tipico de carpeta de pelicula
// Ej: "Y:\Acción\...", "Y:\Terror\...", "Y:\Comedia\..."
// ----------------------------------------------------------------------------
function peli_ruta_genero(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    const generos = [
        'accion', 'acción', 'action',
        'terror', 'horror',
        'comedia', 'comedy',
        'drama',
        'suspenso', 'suspense', 'thriller',
        'aventura', 'adventure',
        'animacion', 'animación', 'animation', 'animadas', 'animados',
        'ciencia ficcion', 'ciencia ficción', 'sci-fi', 'scifi',
        'fantasia', 'fantasía', 'fantasy',
        'romance',
        'belico', 'bélico', 'war',
        'western',
        'documental', 'documentales', 'documentary'
    ];

    for (const c of carpetas) {
        const cMin = c.toLowerCase().trim();
        const cSinTags = cMin.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

        for (const gen of generos) {
            const re = new RegExp(`(?:^|\\s)${gen}(?:\\s|$)`, 'i');
            if (re.test(cSinTags)) {
                return {
                    puntos: { pelicula: PESOS_PELICULA.ruta_genero },
                    detecciones: { genero: gen, patron: 'ruta_genero' }
                };
            }
        }
    }

    return { puntos: {}, detecciones: {} };
}


// ----------------------------------------------------------------------------
// Bandera 8: Duracion tipica de pelicula (45 min - 4 h)
// ----------------------------------------------------------------------------
function peli_duracion(archivo) {
    const d = archivo.duracion || 0;
    if (d === 0) return { puntos: {}, detecciones: {} };

    if (d >= DURACION.PELICULA_MIN && d <= DURACION.PELICULA_MAX) {
        return {
            puntos: { pelicula: PESOS_PELICULA.duracion_tipica_pelicula },
            detecciones: {
                duracionTipica: 'pelicula',
                duracionSegundos: d,
                patron: 'duracion_pelicula'
            }
        };
    }

    return { puntos: {}, detecciones: {} };
}


// ----------------------------------------------------------------------------
// Bandera 9: Tag de calidad tipico de pelicula
// [1080p], [2160p], [4K UHD HDR10], [BluRay], [60 FPS]
// ----------------------------------------------------------------------------
function peli_calidad_tag(archivo) {
    const nombre = archivo.nombreOriginal;

    const match = nombre.match(/\[\s*(?:1080p|2160p|720p|480p|4k|uhd|hdr|hdr10|bluray|blu-ray|bdrip|brrip|webrip|web-dl|60\s*fps|24\s*fps|imax)\b[^\]]*\]/i);

    if (!match) return { puntos: {}, detecciones: {} };

    return {
        puntos: { pelicula: PESOS_PELICULA.calidad_tag },
        detecciones: {
            calidad: match[0].replace(/[\[\]]/g, '').trim().toLowerCase(),
            patron: 'calidad_tag'
        }
    };
}


// ----------------------------------------------------------------------------
// Bandera 10: Marca de idioma / audio (mismo criterio que serie, distinto peso)
// ----------------------------------------------------------------------------
function peli_idioma_marca(archivo) {
    const nombre = archivo.nombreOriginal;
    const m = nombre.match(/\[(?:esp|dual\s*[- ]?a(?:udio)?|dual\s*audio|castellano|latino|espa[ñn]ol|ingles|english)\]/i);

    if (!m) return { puntos: {}, detecciones: {} };

    return {
        puntos: { pelicula: PESOS_PELICULA.idioma_marca },
        detecciones: {
            idioma: m[0].replace(/[\[\]]/g, '').toLowerCase(),
            patron: 'idioma_marca'
        }
    };
}


/**
 * FIX I5: peli_sin_patron_serie ahora excluye [Gala - N], [Programa - N],
 * [Concurso - N], [Cap - N], [Ep - N] (con o sin guion bajo/punto).
 * Antes "Yo Me Llamo [Colombia - 2026] - [Gala - 037].mp4" sumaba +15 a peli
 * porque no veia patron serie.
 */
function peli_sin_patron_serie(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);
    const nombre = normalizarParaMatching(nombreOrig);

    // Patrones de serie a excluir
    if (/\bs\d{1,2}\s*e\d{1,2}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };
    if (/\b\d{1,2}\s*x\s*\d{1,2}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };
    if (/\b(?:cap|capitulo|ep|episodio|episode)\s*[-.]?\s*\d{1,3}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };
    if (/[\s\-_]\d{2,4}$/.test(nombreOrig)) return { puntos: {}, detecciones: {} };
    if (/\bt(?:emporada)?\s*\.?\s*\d{1,2}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };

    // FIX I5: [Gala - N], [Programa - N], [Concurso - N] tambien son serie
    if (/\[\s*(?:programa|gala|concurso|emision|emisión)\s*[-._]?\s*\d{1,4}\s*\]/i.test(nombreOrig)) {
        return { puntos: {}, detecciones: {} };
    }
    // FIX M4/I5: [Cap-N], [Ep-N] con _ o . tambien son serie
    if (/\[\s*(?:cap|capitulo|ep|episodio|capitulo)\s*[-._]?\s*\d{1,4}\s*\]/i.test(nombreOrig)) {
        return { puntos: {}, detecciones: {} };
    }

    return {
        puntos: { pelicula: PESOS_PELICULA.sin_patron_serie },
        detecciones: { patron: 'sin_patron_serie' }
    };
}

// ============================================================================
// BANDERAS SINCRONAS DE VARIADO
// ============================================================================


function variado_duracion_corta(archivo) {
    const d = archivo.duracion || 0;
    if (d === 0) return { puntos: {}, detecciones: {} };

    if (d >= DURACION.VARIADO_MIN && d <= DURACION.VARIADO_MAX) {
        return {
            puntos: { variado: PESOS_VARIADO.duracion_corta },
            detecciones: {
                duracionTipica: 'variado',
                duracionSegundos: d,
                patron: 'duracion_corta'
            }
        };
    }

    return { puntos: {}, detecciones: {} };
}


function variado_duracion_muy_corta(archivo) {
    const d = archivo.duracion || 0;
    if (d === 0) return { puntos: {}, detecciones: {} };

    if (d < DURACION.VARIADO_MIN) {
        return {
            puntos: { variado: PESOS_VARIADO.duracion_muy_corta },
            detecciones: {
                duracionTipica: 'muy_corta',
                duracionSegundos: d,
                patron: 'duracion_muy_corta'
            }
        };
    }

    return { puntos: {}, detecciones: {} };
}


function variado_ruta_variados(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    const claves = ['variados', 'varios', 'random', 'misc', 'otros', 'varias'];

    for (const c of carpetas) {
        const cMin = c.toLowerCase().trim();
        const cSinTags = cMin.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

        for (const clave of claves) {
            const re = new RegExp(`(?:^|\\s)${clave}(?:\\s|$)`, 'i');
            if (re.test(cSinTags)) {
                return {
                    puntos: { variado: PESOS_VARIADO.ruta_variados },
                    detecciones: { rutaPista: clave, patron: 'ruta_variados' }
                };
            }
        }
    }

    return { puntos: {}, detecciones: {} };
}


function variado_ruta_personal(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    const claves = [
        'personal', 'mis videos', 'mis fotos', 'camara', 'cámara',
        'celular', 'telefono', 'teléfono', 'grabaciones', 'whatsapp'
    ];

    for (const c of carpetas) {
        const cMin = c.toLowerCase().trim();

        for (const clave of claves) {
            const re = new RegExp(`(?:^|\\s)${clave}(?:\\s|$)`, 'i');
            if (re.test(cMin)) {
                return {
                    puntos: { variado: PESOS_VARIADO.ruta_personal },
                    detecciones: { rutaPista: clave, patron: 'ruta_personal' }
                };
            }
        }
    }

    return { puntos: {}, detecciones: {} };
}


function variado_ruta_documental(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    for (const c of carpetas) {
        if (/\bdocumentales?\b/i.test(c)) {
            return {
                puntos: { variado: PESOS_VARIADO.ruta_documental },
                detecciones: { rutaPista: 'documental', patron: 'ruta_documental' }
            };
        }
    }

    return { puntos: {}, detecciones: {} };
}


function variado_ruta_animados_variados(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    for (const c of carpetas) {
        if (/animados?\s*variados?/i.test(c) || /animados?\s*varios?/i.test(c)) {
            return {
                puntos: { variado: PESOS_VARIADO.ruta_animados_variados },
                detecciones: { rutaPista: 'animados_variados', patron: 'ruta_animados_variados' }
            };
        }
    }

    return { puntos: {}, detecciones: {} };
}


function variado_ruta_interesantes(archivo) {
    const carpetas = obtenerCarpetasDeRuta(archivo.ruta);

    for (const c of carpetas) {
        if (/interesantes?/i.test(c)) {
            return {
                puntos: { variado: PESOS_VARIADO.ruta_interesantes },
                detecciones: { rutaPista: 'interesantes', patron: 'ruta_interesantes' }
            };
        }
    }

    return { puntos: {}, detecciones: {} };
}


function variado_ruta_cuba_generica(archivo) {
    const texto = carpetasComoTexto(archivo.ruta);
    const tieneCuba = /secci[oó]n\s*cuba/.test(texto);
    const tieneNovela = /\bnovelas?\b/.test(texto);

    if (tieneCuba && !tieneNovela) {
        return {
            puntos: { variado: PESOS_VARIADO.ruta_cuba_generica },
            detecciones: { rutaPista: 'cuba_generica', patron: 'ruta_cuba_generica' }
        };
    }

    return { puntos: {}, detecciones: {} };
}


function variado_nombre_personal(archivo) {
    const nombre = archivo.nombreOriginal;

    const patrones = [
        /\bIMG[_\-\s]?\d/i,
        /\bVID[_\-\s]?\d/i,
        /\bMVI[_\-\s]?\d/i,
        /\bDSC[_\-\s]?\d/i,
        /\bWhatsApp[_\-\s]/i,
        /\bWA\d{4}/i,
        /\bgrabaci[oó]n/i,
        /\bvideo[_\-\s]?\d{1,4}$/i
    ];

    for (const p of patrones) {
        if (p.test(nombre)) {
            return {
                puntos: { variado: PESOS_VARIADO.nombre_personal },
                detecciones: { marcaPersonal: p.toString(), patron: 'nombre_personal' }
            };
        }
    }

    return { puntos: {}, detecciones: {} };
}


function variado_nombre_generico(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);
    const nombreNorm = nombreOrig.trim().toLowerCase();

    if (/^(?:video|clip|sample|videoclip|trailer|teaser|fragmento)$/i.test(nombreNorm)) {
        return {
            puntos: { variado: PESOS_VARIADO.nombre_generico },
            detecciones: { patron: 'nombre_generico', nombre: nombreNorm }
        };
    }

    if (/^\d{1,4}$/.test(nombreNorm)) {
        return {
            puntos: { variado: PESOS_VARIADO.nombre_generico },
            detecciones: { patron: 'nombre_solo_numero' }
        };
    }

    return { puntos: {}, detecciones: {} };
}


function variado_sin_patron_conocido(archivo) {
    const nombreOrig = quitarExtension(archivo.nombreOriginal);
    const nombre = normalizarParaMatching(nombreOrig);

    // Excluir contadores tipo "Bless The Harts (1) [28-08-26]" que no son episodios ni series,
    // sino videos sueltos/animados variados con numeracion de duplicado.
    if (/\(\d{1,2}\)\s*\[[0-9]{2}-[0-9]{2}-[0-9]{2}\]$/.test(nombreOrig)) {
        return {
            puntos: { variado: PESOS_VARIADO.sin_patron_conocido },
            detecciones: { patron: 'animado_duplicado_fecha' }
        };
    }

    // Patrones de serie a excluir
    if (/\bs\d{1,2}\s*e\d{1,2}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };
    if (/\b\d{1,2}\s*x\s*\d{1,2}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };
    if (/\b(?:cap|capitulo|ep|episodio|episode)\s*[-.]?\s*\d{1,3}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };
    if (/[\s\-_]\d{2,4}$/.test(nombreOrig)) return { puntos: {}, detecciones: {} };
    if (/\bt(?:emporada)?\s*\.?\s*\d{1,2}\b/i.test(nombre)) return { puntos: {}, detecciones: {} };

    // Patrones de peli a excluir
    if (/[\[\(]\s*(?:19|20)\d{2}\s*[\]\)]/.test(nombreOrig)) return { puntos: {}, detecciones: {} };
    if (/[\s\._\-](?:19|20)\d{2}[\s\._\-]?/.test(nombreOrig)) return { puntos: {}, detecciones: {} };

    return {
        puntos: { variado: PESOS_VARIADO.sin_patron_conocido },
        detecciones: { patron: 'sin_patron_conocido' }
    };
}


// ----------------------------------------------------------------------------
// Bandera 12: Metadato regalado dice "camara" o "telefono"
// ----------------------------------------------------------------------------
function variado_metadato_camara(archivo) {
    const metadatos = archivo.metadatos;
    if (!Array.isArray(metadatos) || metadatos.length === 0) {
        return { puntos: {}, detecciones: {} };
    }

    const texto = metadatos.map(m => {
        if (typeof m === 'string') return m.toLowerCase();
        if (m && typeof m === 'object') {
            return `${m.clave || ''} ${m.valor || ''}`.toLowerCase();
        }
        return '';
    }).join(' ');

    const claves = [
        'camera', 'camara', 'cámara', 'phone', 'telefono', 'teléfono',
        'iphone', 'android', 'samsung', 'xiaomi', 'huawei',
        'gopro', 'dslr', 'canon', 'nikon', 'sony ericsson'
    ];

    for (const clave of claves) {
        if (texto.includes(clave)) {
            return {
                puntos: { variado: PESOS_VARIADO.metadato_camara },
                detecciones: { metadatoPista: clave, patron: 'metadato_camara' }
            };
        }
    }

    return { puntos: {}, detecciones: {} };
}


// ----------------------------------------------------------------------------
// Bandera 13: Metadato regalado dice "personal" / "grabacion" / "whatsapp"
// ----------------------------------------------------------------------------
function variado_metadato_personal(archivo) {
    const metadatos = archivo.metadatos;
    if (!Array.isArray(metadatos) || metadatos.length === 0) {
        return { puntos: {}, detecciones: {} };
    }

    const texto = metadatos.map(m => {
        if (typeof m === 'string') return m.toLowerCase();
        if (m && typeof m === 'object') {
            return `${m.clave || ''} ${m.valor || ''}`.toLowerCase();
        }
        return '';
    }).join(' ');

    const claves = ['personal', 'whatsapp', 'grabacion', 'grabación', 'recording', 'screen record'];

    for (const clave of claves) {
        if (texto.includes(clave)) {
            return {
                puntos: { variado: PESOS_VARIADO.metadato_personal },
                detecciones: { metadatoPista: clave, patron: 'metadato_personal' }
            };
        }
    }

    return { puntos: {}, detecciones: {} };
}
// ============================================================================
// BANDERA ASINCRONA COMPARTIDA: INVESTIGAR CARPETA
// ============================================================================

const EXTENSIONES_VIDEO = new Set([
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv', '.m4v',
    '.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.3gp', '.ogv', '.divx'
]);

function esVideo(nombreArchivo) {
    const ext = path.extname(nombreArchivo).toLowerCase();
    return EXTENSIONES_VIDEO.has(ext);
}


async function investigar_carpeta(archivo, contexto) {
    const puntosSerieActual = (contexto && contexto.puntosSerieActual) || 0;

    const serieYaResuelta = puntosSerieActual >= UMBRAL_SALTAR_INVESTIGACION;

    if (!archivo.ruta) return { puntos: {}, detecciones: {} };

    const carpeta = path.dirname(archivo.ruta);
    const nombreArchivo = path.basename(archivo.ruta);

    let entradas;
    try {
        entradas = await fsp.readdir(carpeta, { withFileTypes: true });
    } catch (e) {
        return {
            puntos: {},
            detecciones: {
                investigacion: {
                    ok: false,
                    motivo: e.code || e.message
                }
            }
        };
    }

    const hermanos = entradas
        .filter(e => e.isFile() && esVideo(e.name))
        .map(e => e.name);

    const totalHermanos = hermanos.length;

    // Consecutividad numerica pura: 1.mp4, 2.mp4, 03.mp4, 004.mp4
    const numerosSolo = hermanos
        .map(n => {
            const base = quitarExtension(n).trim();
            if (/^\d{1,4}$/.test(base)) return parseInt(base);
            return null;
        })
        .filter(n => n !== null)
        .sort((a, b) => a - b);

    let consecutivos = 0;
    if (numerosSolo.length >= 5) {
        consecutivos = 1;
        for (let i = 1; i < numerosSolo.length; i++) {
            if (numerosSolo[i] === numerosSolo[i - 1] + 1) consecutivos++;
            else break;
        }
    }

    // Hermanos con patron serie en el nombre
    let conPatronSerie = 0;
    for (const h of hermanos) {
        const base = quitarExtension(h);
        const norm = normalizarParaMatching(base);
        if (
            /\bs\d{1,2}\s*e\d{1,2}\b/i.test(norm) ||
            /\b\d{1,2}\s*x\s*\d{1,2}\b/i.test(norm) ||
            /\b(?:cap|capitulo|ep|episodio|episode)\s*[-.]?\s*\d{1,3}\b/i.test(norm) ||
            /[\s\-_]\d{2,4}$/.test(base)
        ) {
            conPatronSerie++;
        }
    }

    // ---- Puntos para SERIE ----
    let puntosSerie = 0;
    const detSerie = {};
    if (!serieYaResuelta) {
        if (consecutivos >= 20) {
            puntosSerie += PESOS_SERIE.investigar_consecutivo_fuerte;
        } else if (consecutivos >= 5) {
            puntosSerie += PESOS_SERIE.investigar_consecutivo_debil;
        }
        if (totalHermanos >= 20) {
            puntosSerie += PESOS_SERIE.investigar_muchos_hermanos;
        }
        if (conPatronSerie >= 5) {
            puntosSerie += PESOS_SERIE.investigar_nombres_serie;
        }
    }

    // ---- Puntos para PELICULA ----
    let puntosPeli = 0;
    const detPeli = {};
    if (totalHermanos <= 1) {
        puntosPeli += PESOS_PELICULA.investigar_un_solo_video;
        detPeli.pocosHermanos = 'solo';
    } else if (totalHermanos <= 3) {
        puntosPeli += PESOS_PELICULA.investigar_pocos_videos;
        detPeli.pocosHermanos = totalHermanos;
    }
    if (consecutivos === 0 && numerosSolo.length <= 2) {
        puntosPeli += PESOS_PELICULA.investigar_sin_consecutivo;
        detPeli.sinConsecutivo = true;
    }

    // ---- Detecciones comunes ----
    const detecciones = {
        investigacion: {
            ok: true,
            totalHermanos,
            numerosSolo: numerosSolo.length,
            consecutivos,
            conPatronSerie
        }
    };

    const numeroArchivoBase = quitarExtension(nombreArchivo).trim();
    const numeroEsteArchivo = /^\d{1,4}$/.test(numeroArchivoBase)
        ? parseInt(numeroArchivoBase)
        : null;
    if (numeroEsteArchivo !== null && puntosSerie > 0) {
        detecciones.capitulo = numeroEsteArchivo;
    }

    if (puntosSerie > 0) {
        const nombreSerie = nombreDesdeCarpetaPadre(archivo.ruta);
        if (nombreSerie) detecciones.nombreSerie = nombreSerie;
    }

    Object.assign(detecciones, detSerie, detPeli);

    const puntos = {};
    if (puntosSerie > 0) puntos.serie = puntosSerie;
    if (puntosPeli  > 0) puntos.pelicula = puntosPeli;

    return { puntos, detecciones };
}


// ============================================================================
// REGISTRO DE BANDERAS
// ============================================================================

const BANDERAS_SERIE_SINCRONAS = [
    // --- Nombre ---
    serie_sxxexx,
    serie_nxm,
    serie_capitulo_texto,
    serie_capitulo_en_corchete,
    serie_capitulo_programa,       // FIX C3: registrada
    serie_capitulo_numero_suelto,
    serie_temporada_en_nombre,
    // --- Ruta ---
    serie_ruta_novela,
    serie_ruta_series,
    serie_ruta_doramas,
    serie_ruta_shows,
    serie_ruta_concursos,
    serie_ruta_cuba,
    serie_ruta_temporada_carpeta,
    serie_ruta_pista_debil,
    // --- Duracion + idioma ---
    serie_duracion,
    serie_idioma_marca
];

const BANDERAS_PELICULA_SINCRONAS = [
    // --- Nombre ---
    peli_anio,
    peli_secuela_numero,
    peli_secuela_romano,
    peli_secuela_palabra,
    // --- Ruta ---
    peli_ruta_pelicula,
    peli_ruta_pelicula_tag,
    peli_ruta_genero,
    // --- Duracion + tags ---
    peli_duracion,
    peli_calidad_tag,
    peli_idioma_marca,
    // --- Descarte ---
    peli_sin_patron_serie
];

const BANDERAS_VARIADO_SINCRONAS = [
    // --- Duracion ---
    variado_duracion_corta,
    variado_duracion_muy_corta,
    // --- Ruta ---
    variado_ruta_variados,
    variado_ruta_personal,
    variado_ruta_documental,
    variado_ruta_animados_variados,
    variado_ruta_interesantes,
    variado_ruta_cuba_generica,
    // --- Nombre ---
    variado_nombre_personal,
    variado_nombre_generico,
    variado_sin_patron_conocido,
    // --- Metadatos ---
    variado_metadato_camara,
    variado_metadato_personal
];

const BANDERAS_COMPARTIDAS_ASINCRONAS = [
    investigar_carpeta
];


// ============================================================================
// EJECUTOR DE BANDERAS
// ============================================================================

function ejecutarBanderasSincronas(banderas, archivo, categoria) {
    let puntosTotales = 0;
    const detecciones = {};
    const banderasQueSumaron = [];

    for (const bandera of banderas) {
        let resultado;
        try {
            resultado = bandera(archivo);
        } catch (e) {
            continue;
        }
        if (!resultado) continue;

        const puntos = (resultado.puntos && resultado.puntos[categoria]) || 0;
        if (puntos === 0) continue;

        puntosTotales += puntos;
        banderasQueSumaron.push({
            nombre: bandera.name,
            puntos,
            detecciones: resultado.detecciones || {}
        });

        const det = resultado.detecciones || {};
        for (const clave of Object.keys(det)) {
            const valorNuevo = det[clave];
            if (valorNuevo === null || valorNuevo === undefined) continue;
            if (detecciones[clave] === undefined || detecciones[clave] === null) {
                detecciones[clave] = valorNuevo;
            }
        }
    }

    return { puntos: puntosTotales, detecciones, banderasQueSumaron };
}


async function ejecutarBanderasAsincronasCompartidas(banderas, archivo, contexto) {
    let puntosSerie = 0;
    let puntosPeli  = 0;
    const detecciones = {};
    const banderasQueSumaron = [];

    for (const bandera of banderas) {
        let resultado;
        try {
            resultado = await bandera(archivo, contexto);
        } catch (e) {
            continue;
        }
        if (!resultado) continue;

        const ps = (resultado.puntos && resultado.puntos.serie)    || 0;
        const pp = (resultado.puntos && resultado.puntos.pelicula) || 0;
        if (ps === 0 && pp === 0) continue;

        puntosSerie += ps;
        puntosPeli  += pp;

        banderasQueSumaron.push({
            nombre: bandera.name,
            puntosSerie: ps,
            puntosPelicula: pp,
            detecciones: resultado.detecciones || {}
        });

        const det = resultado.detecciones || {};
        for (const clave of Object.keys(det)) {
            const valorNuevo = det[clave];
            if (valorNuevo === null || valorNuevo === undefined) continue;
            if (detecciones[clave] === undefined || detecciones[clave] === null) {
                detecciones[clave] = valorNuevo;
            }
        }
    }

    return { puntosSerie, puntosPeli, detecciones, banderasQueSumaron };
}


// ============================================================================
// API PUBLICA
// ============================================================================
async function clasificarArchivo(archivo) {
    if (!archivo || !archivo.nombreOriginal) {
        return {
            serie:    { puntos: 0, detecciones: {}, banderasQueSumaron: [] },
            pelicula: { puntos: 0, detecciones: {}, banderasQueSumaron: [] },
            variado:  { puntos: 0, detecciones: {}, banderasQueSumaron: [] }
        };
    }

    const reporteSerieSync   = ejecutarBanderasSincronas(BANDERAS_SERIE_SINCRONAS,    archivo, 'serie');
    const reportePeliSync    = ejecutarBanderasSincronas(BANDERAS_PELICULA_SINCRONAS, archivo, 'pelicula');
    const reporteVariadoSync = ejecutarBanderasSincronas(BANDERAS_VARIADO_SINCRONAS,  archivo, 'variado');

    const contexto = {
        puntosSerieActual: reporteSerieSync.puntos
    };
    const reporteAsync = await ejecutarBanderasAsincronasCompartidas(
        BANDERAS_COMPARTIDAS_ASINCRONAS, archivo, contexto
    );

    // ========================================================================
    // BRETERO: EL RESPALDO DE CONTEXTO (Solo suma si las banderas de ruta no lo hicieron)
    // ========================================================================
    let puntosBreteroSerie = 0;
    let puntosBreteroPeli = 0;
    let deteccionesBretero = {};

    // Verificamos si las banderas de ruta ya dieron contexto
    const rutaYaSumoSerie = reporteSerieSync.banderasQueSumaron.some(b => b.nombre.includes('ruta_'));
    const rutaYaSumoPeli  = reportePeliSync.banderasQueSumaron.some(b => b.nombre.includes('ruta_'));

    // Si ninguna bandera de ruta dio contexto, entra Bretero
    if (!rutaYaSumoSerie && !rutaYaSumoPeli) {
        const reporteBretero = bretero(archivo);
        if (Object.keys(reporteBretero.puntos).length > 0) {
            deteccionesBretero = reporteBretero.detecciones;
            
            // Sumamos los puntos a la categoría que corresponda
            // Nota: programa y novela se suman a 'serie' internamente
            if (reporteBretero.puntos.serie)    puntosBreteroSerie += reporteBretero.puntos.serie;
            if (reporteBretero.puntos.pelicula) puntosBreteroPeli  += reporteBretero.puntos.pelicula;
            if (reporteBretero.puntos.programa) puntosBreteroSerie += reporteBretero.puntos.programa;
            if (reporteBretero.puntos.novela)   puntosBreteroSerie += reporteBretero.puntos.novela;
        }
    }
    // ========================================================================

    const puntosSerieFinal   = reporteSerieSync.puntos   + reporteAsync.puntosSerie + puntosBreteroSerie;
    const puntosPeliFinal    = reportePeliSync.puntos    + reporteAsync.puntosPeli  + puntosBreteroPeli;
    const puntosVariadoFinal = reporteVariadoSync.puntos;

    const detSerie = { ...reporteSerieSync.detecciones };
    for (const clave of Object.keys(reporteAsync.detecciones)) {
        const v = reporteAsync.detecciones[clave];
        if (v === null || v === undefined) continue;
        if (detSerie[clave] === undefined || detSerie[clave] === null) detSerie[clave] = v;
    }
    // Inyectamos las detecciones de Bretero para debug
    if (Object.keys(deteccionesBretero).length > 0) {
        detSerie.bretero = deteccionesBretero;
    }

    const detPeli = { ...reportePeliSync.detecciones };
    for (const clave of Object.keys(reporteAsync.detecciones)) {
        const v = reporteAsync.detecciones[clave];
        if (v === null || v === undefined) continue;
        if (detPeli[clave] === undefined || detPeli[clave] === null) detPeli[clave] = v;
    }
    if (Object.keys(deteccionesBretero).length > 0) {
        detPeli.bretero = deteccionesBretero;
    }

    const detVariado = { ...reporteVariadoSync.detecciones };

    // Añadimos Bretero al reporte de banderas (para que el probe lo muestre)
    const banderasSerieFinal = [...reporteSerieSync.banderasQueSumaron];
    if (puntosBreteroSerie > 0) {
        banderasSerieFinal.push({ nombre: 'bretero', puntos: puntosBreteroSerie, detecciones: deteccionesBretero });
    }

    const banderasPeliFinal = [...reportePeliSync.banderasQueSumaron];
    if (puntosBreteroPeli > 0) {
        banderasPeliFinal.push({ nombre: 'bretero', puntos: puntosBreteroPeli, detecciones: deteccionesBretero });
    }

    return {
        serie: {
            puntos: puntosSerieFinal,
            detecciones: detSerie,
            banderasQueSumaron: [
                ...banderasSerieFinal,
                ...reporteAsync.banderasQueSumaron
                    .filter(b => b.puntosSerie > 0)
                    .map(b => ({ nombre: b.nombre, puntos: b.puntosSerie, detecciones: b.detecciones }))
            ]
        },
        pelicula: {
            puntos: puntosPeliFinal,
            detecciones: detPeli,
            banderasQueSumaron: [
                ...banderasPeliFinal,
                ...reporteAsync.banderasQueSumaron
                    .filter(b => b.puntosPelicula > 0)
                    .map(b => ({ nombre: b.nombre, puntos: b.puntosPelicula, detecciones: b.detecciones }))
            ]
        },
        variado: {
            puntos: puntosVariadoFinal,
            detecciones: detVariado,
            banderasQueSumaron: reporteVariadoSync.banderasQueSumaron
        }
    };
}


module.exports = {
    clasificarArchivo,
    DURACION,
    PESOS_SERIE,
    PESOS_PELICULA,
    PESOS_VARIADO,
    UMBRAL_SALTAR_INVESTIGACION,

    quitarExtension,
    normalizarParaMatching,
    limpiarNombreSerie,
    nombreDesdeCarpetaPadre,
    obtenerCarpetasDeRuta,
    limpiarNombreSerieAvanzado,
    limpiarNombrePelicula,

    banderas: {
        serie: {
            sincronas:  BANDERAS_SERIE_SINCRONAS,
            asincronas: BANDERAS_COMPARTIDAS_ASINCRONAS
        },
        pelicula: {
            sincronas:  BANDERAS_PELICULA_SINCRONAS,
            asincronas: BANDERAS_COMPARTIDAS_ASINCRONAS
        },
        variado: {
            sincronas:  BANDERAS_VARIADO_SINCRONAS,
            asincronas: []
        }
    }
};