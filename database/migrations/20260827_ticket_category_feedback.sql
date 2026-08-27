-- 20260827_ticket_category_feedback.sql
--
-- Agrega la categoría 'feedback' ("Enviar comentario") a support_tickets.
--
-- Por qué hace falta una migración para agregar una opción a un <select>:
-- `support_tickets.category` tiene un CHECK que enumera los valores permitidos
-- ('technical','billing','commercial'). Sin ampliarlo, el INSERT del ticket falla
-- con una violación de constraint — el <select> del portal mostraría la opción
-- nueva y el envío rompería en el último paso, del lado del servidor.
--
-- 100% aditiva: no cambia ni una fila existente, solo amplía el conjunto aceptado.
-- Reaplicable sin efecto (DROP ... IF EXISTS + ADD con el mismo nombre).

BEGIN;

ALTER TABLE public.support_tickets
    DROP CONSTRAINT IF EXISTS support_tickets_category_check;

ALTER TABLE public.support_tickets
    ADD CONSTRAINT support_tickets_category_check
    CHECK (((category)::text = ANY ((ARRAY[
        'technical'::character varying,
        'billing'::character varying,
        'commercial'::character varying,
        'feedback'::character varying
    ])::text[])));

COMMENT ON COLUMN public.support_tickets.category IS
    'technical | billing | commercial | feedback — "feedback" (Enviar comentario) se agregó el 2026-08-27 junto con el botón de comentario del topbar de la app Electron y del portal.';

COMMIT;
