const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath = null;
let ffprobePath = null;
let ffplayPath = null;

function getBaseDir() {
    const dir = process.cwd();
    console.log('[getBaseDir] Directorio base:', dir);
    return dir;
}

function buscarBinarioEnCarpeta(carpetaBase, nombreBinario) {
    console.log(`[buscarBinarioEnCarpeta] Buscando "${nombreBinario}" en: ${carpetaBase}`);
    
    if (!carpetaBase || typeof carpetaBase !== 'string') {
        console.warn('[buscarBinarioEnCarpeta] carpetaBase inválida:', carpetaBase);
        return null;
    }
    
    if (!fs.existsSync(carpetaBase)) {
        console.warn(`[buscarBinarioEnCarpeta] La carpeta no existe: ${carpetaBase}`);
        return null;
    }
    
    const extension = process.platform === 'win32' ? '.exe' : '';
    const nombreConExe = nombreBinario + extension;
    console.log(`[buscarBinarioEnCarpeta] Plataforma: ${process.platform}, nombre con extensión: ${nombreConExe}`);
    
    const posiblesRutas = [
        path.join(carpetaBase, nombreConExe),
        path.join(carpetaBase, 'bin', nombreConExe),
        path.join(carpetaBase, 'ffmpeg-static', nombreConExe),
        path.join(carpetaBase, 'ffmpeg', nombreConExe),
        path.join(carpetaBase, 'bin', 'ffmpeg', nombreConExe)
    ];
    
    for (const ruta of posiblesRutas) {
        const existe = fs.existsSync(ruta);
        console.log(`[buscarBinarioEnCarpeta]   ${existe ? '✓' : '✗'} ${ruta}`);
        if (existe) {
            console.log(`[buscarBinarioEnCarpeta] Encontrado: ${ruta}`);
            return ruta;
        }
    }
    
    console.warn(`[buscarBinarioEnCarpeta] No se encontró "${nombreBinario}" en ninguna ruta de ${carpetaBase}`);
    return null;
}

function setBinariosFromFolder(carpetaBase) {
    console.log(`[setBinariosFromFolder] Configurando binarios desde: ${carpetaBase}`);
    
    if (!carpetaBase || typeof carpetaBase !== 'string') {
        console.warn('[setBinariosFromFolder] carpetaBase inválida');
        return false;
    }
    
    if (!fs.existsSync(carpetaBase)) {
        console.warn(`[setBinariosFromFolder] La carpeta no existe: ${carpetaBase}`);
        return false;
    }
    
    const mpegPath = buscarBinarioEnCarpeta(carpetaBase, 'ffmpeg');
    const probePath = buscarBinarioEnCarpeta(carpetaBase, 'ffprobe');
    const playPath = buscarBinarioEnCarpeta(carpetaBase, 'ffplay');
    
    if (mpegPath) {
        ffmpegPath = mpegPath;
        console.log(`[setBinariosFromFolder] ffmpeg asignado: ${ffmpegPath}`);
    } else {
        console.warn('[setBinariosFromFolder] ffmpeg NO encontrado');
    }
    
    if (probePath) {
        ffprobePath = probePath;
        console.log(`[setBinariosFromFolder] ffprobe asignado: ${ffprobePath}`);
    } else {
        console.warn('[setBinariosFromFolder] ffprobe NO encontrado');
    }
    
    if (playPath) {
        ffplayPath = playPath;
        console.log(`[setBinariosFromFolder] ffplay asignado: ${ffplayPath}`);
    } else {
        console.warn('[setBinariosFromFolder] ffplay NO encontrado');
    }
    
    const resultado = mpegPath !== null;
    console.log(`[setBinariosFromFolder] Resultado (ffmpeg encontrado): ${resultado}`);
    return resultado;
}

function detectSystemFFmpeg() {
    console.log('[detectSystemFFmpeg] Buscando ffmpeg en el sistema...');
    try {
        if (process.platform === 'win32') {
            const whereOutput = execSync('where ffmpeg', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            if (whereOutput) {
                const paths = whereOutput.trim().split('\r\n');
                console.log(`[detectSystemFFmpeg] Encontrado en sistema (win32): ${paths[0]}`);
                return paths[0];
            }
        } else {
            const whichOutput = execSync('which ffmpeg', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            if (whichOutput) {
                console.log(`[detectSystemFFmpeg] Encontrado en sistema (unix): ${whichOutput.trim()}`);
                return whichOutput.trim();
            }
        }
    } catch (e) {
        console.warn('[detectSystemFFmpeg] No se encontró ffmpeg en el sistema:', e.message);
    }
    return null;
}

function detectSystemFFprobe() {
    console.log('[detectSystemFFprobe] Buscando ffprobe en el sistema...');
    try {
        if (process.platform === 'win32') {
            const whereOutput = execSync('where ffprobe', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            if (whereOutput) {
                const paths = whereOutput.trim().split('\r\n');
                console.log(`[detectSystemFFprobe] Encontrado en sistema (win32): ${paths[0]}`);
                return paths[0];
            }
        } else {
            const whichOutput = execSync('which ffprobe', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            if (whichOutput) {
                console.log(`[detectSystemFFprobe] Encontrado en sistema (unix): ${whichOutput.trim()}`);
                return whichOutput.trim();
            }
        }
    } catch (e) {
        console.warn('[detectSystemFFprobe] No se encontró ffprobe en el sistema:', e.message);
    }
    return null;
}

function detectNodeModulesFFmpeg() {
    console.log('[detectNodeModulesFFmpeg] Buscando ffmpeg en node_modules...');
    try {
        const baseDir = getBaseDir();
        const possiblePaths = [
            path.join(baseDir, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
            path.join(baseDir, 'node_modules', 'ffmpeg-static', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
            path.join(baseDir, 'node_modules', '@ffmpeg-installer', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
            path.join(baseDir, 'node_modules', 'ffmpeg-binaries', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
        ];
        
        for (const testPath of possiblePaths) {
            const existe = fs.existsSync(testPath);
            console.log(`[detectNodeModulesFFmpeg]   ${existe ? '✓' : '✗'} ${testPath}`);
            if (existe) {
                console.log(`[detectNodeModulesFFmpeg] Encontrado: ${testPath}`);
                return testPath;
            }
        }
    } catch (e) {
        console.error('[detectNodeModulesFFmpeg] Error:', e);
    }
    console.warn('[detectNodeModulesFFmpeg] ffmpeg NO encontrado en node_modules');
    return null;
}

function detectNodeModulesFFprobe() {
    console.log('[detectNodeModulesFFprobe] Buscando ffprobe en node_modules...');
    try {
        const baseDir = getBaseDir();
        const possiblePaths = [
            path.join(baseDir, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
            path.join(baseDir, 'node_modules', 'ffmpeg-static', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
        ];
        
        for (const testPath of possiblePaths) {
            const existe = fs.existsSync(testPath);
            console.log(`[detectNodeModulesFFprobe]   ${existe ? '✓' : '✗'} ${testPath}`);
            if (existe) {
                console.log(`[detectNodeModulesFFprobe] Encontrado: ${testPath}`);
                return testPath;
            }
        }
    } catch (e) {
        console.error('[detectNodeModulesFFprobe] Error:', e);
    }
    console.warn('[detectNodeModulesFFprobe] ffprobe NO encontrado en node_modules');
    return null;
}

function getFixedFFmpegPath() {
    const baseDir = getBaseDir();
    const fixedPath = path.join(baseDir, 'ffmpeg-static', 'ffmpeg.exe');
    const existe = fs.existsSync(fixedPath);
    console.log(`[getFixedFFmpegPath] ${existe ? '✓' : '✗'} ${fixedPath}`);
    if (existe) {
        return fixedPath;
    }
    return null;
}

function getFixedFFprobePath() {
    const baseDir = getBaseDir();
    const fixedPath = path.join(baseDir, 'ffmpeg-static', 'ffprobe.exe');
    const existe = fs.existsSync(fixedPath);
    console.log(`[getFixedFFprobePath] ${existe ? '✓' : '✗'} ${fixedPath}`);
    if (existe) {
        return fixedPath;
    }
    return null;
}

function getFixedFFplayPath() {
    const baseDir = getBaseDir();
    const fixedPath = path.join(baseDir, 'ffmpeg-static', 'ffplay.exe');
    const existe = fs.existsSync(fixedPath);
    console.log(`[getFixedFFplayPath] ${existe ? '✓' : '✗'} ${fixedPath}`);
    if (existe) {
        return fixedPath;
    }
    return null;
}

function getFFmpegPath(userFolderPath = null) {
    console.log('========================================');
    console.log('[getFFmpegPath] Iniciando búsqueda de ffmpeg...');
    console.log('[getFFmpegPath] ffmpegPath en caché:', ffmpegPath);
    console.log('[getFFmpegPath] userFolderPath:', userFolderPath);
    
    if (ffmpegPath && !userFolderPath) {
        console.log(`[getFFmpegPath] Usando caché: ${ffmpegPath}`);
        return ffmpegPath;
    }
    
    if (userFolderPath && typeof userFolderPath === 'string') {
        console.log('[getFFmpegPath] Intentando setBinariosFromFolder...');
        if (setBinariosFromFolder(userFolderPath)) {
            console.log(`[getFFmpegPath] Encontrado en carpeta de usuario: ${ffmpegPath}`);
            return ffmpegPath;
        }
        console.warn('[getFFmpegPath] No se encontró en carpeta de usuario, continuando...');
    }
    
    const systemPath = detectSystemFFmpeg();
    if (systemPath) {
        ffmpegPath = systemPath;
        console.log(`[getFFmpegPath] Usando ffmpeg del sistema: ${ffmpegPath}`);
        return ffmpegPath;
    }
    
    const nodeModulesPath = detectNodeModulesFFmpeg();
    if (nodeModulesPath) {
        ffmpegPath = nodeModulesPath;
        console.log(`[getFFmpegPath] Usando ffmpeg de node_modules: ${ffmpegPath}`);
        return ffmpegPath;
    }
    
    const fixedPath = getFixedFFmpegPath();
    if (fixedPath) {
        ffmpegPath = fixedPath;
        console.log(`[getFFmpegPath] Usando ffmpeg de ruta fija: ${ffmpegPath}`);
        return ffmpegPath;
    }
    
    console.error('[getFFmpegPath] ¡FFmpeg NO encontrado en ninguna ubicación!');
    throw new Error('FFmpeg no encontrado');
}

function getFFprobePath(userFolderPath = null) {
    console.log('========================================');
    console.log('[getFFprobePath] Iniciando búsqueda de ffprobe...');
    console.log('[getFFprobePath] ffprobePath en caché:', ffprobePath);
    console.log('[getFFprobePath] userFolderPath:', userFolderPath);
    
    if (ffprobePath && !userFolderPath) {
        console.log(`[getFFprobePath] Usando caché: ${ffprobePath}`);
        return ffprobePath;
    }
    
    if (userFolderPath && typeof userFolderPath === 'string') {
        console.log('[getFFprobePath] Intentando setBinariosFromFolder...');
        setBinariosFromFolder(userFolderPath);
        if (ffprobePath) {
            console.log(`[getFFprobePath] Encontrado en carpeta de usuario: ${ffprobePath}`);
            return ffprobePath;
        }
        console.warn('[getFFprobePath] No se encontró en carpeta de usuario, continuando...');
    }
    
    const systemPath = detectSystemFFprobe();
    if (systemPath) {
        ffprobePath = systemPath;
        console.log(`[getFFprobePath] Usando ffprobe del sistema: ${ffprobePath}`);
        return ffprobePath;
    }
    
    const nodeModulesPath = detectNodeModulesFFprobe();
    if (nodeModulesPath) {
        ffprobePath = nodeModulesPath;
        console.log(`[getFFprobePath] Usando ffprobe de node_modules: ${ffprobePath}`);
        return ffprobePath;
    }
    
    const fixedPath = getFixedFFprobePath();
    if (fixedPath) {
        ffprobePath = fixedPath;
        console.log(`[getFFprobePath] Usando ffprobe de ruta fija: ${ffprobePath}`);
        return ffprobePath;
    }
    
    console.warn('[getFFprobePath] FFprobe NO encontrado (no es crítico, se retorna null)');
    return null;
}

function getFFplayPath(userFolderPath = null) {
    console.log('========================================');
    console.log('[getFFplayPath] Iniciando búsqueda de ffplay...');
    console.log('[getFFplayPath] ffplayPath en caché:', ffplayPath);
    console.log('[getFFplayPath] userFolderPath:', userFolderPath);
    
    if (ffplayPath && !userFolderPath) {
        console.log(`[getFFplayPath] Usando caché: ${ffplayPath}`);
        return ffplayPath;
    }
    
    if (userFolderPath && typeof userFolderPath === 'string') {
        console.log('[getFFplayPath] Intentando setBinariosFromFolder...');
        setBinariosFromFolder(userFolderPath);
        if (ffplayPath) {
            console.log(`[getFFplayPath] Encontrado en carpeta de usuario: ${ffplayPath}`);
            return ffplayPath;
        }
        console.warn('[getFFplayPath] No se encontró en carpeta de usuario, continuando...');
    }
    
    const fixedPath = getFixedFFplayPath();
    if (fixedPath) {
        ffplayPath = fixedPath;
        console.log(`[getFFplayPath] Usando ffplay de ruta fija: ${ffplayPath}`);
        return ffplayPath;
    }
    
    console.warn('[getFFplayPath] FFplay NO encontrado (no es crítico, se retorna null)');
    return null;
}

function resetBinarios() {
    console.log('[resetBinarios] Reiniciando rutas de binarios en caché');
    console.log(`[resetBinarios]   ffmpegPath anterior: ${ffmpegPath}`);
    console.log(`[resetBinarios]   ffprobePath anterior: ${ffprobePath}`);
    console.log(`[resetBinarios]   ffplayPath anterior: ${ffplayPath}`);
    ffmpegPath = null;
    ffprobePath = null;
    ffplayPath = null;
    console.log('[resetBinarios] Caché limpiada');
}

module.exports = {
    getFFmpegPath,
    getFFprobePath,
    getFFplayPath,
    setBinariosFromFolder,
    resetBinarios
};