const path = require('path');
const fs = require("fs");
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const { getFFmpegPath,
    getFFprobePath,
    getFFplayPath,
    setBinariosFromFolder,
    resetBinarios
} = require('./ResolverPathffmpeg.js');



// Cache para evitar llamadas repetidas al mismo archivo
const duracionCache = new Map();
const MAX_CACHE_SIZE = 1000;

// Función individual para obtener duración de UN video usando FFMPEG
async function obtenerDuracionIndividual(rutaArchivo) {
    try {
        const ffmpeg = getFFmpegPath();
        const cmd = `"${ffmpeg}" -i "${rutaArchivo}"`;

        const { stdout, stderr } = await execAsync(cmd);
        const output = `${stdout}\n${stderr}`;

        const durationMatch = output.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
        if (durationMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseInt(durationMatch[3]);
            const ms = parseInt(durationMatch[4]) / 100;
            const duracionSegundos = hours * 3600 + minutes * 60 + seconds + ms;
            return { segundos: duracionSegundos, success: true, ruta: rutaArchivo };
        }

        return { segundos: 0, success: false, error: 'No se encontró duración en el output', ruta: rutaArchivo };

    } catch (error) {
        const fallback = `${error.stdout || ''}\n${error.stderr || ''}`;
        const durationMatch = fallback.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
        if (durationMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseInt(durationMatch[3]);
            const ms = parseInt(durationMatch[4]) / 100;
            const duracionSegundos = hours * 3600 + minutes * 60 + seconds + ms;
            return { segundos: duracionSegundos, success: true, ruta: rutaArchivo };
        }

        return { segundos: 0, success: false, error: error.message, ruta: rutaArchivo };
    }
}

// IPC para múltiples videos - PROCESAMIENTO PARALELO
async function procesarDuracionMediainfo(rutasArchivos) {
    try {
        // Si es un solo archivo (backward compatibility)
        if (typeof rutasArchivos === 'string') {
            return await obtenerDuracionIndividual(rutasArchivos);
        }

        // Si es array de archivos - PROCESAMIENTO MASIVO
        if (Array.isArray(rutasArchivos)) {
            //console.log(`🎯 Obteniendo duración de ${rutasArchivos.length} videos con FFMPEG...`);

            // Limitar concurrencia para no saturar el sistema
            const CONCURRENCY_LIMIT = 5;
            const resultados = [];

            // Procesar en chunks para no abrir demasiados procesos a la vez
            for (let i = 0; i < rutasArchivos.length; i += CONCURRENCY_LIMIT) {
                const chunk = rutasArchivos.slice(i, i + CONCURRENCY_LIMIT);

                // Ejecutar en paralelo
                const promises = chunk.map(ruta => obtenerDuracionIndividual(ruta));
                const chunkResultados = await Promise.allSettled(promises);

                // Procesar resultados del chunk
                chunkResultados.forEach((resultado, index) => {
                    if (resultado.status === 'fulfilled') {
                        resultados.push(resultado.value);
                    } else {
                        resultados.push({
                            segundos: 0,
                            success: false,
                            error: resultado.reason.message,
                            ruta: chunk[index]
                        });
                    }
                });

                // Pequeña pausa entre chunks para no saturar
                if (i + CONCURRENCY_LIMIT < rutasArchivos.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            const exitosos = resultados.filter(r => r.success).length;
            //console.log(` Obtenidas ${exitosos}/${rutasArchivos.length} duraciones`);
            return resultados;
        }

        throw new Error('Parámetro debe ser string o array');

    } catch (error) {
        return { segundos: 0, success: false, error: `Error general: ${error.message}` };
    }
}

setTimeout(async() => {
   const g = await procesarDuracionMediainfo('D:\\ANIME\\Code Geass 2\\[D-SnF] Code Geass - Lelouch of the Rebellion R2 - 03 [BD 1080p].mkv');
   console.log(g) 
}, 200);

module.exports = {
    procesarDuracionMediainfo,
    obtenerDuracionIndividual,
    getFFmpegPath,
    getFFprobePath,
    getFFplayPath,
    setBinariosFromFolder
}