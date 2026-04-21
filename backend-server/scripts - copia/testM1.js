(async function (params) {
    console.log('🚀 Ejecutando testM1...');
    console.log('Parámetros recibidos:', params);

    // Simular procesamiento
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
        success: true,
        message: 'Test M1 ejecutado correctamente',
        timestamp: new Date().toISOString(),
        params: params
    };
})(params);