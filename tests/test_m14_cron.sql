-- M14 — Cron Job Verification Tests
-- Run with: sudo -u postgres psql procurador_db -f /tmp/test_m14_cron.sql

\set ON_ERROR_STOP off
\pset footer off

-- Pre-clean (cascade via FK on delete)
DELETE FROM users WHERE email LIKE 'cron_n0%@test.internal';

DO $$
DECLARE
    v_uid        INT;
    v_status     TEXT;
    v_sub_status TEXT;
    v_cause      TEXT;
    v_grace      TEXT;
    v_ev_count   INT;
    v_nt_count   INT;
    v_plan_id    INT;
    v_plan_limit INT;
    v_plan_name  TEXT;
    v_sched      JSONB;
    v_changes    INT;
    v_new_plan   TEXT;
    v_apply_at   TIMESTAMPTZ;
    pass_count   INT := 0;
    fail_count   INT := 0;
BEGIN

-- ══════════════════════════════════════════════════════
-- N-01: Trial agotado → rejected   (cron 5a, hourly)
-- ══════════════════════════════════════════════════════
RAISE NOTICE '';
RAISE NOTICE '── N-01: Trial agotado → rejected ────────────────────';

INSERT INTO users (email, password_hash, nombre, apellido, registration_status, role)
VALUES ('cron_n01@test.internal','hash','Test','N01','pending_activation','user')
RETURNING id INTO v_uid;

INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at, period_start)
VALUES (v_uid, 'BASIC', 1, 'active', 20, 20, NOW() + INTERVAL '365 days', NOW());

-- Replicate exact cron 5a logic
UPDATE users SET registration_status = 'rejected', updated_at = NOW()
WHERE id = v_uid
  AND registration_status = 'pending_activation'
  AND id IN (SELECT s.user_id FROM subscriptions s WHERE s.usage_count >= s.usage_limit);

UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = v_uid;

INSERT INTO user_events (user_id, event_type) VALUES (v_uid, 'trial_exhausted_blocked');
INSERT INTO notifications (user_id, type, message)
VALUES (v_uid, 'trial_exhausted', 'Tus usos de prueba se agotaron. Tu acceso ha sido bloqueado.');

-- Verify
SELECT u.registration_status INTO v_status FROM users u WHERE u.id = v_uid;
SELECT s.status             INTO v_sub_status FROM subscriptions s WHERE s.user_id = v_uid;
SELECT COUNT(*) INTO v_ev_count FROM user_events WHERE user_id = v_uid AND event_type = 'trial_exhausted_blocked';
SELECT COUNT(*) INTO v_nt_count FROM notifications WHERE user_id = v_uid AND type = 'trial_exhausted';

IF v_status = 'rejected' AND v_sub_status = 'cancelled' AND v_ev_count = 1 AND v_nt_count = 1 THEN
    RAISE NOTICE 'PASS N-01 — users.rejected | sub.cancelled | event+notif OK';
    pass_count := pass_count + 1;
ELSE
    RAISE WARNING 'FAIL N-01 — status=% sub=% events=% notifs=%', v_status, v_sub_status, v_ev_count, v_nt_count;
    fail_count := fail_count + 1;
END IF;

DELETE FROM users WHERE id = v_uid;


-- ══════════════════════════════════════════════════════
-- N-02: plan_expiry_date vencido → suspended_plan_expired  (cron 5c, daily)
-- ══════════════════════════════════════════════════════
RAISE NOTICE '';
RAISE NOTICE '── N-02: plan_expiry_date vencido → suspended_plan_expired ──';

INSERT INTO users (email, password_hash, nombre, apellido, registration_status, role)
VALUES ('cron_n02@test.internal','hash','Test','N02','active','user')
RETURNING id INTO v_uid;

INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at, period_start, plan_expiry_date)
VALUES (v_uid, 'BASIC', 1, 'active', 5, 50, NOW() - INTERVAL '1 day', NOW() - INTERVAL '31 days', NOW() - INTERVAL '1 day');

-- Replicate exact cron 5c logic
UPDATE users SET registration_status = 'suspended_plan_expired', updated_at = NOW()
WHERE id = v_uid
  AND registration_status = 'active'
  AND id IN (SELECT s.user_id FROM subscriptions s
             WHERE s.plan_expiry_date IS NOT NULL AND s.plan_expiry_date < NOW());

UPDATE subscriptions SET
    status = 'suspended_plan_expired',
    suspension_cause = 'plan_expired',
    suspended_at = NOW(),
    updated_at = NOW()
WHERE user_id = v_uid;

INSERT INTO user_events (user_id, event_type) VALUES (v_uid, 'plan_expired_suspended');
INSERT INTO notifications (user_id, type, message) VALUES (v_uid, 'plan_expired', 'Tu plan venció.');

-- Verify
SELECT u.registration_status INTO v_status FROM users u WHERE u.id = v_uid;
SELECT s.status, s.suspension_cause INTO v_sub_status, v_cause
FROM subscriptions s WHERE s.user_id = v_uid;

IF v_status = 'suspended_plan_expired' AND v_sub_status = 'suspended_plan_expired' AND v_cause = 'plan_expired' THEN
    RAISE NOTICE 'PASS N-02 — suspended_plan_expired | suspension_cause=plan_expired';
    pass_count := pass_count + 1;
ELSE
    RAISE WARNING 'FAIL N-02 — status=% sub=% cause=%', v_status, v_sub_status, v_cause;
    fail_count := fail_count + 1;
END IF;

DELETE FROM users WHERE id = v_uid;


-- ══════════════════════════════════════════════════════
-- N-03: cancel_at vencido → cancelled   (cron 5f, daily)
-- ══════════════════════════════════════════════════════
RAISE NOTICE '';
RAISE NOTICE '── N-03: cancel_at vencido → cancelled ────────────────';

INSERT INTO users (email, password_hash, nombre, apellido, registration_status, role)
VALUES ('cron_n03@test.internal','hash','Test','N03','active','user')
RETURNING id INTO v_uid;

INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at, period_start, cancel_at)
VALUES (v_uid, 'BASIC', 1, 'active', 5, 50, NOW() + INTERVAL '10 days', NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 hour');

-- Replicate exact cron 5f logic
UPDATE users SET registration_status = 'cancelled', updated_at = NOW()
WHERE id = v_uid
  AND registration_status = 'active'
  AND id IN (SELECT s.user_id FROM subscriptions s
             WHERE s.cancel_at IS NOT NULL AND s.cancel_at < NOW());

UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = v_uid;
INSERT INTO user_events (user_id, event_type) VALUES (v_uid, 'subscription_cancelled_expired');

-- Verify
SELECT u.registration_status INTO v_status FROM users u WHERE u.id = v_uid;
SELECT s.status INTO v_sub_status FROM subscriptions s WHERE s.user_id = v_uid;
SELECT COUNT(*) INTO v_ev_count FROM user_events
WHERE user_id = v_uid AND event_type = 'subscription_cancelled_expired';

IF v_status = 'cancelled' AND v_sub_status = 'cancelled' AND v_ev_count = 1 THEN
    RAISE NOTICE 'PASS N-03 — registration_status=cancelled | sub=cancelled | event OK';
    pass_count := pass_count + 1;
ELSE
    RAISE WARNING 'FAIL N-03 — status=% sub=% event=%', v_status, v_sub_status, v_ev_count;
    fail_count := fail_count + 1;
END IF;

DELETE FROM users WHERE id = v_uid;


-- ══════════════════════════════════════════════════════
-- N-04: payment_grace_ends_at vencido → suspended   (cron 5h, daily)
-- ══════════════════════════════════════════════════════
RAISE NOTICE '';
RAISE NOTICE '── N-04: payment_grace_ends_at vencido → suspended ────';

INSERT INTO users (email, password_hash, nombre, apellido, registration_status, role)
VALUES ('cron_n04@test.internal','hash','Test','N04','active','user')
RETURNING id INTO v_uid;

INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at, period_start, payment_grace_ends_at)
VALUES (v_uid, 'BASIC', 1, 'active', 5, 50, NOW() + INTERVAL '10 days', NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 hour');

-- Replicate exact cron 5h logic
UPDATE users SET registration_status = 'suspended', updated_at = NOW()
WHERE id = v_uid
  AND registration_status = 'active'
  AND id IN (SELECT s.user_id FROM subscriptions s
             WHERE s.payment_grace_ends_at IS NOT NULL AND s.payment_grace_ends_at < NOW());

UPDATE subscriptions SET
    status = 'suspended',
    suspension_cause = 'payment',
    suspended_at = NOW(),
    payment_grace_ends_at = NULL,
    updated_at = NOW()
WHERE user_id = v_uid;

INSERT INTO user_events (user_id, event_type) VALUES (v_uid, 'payment_failed_suspended');
INSERT INTO notifications (user_id, type, message)
VALUES (v_uid, 'payment_suspended', 'Pago fallido. Actualizá tu método de pago en el portal para reactivar.');

-- Verify
SELECT u.registration_status INTO v_status FROM users u WHERE u.id = v_uid;
SELECT s.status, s.suspension_cause, s.payment_grace_ends_at::TEXT
INTO v_sub_status, v_cause, v_grace
FROM subscriptions s WHERE s.user_id = v_uid;

IF v_status = 'suspended' AND v_sub_status = 'suspended' AND v_cause = 'payment' AND v_grace IS NULL THEN
    RAISE NOTICE 'PASS N-04 — suspended(payment) | payment_grace_ends_at=NULL';
    pass_count := pass_count + 1;
ELSE
    RAISE WARNING 'FAIL N-04 — status=% sub=% cause=% grace=%', v_status, v_sub_status, v_cause, v_grace;
    fail_count := fail_count + 1;
END IF;

DELETE FROM users WHERE id = v_uid;


-- ══════════════════════════════════════════════════════
-- N-05: scheduled_plan.apply_at vencido → plan changed   (cron 5g, daily)
-- ══════════════════════════════════════════════════════
RAISE NOTICE '';
RAISE NOTICE '── N-05: scheduled_plan apply_at vencido → plan changed ──';

SELECT p.id, p.proc_executions_limit, p.name
INTO v_plan_id, v_plan_limit, v_plan_name
FROM plans p WHERE p.name = 'BASIC' LIMIT 1;

IF v_plan_id IS NULL THEN
    RAISE NOTICE 'SKIP N-05 — plan BASIC not found in DB';
ELSE
    INSERT INTO users (email, password_hash, nombre, apellido, registration_status, role)
    VALUES ('cron_n05@test.internal','hash','Test','N05','active','user')
    RETURNING id INTO v_uid;

    v_apply_at := NOW() - INTERVAL '2 hours';

    INSERT INTO subscriptions (user_id, plan, plan_id, status, usage_count, usage_limit, expires_at, period_start, scheduled_plan, plan_changes_this_cycle)
    VALUES (v_uid, 'COMBO_PROMO', 5, 'active', 5, 50,
            NOW() + INTERVAL '20 days',
            NOW() - INTERVAL '10 days',
            jsonb_build_object('plan_id', v_plan_id, 'plan_name', v_plan_name, 'apply_at', v_apply_at::TEXT),
            1);

    -- Replicate exact cron 5g logic
    UPDATE subscriptions SET
        plan = v_plan_name,
        plan_id = v_plan_id,
        usage_limit = CASE WHEN v_plan_limit = -1 THEN 999999 ELSE v_plan_limit END,
        expires_at = NOW() + INTERVAL '30 days',
        next_billing_date = NOW() + INTERVAL '30 days',
        period_start = NOW(),
        plan_changes_this_cycle = 0,
        scheduled_plan = NULL,
        updated_at = NOW()
    WHERE user_id = v_uid AND status = 'active';

    INSERT INTO user_events (user_id, event_type, payload)
    VALUES (v_uid, 'plan_downgrade_applied', jsonb_build_object('to', v_plan_name));

    INSERT INTO notifications (user_id, type, message)
    VALUES (v_uid, 'plan_downgrade_applied', 'Tu plan fue actualizado a ' || v_plan_name || '.');

    -- Verify
    SELECT s.plan, s.scheduled_plan, s.plan_changes_this_cycle
    INTO v_new_plan, v_sched, v_changes
    FROM subscriptions s WHERE s.user_id = v_uid;

    SELECT COUNT(*) INTO v_ev_count FROM user_events
    WHERE user_id = v_uid AND event_type = 'plan_downgrade_applied';

    IF v_new_plan = 'BASIC' AND v_sched IS NULL AND v_changes = 0 AND v_ev_count = 1 THEN
        RAISE NOTICE 'PASS N-05 — plan=BASIC | scheduled_plan=NULL | plan_changes_this_cycle=0 | event OK';
        pass_count := pass_count + 1;
    ELSE
        RAISE WARNING 'FAIL N-05 — plan=% sched=% changes=% event=%', v_new_plan, v_sched, v_changes, v_ev_count;
        fail_count := fail_count + 1;
    END IF;

    DELETE FROM users WHERE id = v_uid;
END IF;

-- ══════════════════════════════════════════════════════
-- RESULT
-- ══════════════════════════════════════════════════════
RAISE NOTICE '';
RAISE NOTICE '══════════════════════════════════════════════════════';
RAISE NOTICE '  RESULT: % PASS  /  % FAIL', pass_count, fail_count;
RAISE NOTICE '══════════════════════════════════════════════════════';

END $$;

-- Final cleanup (safety net)
DELETE FROM users WHERE email LIKE 'cron_n0%@test.internal';
