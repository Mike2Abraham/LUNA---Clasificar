// EtiquetadorVariado.js
// v1.3.0 — Determina la etiqueta específica para los archivos esVARIADO.
// Es un sistema de expansión modular.

const path = require('path');
const fs = require('fs');
const Clasificador = require('./Clasificacion.js'); // Para reutilizar limpiadores si hace falta

/**
 * Determina la Etiqueta_V para un archivo variado.
 * @param {Object} archivo - El objeto archivo del pipeline (con ruta, nombreOriginal, duracion, etc.)
 * @param {Object} info - El objeto info actual (con nombreLimpio, etc.)
 * @returns {string} - La etiqueta determinada.
 */
function determinarEtiquetaVariado(archivo, info) {
    const nombreOrig = archivo.nombreOriginal || '';
    const ruta = archivo.ruta || '';
    const duracion = archivo.duracion || 0;

    // ------------------------------------------------------------------------
    // 1. Grabación de WhatsApp (se detecta por nombre y por ruta típica)
    // ------------------------------------------------------------------------
    // Patrones: PTT-20240719-WA0002.opus, VID-20231012-WA0001.mp4, AUD-...
    if (/\b(?:PTT|VID|AUD|IMG)-\d{8}-WA\d{4}\b/i.test(nombreOrig)) {
        return 'Grabación de WhatsApp';
    }
    // Ruta típica de WhatsApp en Android: .../WhatsApp/Media/WhatsApp Audio/ ...
    if (/WhatsApp[\\\/]Media/i.test(ruta)) {
        return 'Grabación de WhatsApp';
    }

    // ------------------------------------------------------------------------
    // 2. Grabación de pantalla (Screen Record)
    // ------------------------------------------------------------------------
    // Patrones: ScreenRecord_20261101_143022.mp4, ScreenCapture_..., OBS (2026-11-01-14-30-22)
    if (/Screen(Record|Capture)_\d{8}_\d{6}/i.test(nombreOrig)) {
        return 'Grabación de Pantalla';
    }

    if (/(?:Screen Recording|Grabaci[oó]n de pantalla)\s+\d{8}\s+\d{6}/i.test(nombreOrig)) {
        return 'Grabación de Pantalla';
    }

    if (/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.(mp4|mkv|avi)$/i.test(nombreOrig)) {
        return 'Grabación de Pantalla'; // Formato OBS
    }
    // Ruta típica de Android para Screen Record: .../DCIM/ScreenRecorder/ ...
    if (/(ScreenRecorder|ScreenRecord|Grabaciones de pantalla)/i.test(ruta)) {
        return 'Grabación de Pantalla';
    }

    // ------------------------------------------------------------------------
    // 3. Grabación de Cámara / DCIM (Teléfono o Cámara profesional)
    // ------------------------------------------------------------------------
    // Patrones: VID_20250115_143022.mp4, IMG_4821.MP4, _MG_4821.MOV
    if (/\b(?:VID|IMG|_MG|DSC)_\d{4,8}/i.test(nombreOrig)) {
        return 'Grabación de Cámara / DCIM';
    }
    // Ruta típica: .../DCIM/Camera/... o .../DCIM/100APPLE/...
    if (/DCIM/i.test(ruta)) {
        return 'Grabación de Cámara / DCIM';
    }

    // ------------------------------------------------------------------------
    // 4. Animados o Videos Cortos (Usa la DB de categoría 'variado')
    // ------------------------------------------------------------------------
    try {
        // Para no ensuciar este archivo, importamos la DB de LUNA (simulada aquí, o pasada como parámetro)
        // La mejor forma es que LUNA le pase la DB ya cargada, pero para mantenerlo desacoplado,
        // haremos que la función reciba la DB o la cargue.
        // (Esto lo ajustaremos en LUNA_clasificador.js)
        const DB_PATH = path.join(__dirname, 'BD', 'luna_db.json');
        if (fs.existsSync(DB_PATH)) {
            const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            // Usamos la misma lógica de normalización que usa LUNA para la DB
            const normalizarClaveDB = (nombre) => {
                if (!nombre) return '';
                return String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\(\)\[\]\{\}]+/g, ' ').replace(/[_\.\-=\+]+/g, ' ').replace(/\s+/g, ' ').trim();
            };
            const clave = normalizarClaveDB(info.nombreLimpio || '');
            const bucket = db.categorias && db.categorias['variado'] && db.categorias['variado'].nombres;
            if (bucket) {
                for (const key of Object.keys(bucket)) {
                    if (normalizarClaveDB(key) === clave) {
                        return 'Animado / Video Corto';
                    }
                }
            }
        }
    } catch (e) {
        // Si falla la DB, no rompemos, seguimos
    }

    // ------------------------------------------------------------------------
    // 5. VideoClick (Duración 1-6 min y patrón de corchetes [470k], (720P_HD))
    // ------------------------------------------------------------------------
    if (duracion >= 60 && duracion <= 360) { // 1 min a 6 min
        // Busca corchetes con contenido que parezca métrica o calidad
        if (/\[[^\]]+\]|\([^\)]+\)/.test(nombreOrig)) {
            // Nos aseguramos de que no sea un tag técnico típico de peli (1080p, etc.)
            if (!/\[\s*(1080p|2160p|720p|4k|bd|bluray)\s*\]/i.test(nombreOrig)) {
                return 'VideoClick';
            }
        }
        // Patrón de música: "Artista - Título [Official Video]"
        if (/\s[-–—]\s.*\[.*(?:Official|Video|Lyric|Audio).*\]/i.test(nombreOrig)) {
            return 'VideoClick';
        }
    }

    // ------------------------------------------------------------------------
    // 6. Variado (Fallback o desconocido)
    // ------------------------------------------------------------------------
    return 'Variado Desconocido';
}

module.exports = {
    determinarEtiquetaVariado
};