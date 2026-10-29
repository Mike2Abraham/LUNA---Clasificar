// ============================================================================
// probe_LUNA_2.js
// Probe de observacion RONDA 2.
// - Soporta RUTAS_PRUEBA como array (bien manejado, sin ReferenceError)
// - Corre LUNA() con cada ruta (string simple)
// - Prueba las 5 variantes de entrada con la primera ruta
// - Prueba entradas invalidas (null, {}, 123, [])
// - Imprime resumen tabular al final
// NO decide, NO arregla, NO toca LUNA ni Clasificacion.
// ============================================================================

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURACION DE PRUEBA
// ============================================================================

// Rutas reales. Corregidas las barras invertidas de la linea 3.
const RUTAS_PRUEBA = [
    'D:\\ANIME\\Thunder 3 [Temp 1] [2026] [Caps 12]\\Exatlon Mexico [T10] - [TX] [037].mp4',
    'D:\\ANIME\\Thunder 3 [Temp 1] [2026] [Caps 12]\\Exatlon Mexico [T10] - [TX] [037].mp4',
    'D:\\ANIME\\Ciudad Lejana 137.mp4',
    'D:\\ANIME\\Ciudad Lejana 139.mp4',
    'D:\\ANIME\\Ciudad Lejana 138.mp4',
    'D:\\ANIME\\Novela\\Ciudad Lejana 138.mp4',
    'D:\\ANIME\\Novela\\Ciudad Lejana 139.mp4',
    'D:\\ANIME\\Novela\\Ciudad Lejana 137.mp4',
];

// ============================================================================
// HELPERS DE IMPRESION
// ============================================================================

function linea(char = '=', n = 78) {
    return char.repeat(n);
}

function titulo(texto) {
    console.log('\n' + linea('='));
    console.log('  ' + texto);
    console.log(linea('='));
}

function sub(texto) {
    console.log('\n' + linea('-'));
    console.log('  ' + texto);
    console.log(linea('-'));
}

function safeStringify(obj) {
    try {
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return '[no serializable: ' + e.message + ']';
    }
}

function padRight(s, n) {
    s = String(s == null ? '' : s);
    if (s.length >= n) return s.substring(0, n);
    return s + ' '.repeat(n - s.length);
}

// ============================================================================
// IMPRIMIR REPORTE DE BANDERAS
// ============================================================================

function imprimirReporteBanderas(nombreArchivo, reporte) {
    if (!reporte) {
        console.log('    (sin reporte de banderas)');
        return;
    }

    const categorias = ['serie', 'pelicula', 'variado'];
    for (const cat of categorias) {
        const r = reporte[cat];
        if (!r) continue;

        console.log(`    [${cat.toUpperCase()}]  puntos = ${r.puntos}`);

        if (Array.isArray(r.banderasQueSumaron) && r.banderasQueSumaron.length > 0) {
            console.log('      banderas que sumaron:');
            for (const b of r.banderasQueSumaron) {
                console.log(`        - ${b.nombre}  (+${b.puntos})`);
            }
        } else {
            console.log('      banderas que sumaron: (ninguna)');
        }

        if (r.detecciones && Object.keys(r.detecciones).length > 0) {
            console.log('      detecciones:');
            const det = safeStringify(r.detecciones);
            det.split('\n').forEach(l => console.log('        ' + l));
        }
    }
}

// ============================================================================
// HELPER: correr pipeline a mano para inspeccionar el paquete interno
// (replica crearPaqueteVacio, que no esta exportado)
// ============================================================================

function crearPaqueteVacioLocal() {
    return {
        entradaOriginal: null,
        tipoEntrada: null,
        rutas: [],
        opciones: { sin_metadato: false, metadatos: [], formatoSalida: 'json' },
        archivos: [],
        puntajes: { pelicula: 0, serie: 0, variado: 0 },
        banderas: {},
        resultados: [],
        salida: null,
        errores: [],
        meta: { inicio: Date.now(), fin: 0, duracionMs: 0 }
    };
}

async function inspeccionarPaqueteInterno(LUNA, ruta, etiqueta) {
    console.log(`\n    >>> Inspeccion interna: ${etiqueta}`);
    try {
        const paquete = crearPaqueteVacioLocal();
        LUNA.normalizarEntrada(paquete, ruta);
        await LUNA.extraerDatos(paquete);
        await LUNA.clasificarPorBanderas(paquete);
        LUNA.tomarDecision(paquete);
        LUNA.transformarSalida(paquete);

        for (const a of paquete.archivos) {
            console.log('        archivo:', a.nombreOriginal);
            console.log('        duracion:', a.duracion);
            console.log('        nombreLimpio (extraerDatos):', JSON.stringify(a.nombreLimpio));
            console.log('        info.nombreLimpio:', JSON.stringify(a.info && a.info.nombreLimpio));
            console.log('        info.serie:', JSON.stringify(a.info && a.info.serie));
        }

        const reportes = Array.isArray(paquete.banderas) ? paquete.banderas : [];
        for (const item of reportes) {
            imprimirReporteBanderas(item.ruta, item.reporte);
        }

        console.log('        decision final:', paquete.resultados.map(r => r.esCC).join(', '));
        console.log('        errores paquete:', paquete.errores.length);

    } catch (e) {
        console.error('        !! fallo la inspeccion interna:', e && e.stack ? e.stack : e);
    }
}

// ============================================================================
// PROBE PRINCIPAL
// ============================================================================

async function ejecutarProbeLUNA2() {
    titulo('PROBE LUNA — RONDA 2 — INICIO');
    console.log('Node version:', process.version);
    console.log('Plataforma:', process.platform);
    console.log('CWD:', process.cwd());
    console.log('Rutas configuradas:', RUTAS_PRUEBA.length);
    RUTAS_PRUEBA.forEach((r, i) => console.log(`  [${i + 1}] ${r}`));

    // ---- 1. Cargar modulos ----
    sub('PASO 1: cargando modulos');
    let LUNA, Clasificacion;
    try {
        Clasificacion = require('../Clasificacion.js');
        console.log('  Clasificacion.js OK');
    } catch (e) {
        console.error('  !! FALLO Clasificacion.js');
        console.error(e && e.stack ? e.stack : e);
        return;
    }
    try {
        LUNA = require('../LUNA_clasificador.js');
        console.log('  LUNA_clasificador.js OK');
    } catch (e) {
        console.error('  !! FALLO LUNA_clasificador.js');
        console.error(e && e.stack ? e.stack : e);
        return;
    }

    const res = LUNA.infoDBMetadata();
    console.log('respuesta:', res)
    // ---- 2. Verificar existencia de cada ruta ----
    sub('PASO 2: verificando existencia de rutas');
    const rutasValidas = [];
    const rutasInvalidas = [];
    for (const r of RUTAS_PRUEBA) {
        try {
            const st = fs.statSync(r);
            console.log(`  OK   [${st.isFile() ? 'file' : 'dir'}] ${r}`);
            if (st.isFile()) rutasValidas.push(r);
            else rutasInvalidas.push({ ruta: r, motivo: 'no es archivo' });
        } catch (e) {
            console.log(`  FAIL ${r}`);
            console.log(`       motivo: ${e.code || e.message}`);
            rutasInvalidas.push({ ruta: r, motivo: e.code || e.message });
        }
    }
    console.log(`\n  Validas: ${rutasValidas.length} / ${RUTAS_PRUEBA.length}`);
    if (rutasInvalidas.length > 0) {
        console.log('  Invalidas:');
        rutasInvalidas.forEach(x => console.log(`    - ${x.ruta}  (${x.motivo})`));
    }

    if (rutasValidas.length === 0) {
        console.error('\n  !! No hay rutas validas. Abortando ronda 2.');
        return;
    }

    // ---- 3. Correr LUNA() string simple, una por una ----
    sub('PASO 3: LUNA() string simple — una por una');

    const resumen = []; // para tabla final

    for (let i = 0; i < rutasValidas.length; i++) {
        const ruta = rutasValidas[i];
        console.log(`\n  [${i + 1}/${rutasValidas.length}] ${ruta}`);

        const t0 = Date.now();
        let resultado = null;
        let excepcion = null;

        try {
            resultado = await LUNA.LUNA(ruta);
        } catch (e) {
            excepcion = e;
        }

        const ms = Date.now() - t0;
        console.log(`     tiempo: ${ms}ms`);

        if (excepcion) {
            console.error('     !! EXCEPCION:', excepcion && excepcion.stack ? excepcion.stack : excepcion);
            resumen.push({
                archivo: path.basename(ruta),
                esCC: 'EXC',
                peli: '-', serie: '-', vari: '-', dur: '-',
                exito: false
            });
            continue;
        }

        // Reporte de puntajes por archivo desde el paquete interno
        // No lo tenemos en resultado, asi que solo imprimimos salida y errores
        //console.log('     exito:', resultado && resultado.exito);
        //console.log('     salida.esCC:', resultado && resultado.salida && resultado.salida.esCC);
        //console.log('     salida.duracion:', resultado && resultado.salida && resultado.salida.duracion);
        //console.log('     salida.nombreLimpio:', JSON.stringify(resultado && resultado.salida && resultado.salida.nombreLimpio));
        //if (resultado && resultado.salida && resultado.salida.info) {
        //    console.log('     salida.info.serie:', JSON.stringify(resultado.salida.info.serie));
        //    console.log('     salida.info.temporada:', resultado.salida.info.temporada);
        //    console.log('     salida.info.capituloNumero:', resultado.salida.info.capituloNumero);
        //}
        //if (resultado && Array.isArray(resultado.errores) && resultado.errores.length > 0) {
        //    console.log('     errores:');
        //    resultado.errores.forEach(e => console.log(`       - [${e.etapa}] ${e.mensaje}`));
        //}

        resumen.push({
            archivo: path.basename(ruta),
            esCC: resultado && resultado.salida && resultado.salida.esCC || null,
            peli: '?', serie: '?', vari: '?', // se rellena abajo
            dur: resultado && resultado.salida && resultado.salida.duracion,
            exito: !!(resultado && resultado.exito)
        });

        // Inspeccion interna SOLO del primer archivo para no saturar
        if (i === 0) {
            await inspeccionarPaqueteInterno(LUNA, ruta, 'archivo #1');
        }
    }

    // ---- 4. Variantes de entrada con la primera ruta valida ----
    //sub('PASO 4: variantes de entrada (con primera ruta valida)');
    //const ruta0 = rutasValidas[0];
    //const ruta1 = rutasValidas[1] || ruta0;
//
    //const variantes = [
    //    { nombre: 'string',             entrada: ruta0 },
    //    { nombre: 'config sin_metadato',entrada: { ruta: ruta0, sin_metadato: true } },
    //    { nombre: 'config metadatos',   entrada: { ruta: ruta0, metadatos: [{ clave: 'test', valor: 'camara' }] } },
    //    { nombre: 'array de strings',   entrada: [ruta0, ruta1] },
    //    { nombre: 'array de configs',   entrada: [{ ruta: ruta0 }, { ruta: ruta1 }] }
    //];
//
    //for (const v of variantes) {
    //    console.log(`\n  --- variante: ${v.nombre}`);
    //    const t0 = Date.now();
    //    try {
    //        const res = await LUNA.LUNA(v.entrada);
    //        const ms = Date.now() - t0;
    //        console.log(`      tiempo: ${ms}ms | exito: ${res && res.exito}`);
    //        console.log(`      salida:`, safeStringify(res && res.salida));
    //        if (res && Array.isArray(res.errores) && res.errores.length > 0) {
    //            console.log(`      errores:`, safeStringify(res.errores));
    //        }
    //    } catch (e) {
    //        console.error(`      !! EXCEPCION:`, e && e.stack ? e.stack : e);
    //    }
    //}

    // ---- 5. Entradas invalidas ----
    //sub('PASO 5: entradas invalidas (debe NO explotar)');
    //const invalidas = [
    //    { nombre: 'null',           entrada: null },
    //    { nombre: 'undefined',      entrada: undefined },
    //    { nombre: 'objeto vacio',   entrada: {} },
    //    { nombre: 'numero',         entrada: 123 },
    //    { nombre: 'array vacio',    entrada: [] },
    //    { nombre: 'array mixto',    entrada: [123, null, 'texto'] },
    //    { nombre: 'boolean',        entrada: true }
    //];

    //for (const v of invalidas) {
    //    console.log(`\n  --- invalida: ${v.nombre}`);
    //    try {
    //        const res = await LUNA.LUNA(v.entrada);
    //        console.log(`      retorno:`, safeStringify(res));
    //    } catch (e) {
    //        console.error(`      !! LANZO EXCEPCION (no deberia):`, e && e.message);
    //    }
    //}

    // ---- 6. Resumen tabular ----
    titulo('RESUMEN TABULAR RONDA 2');
    console.log(
        padRight('ARCHIVO', 55) + ' | ' +
        padRight('esCC', 8) + ' | ' +
        padRight('duracion', 10) + ' | ' +
        'exito'
    );
    console.log(linea('-', 90));
    for (const r of resumen) {
        console.log(
            padRight(r.archivo, 55) + ' | ' +
            padRight(r.esCC, 8) + ' | ' +
            padRight(r.dur, 10) + ' | ' +
            String(r.exito)
        );
    }

    titulo('PROBE LUNA — RONDA 2 — FIN');
}


setTimeout(() => {
    ejecutarProbeLUNA2();
}, 3000);
module.exports = { ejecutarProbeLUNA2 };