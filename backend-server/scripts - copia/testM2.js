(async function (params) {
    console.log('🚀 Ejecutando testM2...');

    const operations = [];

    // Simular múltiples operaciones
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        operations.push({
            step: i + 1,
            status: 'completed',
            timestamp: new Date().toISOString()
        });
    }

    return {
        success: true,
        message: 'Test M2 completado',
        operationsCount: operations.length,
        operations,
        params: params
    };
})(params);