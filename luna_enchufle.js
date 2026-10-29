// luna_enchufle.js
// Singleton perezoso del módulo LUNA.
// El require se hace UNA sola vez, la primera vez que alguien llame getLUNA().
// Cine, convertidor y el IPC del render consumen LUNA desde aquí.

const path = require('path');

const LUNA_PATH = path.join(__dirname, './LUNA_clasificador.js');

let lunaInstance = null;

/**
 * Devuelve el módulo LUNA completo (con todos sus exports).
 * Hace el require la primera vez y lo cachea.
 */
function getLUNA() {
    if (lunaInstance === null) {
        lunaInstance = require(LUNA_PATH);
    }
    return lunaInstance;
}

module.exports = { getLUNA, LUNA_PATH };