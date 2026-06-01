/**
 * utils/passwordPolicy.js
 * Política de contraseñas (B-2 — Opción A, equilibrada).
 *
 * Reglas:
 *   1. Mínimo 8 caracteres
 *   2. Al menos una letra y un número
 *   3. No estar en la lista de contraseñas comunes
 *   4. No ser igual al email (ni a su parte local)
 *
 * Solo aplica a contraseñas NUEVAS (registro, reset, cambio).
 * El login no usa esta validación → los usuarios existentes no se ven afectados.
 *
 * Devuelve mensajes específicos según el requisito que falla (UX estándar).
 */

// Lista corta de contraseñas notoriamente débiles (en minúsculas).
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'passw0rd',
  'qwerty123', 'qwertyui', '11111111', '00000000', 'abcd1234', 'abc12345',
  'contraseña', 'contrasena', 'iloveyou', 'admin123', 'letmein1', 'welcome1',
  'football1', 'sunshine1', 'princess1', '12345678a', 'a12345678', 'asdf1234'
]);

// Texto de requisitos para mostrar al usuario (mismo en backend y frontend).
const POLICY_HINT = 'Mínimo 8 caracteres, con al menos una letra y un número.';

/**
 * @param {string} password
 * @param {string} [email]  para evitar que la contraseña sea igual al email
 * @returns {{ valid: boolean, error: string|null }}
 */
function validatePassword(password, email = '') {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasLetter || !hasNumber) {
    return { valid: false, error: 'La contraseña debe incluir al menos una letra y un número.' };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: 'Esa contraseña es demasiado común. Elegí una más segura.' };
  }

  if (email) {
    const emailLower = email.toLowerCase();
    const localPart  = emailLower.split('@')[0] || '';
    const pwdLower    = password.toLowerCase();
    if (pwdLower === emailLower || (localPart.length >= 4 && pwdLower === localPart)) {
      return { valid: false, error: 'La contraseña no puede ser igual a tu email.' };
    }
  }

  return { valid: true, error: null };
}

module.exports = { validatePassword, POLICY_HINT };
