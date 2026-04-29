const axios = require('axios');
const https = require('https');
const { getMachineId } = require('../auth/machineId');

class BackendClient {
    constructor(baseURL = 'https://api.procuradortool.com') {
        this.baseURL = baseURL;
        this.token = null;
        this.sessionKey = null;
        this.user = null;
        this.machineId = getMachineId();

        const httpsAgent = new https.Agent({
            rejectUnauthorized: true
        });

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            },
            httpsAgent: this.baseURL.startsWith('https') ? httpsAgent : undefined
        });

        // Interceptor para agregar token automáticamente
        this.client.interceptors.request.use(
            (config) => {
                if (this.token) {
                    config.headers.Authorization = `Bearer ${this.token}`;
                }
                return config;
            },
            (error) => Promise.reject(error)
        );
    }

    /**
     * Login
     */
    async login(email, password) {
        try {
            const response = await this.client.post('/auth/login', {
                email,
                password,
                machineId: this.machineId
            });

            if (response.data.success) {
                this.token = response.data.token;
                this.sessionKey = response.data.sessionKey;
                this.user = response.data.user;

                console.log('✅ Login exitoso:', this.user.email);
                return {
                    success: true,
                    user: this.user,
                    subscription: response.data.subscription,
                    promoStatus: response.data.promoStatus || null
                };
            }

            return { success: false, error: 'Login fallido' };
        } catch (error) {
            console.error('❌ Error en login:', error.message);
            return {
                success: false,
                code:  error.response?.data?.code  || null,
                error: error.response?.data?.error || error.message
            };
        }
    }

    /**
     * Verificar sesión activa
     */
    async verifySession() {
        try {
            const response = await this.client.post('/client/verify-session', {
                machineId: this.machineId
            });

            return response.data;
        } catch (error) {
            console.error('❌ Error verificando sesión:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Listar scripts disponibles
     */
    async listScripts() {
        try {
            const response = await this.client.get('/client/scripts/available');
            return response.data;
        } catch (error) {
            console.error('❌ Error listando scripts:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verificar si el hash del script en caché sigue siendo el actual del servidor.
     * Request liviano: solo devuelve hash y version, sin desencriptar ni firmar.
     */
    async checkScriptVersion(scriptName) {
        try {
            const response = await this.client.get(`/client/scripts/check/${scriptName}`);
            return response.data;
        } catch (error) {
            console.error(`❌ Error verificando versión de ${scriptName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Descargar script encriptado
     */
    async downloadScript(scriptName) {
        try {
            const response = await this.client.get(`/client/scripts/download/${scriptName}`);
            return response.data;
        } catch (error) {
            console.error(`❌ Error descargando ${scriptName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Registrar ejecución de script
     * @param {string} scriptName
     * @param {boolean} success
     * @param {string|null} errorMessage
     * @param {number} executionTime
     * @param {string|null} subsystem - 'proc', 'informe', or 'monitor_novedades'
     * @param {number|null} expedientesCount
     */
    async logExecution(scriptName, success, errorMessage = null, executionTime = 0, subsystem = null, expedientesCount = null) {
        try {
            const response = await this.client.post('/client/scripts/log-execution', {
                scriptName,
                success,
                errorMessage,
                executionTime,
                subsystem,
                expedientesCount
            });
            return response.data;
        } catch (error) {
            console.error('❌ Error registrando ejecución:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Renovar token JWT
     */
    async refreshToken() {
        try {
            const response = await this.client.post('/auth/refresh');
            if (response.data.success) {
                this.token = response.data.token;
                console.log('🔄 Token renovado');
                return { success: true };
            }
            return { success: false, error: 'Refresh fallido' };
        } catch (error) {
            console.error('❌ Error renovando token:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Heartbeat (mantener sesión activa)
     */
    async heartbeat() {
        try {
            const response = await this.client.post('/client/heartbeat');
            return response.data;
        } catch (error) {
            console.error('❌ Error en heartbeat:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Logout (invalida token en el servidor)
     */
    async logout() {
        try {
            // Invalidar token en el backend
            if (this.token) {
                await this.client.post('/auth/logout');
            }
        } catch (error) {
            console.error('❌ Error en logout remoto:', error.message);
        } finally {
            this.token = null;
            this.sessionKey = null;
            this.user = null;
            console.log('👋 Sesión cerrada');
        }
    }

    /**
     * Verificar si está autenticado
     */
    isAuthenticated() {
        return this.token !== null;
    }

    /**
     * Obtener información del usuario
     */
    getUser() {
        return this.user;
    }

    /**
     * Obtener información de cuenta (plan, uso, suscripción)
     */
    async getAccount() {
        try {
            const response = await this.client.get('/client/account');
            return { success: true, account: response.data.account };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Consultar límites de batch antes de ejecutar (sin consumir uso)
     */
    async getBatchLimits() {
        try {
            const response = await this.client.get('/client/batch-limits');
            return { success: true, batch: response.data.batch };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Listar tickets propios del usuario
     */
    async getTickets() {
        try {
            const response = await this.client.get('/tickets');
            return { success: true, tickets: response.data.tickets };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Obtener detalle de un ticket con comentarios
     */
    async getTicketDetail(ticketId) {
        try {
            const response = await this.client.get(`/tickets/${ticketId}`);
            return { success: true, ticket: response.data.ticket, comments: response.data.comments };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Crear un nuevo ticket de soporte
     */
    async createTicket(category, title, description) {
        try {
            const response = await this.client.post('/tickets', { category, title, description });
            return { success: true, ticket: response.data.ticket };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Agregar comentario a un ticket existente
     */
    async addTicketComment(ticketId, message) {
        try {
            const response = await this.client.post(`/tickets/${ticketId}/comment`, { message });
            return { success: true, comment: response.data.comment };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Obtener notificaciones in-app del usuario
     */
    async getNotifications() {
        try {
            const response = await this.client.get('/notifications');
            return { success: true, notifications: response.data.notifications };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Marcar notificación como leída
     */
    async markNotificationRead(id) {
        try {
            const response = await this.client.post(`/notifications/${id}/read`);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Adquirir lock de ejecución multi-dispositivo
     */
    async startExecution(scriptName) {
        try {
            const response = await this.client.post('/license/execution/start', {
                machineId: this.machineId,
                scriptName
            });
            return response.data;
        } catch (error) {
            const data = error.response?.data;
            return { success: false, code: data?.code, error: data?.error || error.message };
        }
    }

    /**
     * Heartbeat del lock de ejecución (renovar TTL cada 30 s)
     */
    async executionHeartbeat() {
        try {
            const response = await this.client.post('/license/execution/heartbeat', {
                machineId: this.machineId
            });
            return response.data;
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Liberar lock de ejecución al finalizar
     */
    async endExecution() {
        try {
            const response = await this.client.post('/license/execution/end', {
                machineId: this.machineId
            });
            return response.data;
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }

    /**
     * Petición genérica autenticada (GET/POST/PUT/DELETE)
     * @param {string} method   - 'GET'|'POST'|'PUT'|'DELETE'
     * @param {string} endpoint - e.g. '/monitor/partes'
     * @param {object} [data]   - body para POST/PUT
     */
    async request(method, endpoint, data = null) {
        try {
            const config = {};
            let response;
            const m = method.toLowerCase();
            if (m === 'get' || m === 'delete') {
                response = await this.client[m](endpoint, config);
            } else {
                // data=null/undefined → enviar {} para que body-parser no falle con "null"
                response = await this.client[m](endpoint, data ?? {}, config);
            }
            return { success: true, ...response.data };
        } catch (error) {
            return { success: false, error: error.response?.data?.error || error.message };
        }
    }
}

module.exports = BackendClient;