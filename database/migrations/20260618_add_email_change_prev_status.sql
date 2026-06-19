-- Cambio de email por admin: al cambiar el email se suspende la cuenta (pending_email)
-- hasta que el usuario verifique el nuevo correo. Esta columna recuerda el
-- registration_status previo para restaurarlo tras la verificación (sin re-activación).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_change_prev_status VARCHAR(30);
