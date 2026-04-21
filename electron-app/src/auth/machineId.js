const os = require('os');
const crypto = require('crypto');

/**
 * Obtiene las MAC addresses de interfaces físicas (estables).
 * Excluye: interfaces internas (loopback), virtuales, VPN, Docker, etc.
 */
function getStableMacAddresses() {
    const interfaces = os.networkInterfaces();
    const macs = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
        // Excluir interfaces virtuales conocidas
        const lowerName = name.toLowerCase();
        const isVirtual = lowerName.includes('vmware') ||
            lowerName.includes('virtualbox') ||
            lowerName.includes('vbox') ||
            lowerName.includes('docker') ||
            lowerName.includes('veth') ||
            lowerName.includes('br-') ||
            lowerName.includes('vpn') ||
            lowerName.includes('tun') ||
            lowerName.includes('tap') ||
            lowerName.includes('wsl') ||
            lowerName.includes('loopback');

        if (isVirtual) continue;

        for (const addr of addrs) {
            // Solo MAC no vacías, no internas, no all-zeros
            if (!addr.internal &&
                addr.mac &&
                addr.mac !== '00:00:00:00:00:00') {
                macs.push(addr.mac);
            }
        }
    }

    // Ordenar para consistencia (el orden de interfaces puede variar)
    return [...new Set(macs)].sort();
}

/**
 * Genera un ID único y estable basado en hardware de la máquina.
 * Usa solo datos que NO cambian con la red, VPN o reinicios:
 *   - Plataforma y arquitectura (constantes del SO)
 *   - Hostname (estable salvo cambio manual)
 *   - Modelo de CPU (hardware fijo)
 *   - Cantidad de cores (hardware fijo)
 *   - Total de RAM (hardware fijo)
 *   - MAC addresses de interfaces físicas (hardware fijo)
 */
function getMachineId() {
    try {
        const cpus = os.cpus();
        const macs = getStableMacAddresses();

        const uniqueString = [
            os.platform(),
            os.arch(),
            os.hostname(),
            cpus[0]?.model || '',
            cpus.length.toString(),
            os.totalmem().toString(),
            macs.join(',')
        ].join('|');

        const hash = crypto.createHash('sha256')
            .update(uniqueString)
            .digest('hex');

        return hash;
    } catch (error) {
        console.error('Error generando machine ID:', error);
        // Fallback: datos mínimos estables
        return crypto.createHash('sha256')
            .update([os.hostname(), os.platform(), os.arch()].join('|'))
            .digest('hex');
    }
}

module.exports = { getMachineId };