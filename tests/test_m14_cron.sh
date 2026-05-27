#!/bin/bash
# M14 — Cron Job Verification Tests
# Simulates each cron's SQL logic against temporary test users

PG="sudo -u postgres psql procurador_db"
PASS=0; FAIL=0

run_q() { $PG -t -A -c "$1" 2>/dev/null; }

echo "=================================================="
echo "  M14 — CRON JOB VERIFICATION"
echo "=================================================="

# ─── Pre-clean ────────────────────────────────────────
for mail in cron_n01 cron_n02 cron_n03 cron_n04 cron_n05; do
    $PG -c "DELETE FROM users WHERE email='${mail}@test.internal'" > /dev/null 2>&1
done

# ════════════════════════════════════════════════════════
# N-01: Trial agotado → rejected   (cron 5a, cada hora)
# ════════════════════════════════════════════════════════
echo ""
echo "── N-01: Trial agotado → rejected ──────────────"

U=$(run_q "INSERT INTO users (email,password_hash,nombre,apellido,registration_status,role)
           VALUES ('cron_n01@test.internal','hash','Test','N01','pending_activation','user')
           RETURNING id")

$PG -c "INSERT INTO subscriptions (user_id,plan,status,usage_count,usage_limit,expires_at,period_start)
        VALUES ($U,'TRIAL','active',20,20,NOW()+INTERVAL '365 days',NOW())" > /dev/null 2>&1

# Replicate cron 5a SQL exactly
$PG -c "UPDATE users SET registration_status='rejected', updated_at=NOW()
        WHERE id=$U AND registration_status='pending_activation'
          AND id IN (SELECT user_id FROM subscriptions WHERE usage_count>=usage_limit)" > /dev/null
$PG -c "UPDATE subscriptions SET status='cancelled', updated_at=NOW() WHERE user_id=$U" > /dev/null
$PG -c "INSERT INTO user_events (user_id,event_type) VALUES ($U,'trial_exhausted_blocked')" > /dev/null
$PG -c "INSERT INTO notifications (user_id,type,message) VALUES ($U,'trial_exhausted','Tus usos de prueba se agotaron.')" > /dev/null

S=$(run_q "SELECT registration_status FROM users WHERE id=$U")
SS=$(run_q "SELECT status FROM subscriptions WHERE user_id=$U")
EV=$(run_q "SELECT COUNT(*) FROM user_events WHERE user_id=$U AND event_type='trial_exhausted_blocked'")
NT=$(run_q "SELECT COUNT(*) FROM notifications WHERE user_id=$U AND type='trial_exhausted'")

if [ "$S" = "rejected" ] && [ "$SS" = "cancelled" ] && [ "$EV" = "1" ] && [ "$NT" = "1" ]; then
    echo "PASS N-01 — users.rejected | sub.cancelled | event+notif OK"
    PASS=$((PASS+1))
else
    echo "FAIL N-01 — status=$S sub=$SS events=$EV notifs=$NT"
    FAIL=$((FAIL+1))
fi
$PG -c "DELETE FROM users WHERE id=$U" > /dev/null 2>&1

# ════════════════════════════════════════════════════════
# N-02: plan_expiry_date vencido → suspended_plan_expired (cron 5c, diario)
# ════════════════════════════════════════════════════════
echo ""
echo "── N-02: plan_expiry_date vencido → suspended_plan_expired ──"

U=$(run_q "INSERT INTO users (email,password_hash,nombre,apellido,registration_status,role)
           VALUES ('cron_n02@test.internal','hash','Test','N02','active','user')
           RETURNING id")

$PG -c "INSERT INTO subscriptions (user_id,plan,status,usage_count,usage_limit,expires_at,period_start,plan_expiry_date)
        VALUES ($U,'BASIC','active',5,50,NOW()-INTERVAL '1 day',NOW()-INTERVAL '31 days',NOW()-INTERVAL '1 day')" > /dev/null 2>&1

# Replicate cron 5c SQL exactly
$PG -c "UPDATE users SET registration_status='suspended_plan_expired', updated_at=NOW()
        WHERE id=$U AND registration_status='active'
          AND id IN (SELECT user_id FROM subscriptions
                     WHERE plan_expiry_date IS NOT NULL AND plan_expiry_date < NOW())" > /dev/null
$PG -c "UPDATE subscriptions SET status='suspended_plan_expired', suspension_cause='plan_expired',
        suspended_at=NOW(), updated_at=NOW() WHERE user_id=$U" > /dev/null
$PG -c "INSERT INTO user_events (user_id,event_type) VALUES ($U,'plan_expired_suspended')" > /dev/null
$PG -c "INSERT INTO notifications (user_id,type,message) VALUES ($U,'plan_expired','Tu plan venció.')" > /dev/null

S=$(run_q "SELECT registration_status FROM users WHERE id=$U")
SS=$(run_q "SELECT status FROM subscriptions WHERE user_id=$U")
CA=$(run_q "SELECT suspension_cause FROM subscriptions WHERE user_id=$U")

if [ "$S" = "suspended_plan_expired" ] && [ "$SS" = "suspended_plan_expired" ] && [ "$CA" = "plan_expired" ]; then
    echo "PASS N-02 — suspended_plan_expired | suspension_cause=plan_expired"
    PASS=$((PASS+1))
else
    echo "FAIL N-02 — status=$S sub=$SS cause=$CA"
    FAIL=$((FAIL+1))
fi
$PG -c "DELETE FROM users WHERE id=$U" > /dev/null 2>&1

# ════════════════════════════════════════════════════════
# N-03: cancel_at vencido → cancelled (cron 5f, diario)
# ════════════════════════════════════════════════════════
echo ""
echo "── N-03: cancel_at vencido → cancelled ──────────"

U=$(run_q "INSERT INTO users (email,password_hash,nombre,apellido,registration_status,role)
           VALUES ('cron_n03@test.internal','hash','Test','N03','active','user')
           RETURNING id")

$PG -c "INSERT INTO subscriptions (user_id,plan,status,usage_count,usage_limit,expires_at,period_start,cancel_at)
        VALUES ($U,'BASIC','active',5,50,NOW()+INTERVAL '10 days',NOW()-INTERVAL '20 days',NOW()-INTERVAL '1 hour')" > /dev/null 2>&1

# Replicate cron 5f SQL exactly
$PG -c "UPDATE users SET registration_status='cancelled', updated_at=NOW()
        WHERE id=$U AND registration_status='active'
          AND id IN (SELECT user_id FROM subscriptions
                     WHERE cancel_at IS NOT NULL AND cancel_at < NOW())" > /dev/null
$PG -c "UPDATE subscriptions SET status='cancelled', updated_at=NOW() WHERE user_id=$U" > /dev/null
$PG -c "INSERT INTO user_events (user_id,event_type) VALUES ($U,'subscription_cancelled_expired')" > /dev/null

S=$(run_q "SELECT registration_status FROM users WHERE id=$U")
SS=$(run_q "SELECT status FROM subscriptions WHERE user_id=$U")
EV=$(run_q "SELECT COUNT(*) FROM user_events WHERE user_id=$U AND event_type='subscription_cancelled_expired'")

if [ "$S" = "cancelled" ] && [ "$SS" = "cancelled" ] && [ "$EV" = "1" ]; then
    echo "PASS N-03 — registration_status=cancelled | sub=cancelled | event OK"
    PASS=$((PASS+1))
else
    echo "FAIL N-03 — status=$S sub=$SS event=$EV"
    FAIL=$((FAIL+1))
fi
$PG -c "DELETE FROM users WHERE id=$U" > /dev/null 2>&1

# ════════════════════════════════════════════════════════
# N-04: payment_grace_ends_at vencido → suspended (cron 5h, diario)
# ════════════════════════════════════════════════════════
echo ""
echo "── N-04: payment_grace_ends_at vencido → suspended ──"

U=$(run_q "INSERT INTO users (email,password_hash,nombre,apellido,registration_status,role)
           VALUES ('cron_n04@test.internal','hash','Test','N04','active','user')
           RETURNING id")

$PG -c "INSERT INTO subscriptions (user_id,plan,status,usage_count,usage_limit,expires_at,period_start,payment_grace_ends_at)
        VALUES ($U,'BASIC','active',5,50,NOW()+INTERVAL '10 days',NOW()-INTERVAL '20 days',NOW()-INTERVAL '1 hour')" > /dev/null 2>&1

# Replicate cron 5h SQL exactly
$PG -c "UPDATE users SET registration_status='suspended', updated_at=NOW()
        WHERE id=$U AND registration_status='active'
          AND id IN (SELECT user_id FROM subscriptions
                     WHERE payment_grace_ends_at IS NOT NULL AND payment_grace_ends_at < NOW())" > /dev/null
$PG -c "UPDATE subscriptions SET status='suspended', suspension_cause='payment',
        suspended_at=NOW(), payment_grace_ends_at=NULL, updated_at=NOW()
        WHERE user_id=$U" > /dev/null
$PG -c "INSERT INTO user_events (user_id,event_type) VALUES ($U,'payment_failed_suspended')" > /dev/null
$PG -c "INSERT INTO notifications (user_id,type,message) VALUES ($U,'payment_suspended','Pago fallido.')" > /dev/null

S=$(run_q "SELECT registration_status FROM users WHERE id=$U")
SS=$(run_q "SELECT status FROM subscriptions WHERE user_id=$U")
CA=$(run_q "SELECT suspension_cause FROM subscriptions WHERE user_id=$U")
GR=$(run_q "SELECT payment_grace_ends_at FROM subscriptions WHERE user_id=$U")

if [ "$S" = "suspended" ] && [ "$SS" = "suspended" ] && [ "$CA" = "payment" ] && [ -z "$GR" ]; then
    echo "PASS N-04 — suspended(payment) | grace_ends_at=NULL"
    PASS=$((PASS+1))
else
    echo "FAIL N-04 — status=$S sub=$SS cause=$CA grace=$GR"
    FAIL=$((FAIL+1))
fi
$PG -c "DELETE FROM users WHERE id=$U" > /dev/null 2>&1

# ════════════════════════════════════════════════════════
# N-05: scheduled_plan.apply_at vencido → plan cambiado (cron 5g, diario)
# ════════════════════════════════════════════════════════
echo ""
echo "── N-05: scheduled_plan apply_at vencido → plan changed ──"

PLAN_ID=$(run_q "SELECT id FROM plans WHERE name='BASIC' LIMIT 1")
PLAN_LIMIT=$(run_q "SELECT proc_executions_limit FROM plans WHERE id=$PLAN_ID")

if [ -z "$PLAN_ID" ]; then
    echo "SKIP N-05 — plan BASIC not found in DB"
else
    U=$(run_q "INSERT INTO users (email,password_hash,nombre,apellido,registration_status,role)
               VALUES ('cron_n05@test.internal','hash','Test','N05','active','user')
               RETURNING id")

    APPLY_AT=$(date -u -d '2 hours ago' '+%Y-%m-%dT%H:%M:%S')
    SCHED="{\"plan_id\": $PLAN_ID, \"plan_name\": \"BASIC\", \"apply_at\": \"$APPLY_AT\"}"

    $PG -c "INSERT INTO subscriptions (user_id,plan,plan_id,status,usage_count,usage_limit,expires_at,period_start,scheduled_plan,plan_changes_this_cycle)
            VALUES ($U,'COMBO_PROMO',1,'active',5,50,NOW()+INTERVAL '20 days',NOW()-INTERVAL '10 days','$SCHED',1)" > /dev/null 2>&1

    # Replicate cron 5g SQL — get new plan data first
    NP_NAME=$(run_q "SELECT name FROM plans WHERE id=$PLAN_ID")
    NP_PROC=$(run_q "SELECT proc_executions_limit FROM plans WHERE id=$PLAN_ID")
    if [ "$NP_PROC" = "-1" ]; then NP_LIMIT=999999; else NP_LIMIT=$NP_PROC; fi
    NEW_EXP=$(date -u -d '30 days' '+%Y-%m-%d %H:%M:%S')

    $PG -c "UPDATE subscriptions SET
              plan='$NP_NAME', plan_id=$PLAN_ID, usage_limit=$NP_LIMIT,
              expires_at='$NEW_EXP', next_billing_date='$NEW_EXP',
              period_start=NOW(), plan_changes_this_cycle=0,
              scheduled_plan=NULL, updated_at=NOW()
            WHERE user_id=$U AND status='active'" > /dev/null
    $PG -c "INSERT INTO user_events (user_id,event_type,payload) VALUES ($U,'plan_downgrade_applied','{\"to\":\"BASIC\"}')" > /dev/null
    $PG -c "INSERT INTO notifications (user_id,type,message) VALUES ($U,'plan_downgrade_applied','Tu plan fue actualizado a BASIC.')" > /dev/null

    NP=$(run_q "SELECT plan FROM subscriptions WHERE user_id=$U")
    SC=$(run_q "SELECT scheduled_plan FROM subscriptions WHERE user_id=$U")
    CH=$(run_q "SELECT plan_changes_this_cycle FROM subscriptions WHERE user_id=$U")
    EV=$(run_q "SELECT COUNT(*) FROM user_events WHERE user_id=$U AND event_type='plan_downgrade_applied'")

    if [ "$NP" = "BASIC" ] && [ -z "$SC" ] && [ "$CH" = "0" ] && [ "$EV" = "1" ]; then
        echo "PASS N-05 — plan=BASIC | scheduled_plan=NULL | changes=0 | event OK"
        PASS=$((PASS+1))
    else
        echo "FAIL N-05 — plan=$NP sched=$SC changes=$CH event=$EV"
        FAIL=$((FAIL+1))
    fi
    $PG -c "DELETE FROM users WHERE id=$U" > /dev/null 2>&1
fi

echo ""
echo "=================================================="
echo "  RESULT: $PASS PASS  /  $FAIL FAIL"
echo "=================================================="
