(async function (params) {
    console.log('🚀 Listando expedientes SCW...');

    const { filtro, limite } = params || {};

    // Simular consulta al sistema
    await new Promise(resolve => setTimeout(resolve, 2000));

    const expedientes = [];
    const maxExpedientes = limite || 10;

    for (let i = 1; i <= maxExpedientes; i++) {
        expedientes.push({
            numero: `EXP-${1000 + i}/2026`,
            caratula: `CASO DE PRUEBA ${i}`,
            estado: i % 3 === 0 ? 'Archivado' : 'En trámite',
            fechaInicio: `2026-01-${String(i).padStart(2, '0')}`,
            juzgado: `Juzgado N°${(i % 5) + 1}`
        });
    }

    return {
        success: true,
        totalExpedientes: expedientes.length,
        filtroAplicado: filtro || 'ninguno',
        expedientes,
        consultadoEn: new Date().toISOString()
    };
})(params);