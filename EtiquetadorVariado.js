// EtiquetadorVariado.js
// v1.3.0 — Determina la etiqueta específica para los archivos esVARIADO.
// Es un sistema de expansión modular.

const path = require('path');
const fs = require('fs');
const Clasificador = require('./Clasificacion.js'); // Para reutilizar limpiadores si hace falta
// ---------------------------------------------------------------------------
// v1.3.0 — Mapa de apps reconocibles en el nombre de una grabación de pantalla
// ---------------------------------------------------------------------------
const APPS_GRABACION = [
    // Navegadores
    { clave: /chrome/i,              nombre: 'Chrome' },
    { clave: /firefox/i,             nombre: 'Firefox' },
    { clave: /edge/i,                nombre: 'Edge' },
    { clave: /brave/i,               nombre: 'Brave' },
    { clave: /opera/i,               nombre: 'Opera' },
    { clave: /safari/i,              nombre: 'Safari' },
    // Redes sociales
    { clave: /facebook/i,            nombre: 'Facebook' },
    { clave: /Lite/i,                nombre: 'Facebook' },
    { clave: /instagram|insta\b/i,   nombre: 'Instagram' },
    { clave: /tiktok/i,              nombre: 'TikTok' },
    { clave: /twitter|\bx\b/i,       nombre: 'X/Twitter' },
    { clave: /youtube/i,             nombre: 'YouTube' },
    { clave: /whatsapp/i,            nombre: 'WhatsApp' },
    { clave: /telegram/i,            nombre: 'Telegram' },
    { clave: /discord/i,             nombre: 'Discord' },
    { clave: /snapchat/i,            nombre: 'Snapchat' },
    { clave: /reddit/i,              nombre: 'Reddit' },
    { clave: /pinterest/i,           nombre: 'Pinterest' },
    { clave: /linkedin/i,            nombre: 'LinkedIn' },
    // Videollamadas
    { clave: /zoom/i,                nombre: 'Zoom' },
    { clave: /meet\b|google\s*meet/i,nombre: 'Google Meet' },
    { clave: /teams/i,               nombre: 'Microsoft Teams' },
    { clave: /skype/i,               nombre: 'Skype' },
    { clave: /webex/i,               nombre: 'Webex' },
    // Reproductores / apps Android comunes
    { clave: /\blite\b/i,            nombre: 'Lite' },
    { clave: /mx\s*player/i,         nombre: 'MX Player' },
    { clave: /vlc/i,                 nombre: 'VLC' },
    { clave: /playit/i,              nombre: 'PLAYit' },
    { clave: /netflix/i,             nombre: 'Netflix' },
    { clave: /spotify/i,             nombre: 'Spotify' },
    { clave: /twitch/i,              nombre: 'Twitch' },
    { clave: /prime\s*video|amazon\s*prime/i, nombre: 'Prime Video' },
    { clave: /disney\+?|disney\s*plus/i, nombre: 'Disney+' },
    { clave: /hbo|max\b/i,           nombre: 'HBO Max' },
    // Apps de juegos
    { clave: /minecraft/i,           nombre: 'Minecraft' },
    { clave: /roblox/i,              nombre: 'Roblox' },
    { clave: /fortnite/i,            nombre: 'Fortnite' },
    { clave: /free\s*fire/i,         nombre: 'Free Fire' },
    { clave: /pubg/i,                nombre: 'PUBG' },
    { clave: /genshin/i,             nombre: 'Genshin Impact' },
    // Sistema
    { clave: /camera|cámara/i,       nombre: 'Cámara' },
    { clave: /settings|ajustes/i,    nombre: 'Ajustes' },
    { clave: /gallery|galer[ií]a/i,  nombre: 'Galería' },
];




/**
 * Busca una app reconocible en el nombre del archivo.
 * Devuelve el nombre legible o null.
 */
function detectarApp(nombreOrig) {
    for (const { clave, nombre } of APPS_GRABACION) {
        if (clave.test(nombreOrig)) return nombre;
    }
    return null;
}



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
    // 2. Grabación de pantalla (Screen Record / Screen Capture)
    //    v1.3.0: acepta _ o - entre fecha y hora, y detecta la app.
    // ------------------------------------------------------------------------
    const esScreenRecording =
        // Android: Screen_Recording_20260630-062254_Chrome.mp4
        /Screen[_\-\s]?Record(?:ing)?[_\-\s]?\d{8}[_\-]\d{6}/i.test(nombreOrig) ||
        // Android: Screen_Recording_2026-06-30-06-22-54.mp4
        /Screen[_\-\s]?Record(?:ing)?[_\-\s]?\d{4}[_\-]\d{2}[_\-]\d{2}/i.test(nombreOrig) ||
        // iOS: Screen Recording 2026-06-30 at 06.22.54.mp4
        /Screen\s*Recording\s+\d{4}[_\-]\d{2}[_\-]\d{2}/i.test(nombreOrig) ||
        // Genérico: ScreenCapture_20260630_062254
        /Screen[_\-\s]?Capture[_\-\s]?\d{8}/i.test(nombreOrig) ||
        // OBS: 2026-06-30-06-22-54.mp4
        /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.(?:mp4|mkv|avi)$/i.test(nombreOrig) ||
        // Español: "Grabación de pantalla 2026..."
        /Grabaci[oó]n[_\-\s]?de[_\-\s]?pantalla/i.test(nombreOrig);

    if (esScreenRecording) {
        const app = detectarApp(nombreOrig);
        return app
            ? `Grabación de Pantalla (${app})`
            : 'Grabación de Pantalla';
    }

    // Ruta típica de Android para Screen Record: .../DCIM/ScreenRecorder/ ...
    if (/(ScreenRecorder|ScreenRecord|Grabaciones de pantalla|Screen recordings?)/i.test(ruta)) {
        const app = detectarApp(nombreOrig);
        return app
            ? `Grabación de Pantalla (${app})`
            : 'Grabación de Pantalla';
    }

    // ------------------------------------------------------------------------
    // 2.5. AMV / VideoClick de anime (NUEVO — v1.3.1)
    //      Duración 1–6 min + AMV en el nombre + indicios de VideoClick.
    //      Etiqueta: "AMV - Anime"
    // ------------------------------------------------------------------------
    if (duracion >= 60 && duracion <= 360) {
        const nombreBase = nombreOrig.replace(/\.[a-z0-9]{2,5}$/i, '');
        const matchAmv = nombreBase.match(/(?:^|[\s_\-\/\(\)\[\]\{\}「」『』【】])(AMV|amv|rap|Anime\s*Music\s*Video|Anime\s*MV|MAD|VideoClick)(?:$|[\s_\-\/\(\)\[\]\{\}「」『』【】])/i);
        if (matchAmv) {
            const tieneIndicioVideoClick =
                /\[[^\]]+\]|\([^\)]+\)/.test(nombreBase) ||
                /\s[-–—]\s/.test(nombreBase) ||
                /\[(?:Official|Video|Lyric|Audio|MV|AMV)[^\]]*\]/i.test(nombreOrig);
            if (tieneIndicioVideoClick) {
                return 'AMV - Anime';
            }
        }
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
    // 4. Grabación de App específica (sin ser screen recording)
    //    v1.3.0: si el nombre menciona una app clara, se etiqueta.
    //    Ej: "video_2026-10-25_05-18-43" en carpeta de Telegram → Telegram
    // ------------------------------------------------------------------------
    // Telegram Desktop: video_2026-10-25_05-18-43.mp4
    if (/^video[_\-\s]?\d{4}[_\-]\d{2}[_\-]\d{2}[_\-]\d{2}[_\-]\d{2}[_\-]\d{2}/i.test(nombreOrig) &&
        /telegram/i.test(ruta)) {
        return 'Grabación de Telegram';
    }

    // ------------------------------------------------------------------------
    // 5. Animados o Videos Cortos (Usa la DB de categoría 'variado')
    // ------------------------------------------------------------------------
    try {
        const DB_PATH = path.join(__dirname, 'BD', 'luna_db.json');
        if (fs.existsSync(DB_PATH)) {
            const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
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
    // 6. VideoClick (Duración 1-6 min y patrón de corchetes [470k], (720P_HD))
    // ------------------------------------------------------------------------
    if (duracion >= 60 && duracion <= 360) { // 1 min a 6 min
        if (/\[[^\]]+\]|\([^\)]+\)/.test(nombreOrig)) {
            if (!/\[\s*(1080p|2160p|720p|4k|bd|bluray)\s*\]/i.test(nombreOrig)) {
                return 'VideoClick';
            }
        }
        if (/\s[-–—]\s.*\[.*(?:Official|Video|Lyric|Audio).*\]/i.test(nombreOrig)) {
            return 'VideoClick';
        }
    }

    // ------------------------------------------------------------------------
    // 7. Variado (Fallback o desconocido)
    // ------------------------------------------------------------------------
    return 'Variado Desconocido';
}

module.exports = {
    determinarEtiquetaVariado,
    detectarApp,
    APPS_GRABACION,
};