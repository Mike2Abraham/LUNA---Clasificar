const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_PATH = path.join(os.tmpdir(), 'luna_debug_log.json');
const VERSION_LUNA = '1.0.0'; // Ajusta si cambia

function guardarLogDebug(datosEntrada, resultadoFinal, tiempoMs) {
    try {
        // 1. Estructura del log
        const nuevoRegistro = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            fecha: new Date().toISOString(),
            versionLUNA: VERSION_LUNA,
            tiempoMs: tiempoMs,
            entrada: datosEntrada,
            salida: resultadoFinal ? resultadoFinal.salida : null,
            errores: resultadoFinal ? resultadoFinal.errores : ['Error crítico en LUNA'],
            meta: resultadoFinal ? resultadoFinal.meta : null
        };

        // 2. Leer el archivo actual (si no existe, empezamos con un array vacío)
        let historial = [];
        if (fs.existsSync(LOG_PATH)) {
            try {
                const contenido = fs.readFileSync(LOG_PATH, 'utf8');
                historial = JSON.parse(contenido);
                if (!Array.isArray(historial)) historial = []; // Seguridad
            } catch (e) {
                historial = []; // Si el JSON está corrupto, lo reseteamos
            }
        }

        // 3. Agregar el nuevo registro
        historial.push(nuevoRegistro);

        // 4. Limitar a los últimos 500 registros para que no se haga gigante
        if (historial.length > 500) {
            historial = historial.slice(-500);
        }

        // 5. Guardar de vuelta al archivo
        fs.writeFileSync(LOG_PATH, JSON.stringify(historial, null, 2), 'utf8');
        
        // Opcional: Imprimir en consola la ruta para que sepas dónde buscarlo
        // console.log(`[LUNA DEBUG] Log guardado en: ${LOG_PATH}`);

    } catch (error) {
        // Si falla, imprimimos en consola pero NO lanzamos el error hacia arriba
        console.error('[LUNA DEBUG] No se pudo escribir el log:', error.message);
    }
}

module.exports = { guardarLogDebug, LOG_PATH };