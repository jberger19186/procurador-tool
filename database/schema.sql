--
-- PostgreSQL database dump
--

\restrict WUp7My2XYfGOikshQlXF6rd4T0iCn5eZeaG5g7IHMiKLpXFmwLtRwJFjeSylskF

-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: procurador_user
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO procurador_user;

--
-- Name: update_users_updated_at(); Type: FUNCTION; Schema: public; Owner: procurador_user
--

CREATE FUNCTION public.update_users_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_users_updated_at() OWNER TO procurador_user;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: active_executions; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.active_executions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    machine_id character varying(255) NOT NULL,
    script_name character varying(100),
    started_at timestamp with time zone DEFAULT now(),
    last_heartbeat timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval)
);


ALTER TABLE public.active_executions OWNER TO procurador_user;

--
-- Name: active_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.active_executions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.active_executions_id_seq OWNER TO procurador_user;

--
-- Name: active_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.active_executions_id_seq OWNED BY public.active_executions.id;


--
-- Name: encrypted_scripts; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.encrypted_scripts (
    id integer NOT NULL,
    script_name character varying(255) NOT NULL,
    encrypted_content text NOT NULL,
    iv character varying(32) NOT NULL,
    hash character varying(64) NOT NULL,
    version character varying(20) DEFAULT '1.0.0'::character varying,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.encrypted_scripts OWNER TO procurador_user;

--
-- Name: TABLE encrypted_scripts; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON TABLE public.encrypted_scripts IS 'Scripts encriptados con AES-256';


--
-- Name: COLUMN encrypted_scripts.iv; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON COLUMN public.encrypted_scripts.iv IS 'Vector de inicialización para AES-256-CBC';


--
-- Name: COLUMN encrypted_scripts.hash; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON COLUMN public.encrypted_scripts.hash IS 'SHA-256 hash del código para verificación de integridad';


--
-- Name: encrypted_scripts_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.encrypted_scripts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.encrypted_scripts_id_seq OWNER TO procurador_user;

--
-- Name: encrypted_scripts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.encrypted_scripts_id_seq OWNED BY public.encrypted_scripts.id;


--
-- Name: monitor_consultas_log; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.monitor_consultas_log (
    id integer NOT NULL,
    parte_id integer,
    user_id integer,
    modo character varying(20),
    fecha_ejecucion timestamp without time zone DEFAULT now(),
    total_encontrados integer DEFAULT 0,
    nuevos_detectados integer DEFAULT 0,
    tiempo_ejecucion_ms integer,
    error text
);


ALTER TABLE public.monitor_consultas_log OWNER TO procurador_user;

--
-- Name: monitor_consultas_log_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.monitor_consultas_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.monitor_consultas_log_id_seq OWNER TO procurador_user;

--
-- Name: monitor_consultas_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.monitor_consultas_log_id_seq OWNED BY public.monitor_consultas_log.id;


--
-- Name: monitor_expedientes; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.monitor_expedientes (
    id integer NOT NULL,
    parte_id integer,
    numero_expediente character varying(255) NOT NULL,
    caratula text,
    dependencia text,
    situacion character varying(255),
    ultima_actuacion character varying(50),
    es_linea_base boolean DEFAULT false,
    fecha_primera_deteccion timestamp without time zone DEFAULT now(),
    fecha_confirmacion timestamp without time zone,
    confirmado boolean DEFAULT false,
    metadata_json jsonb
);


ALTER TABLE public.monitor_expedientes OWNER TO procurador_user;

--
-- Name: monitor_expedientes_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.monitor_expedientes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.monitor_expedientes_id_seq OWNER TO procurador_user;

--
-- Name: monitor_expedientes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.monitor_expedientes_id_seq OWNED BY public.monitor_expedientes.id;


--
-- Name: monitor_partes; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.monitor_partes (
    id integer NOT NULL,
    user_id integer,
    nombre_parte character varying(255) NOT NULL,
    jurisdiccion_codigo character varying(5) NOT NULL,
    jurisdiccion_sigla character varying(10) NOT NULL,
    tiene_linea_base boolean DEFAULT false,
    activo boolean DEFAULT true,
    fecha_creacion timestamp without time zone DEFAULT now(),
    fecha_ultima_modificacion timestamp without time zone DEFAULT now(),
    fecha_proxima_modificacion timestamp without time zone
);


ALTER TABLE public.monitor_partes OWNER TO procurador_user;

--
-- Name: monitor_partes_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.monitor_partes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.monitor_partes_id_seq OWNER TO procurador_user;

--
-- Name: monitor_partes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.monitor_partes_id_seq OWNED BY public.monitor_partes.id;


--
-- Name: plans; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.plans (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    proc_executions_limit integer DEFAULT 50,
    proc_expedientes_limit integer DEFAULT '-1'::integer,
    informe_limit integer DEFAULT 10,
    monitor_partes_limit integer DEFAULT 3,
    monitor_novedades_limit integer DEFAULT 10,
    period_days integer DEFAULT 30,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    batch_executions_limit integer DEFAULT 20,
    batch_expedientes_limit integer DEFAULT 10,
    extension_flows jsonb DEFAULT '[]'::jsonb,
    price_usd numeric(10,2),
    price_ars numeric(12,2),
    plan_type character varying(20) DEFAULT 'electron'::character varying,
    promo_type character varying(10) DEFAULT NULL::character varying,
    promo_end_date timestamp without time zone,
    promo_max_users integer,
    promo_used_count integer DEFAULT 0,
    promo_alert_days integer DEFAULT 15,
    CONSTRAINT plans_plan_type_check CHECK (((plan_type)::text = ANY ((ARRAY['electron'::character varying, 'extension'::character varying, 'combo'::character varying])::text[]))),
    CONSTRAINT plans_promo_type_check CHECK (((promo_type)::text = ANY ((ARRAY['date'::character varying, 'quota'::character varying])::text[])))
);


ALTER TABLE public.plans OWNER TO procurador_user;

--
-- Name: plans_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.plans_id_seq OWNER TO procurador_user;

--
-- Name: plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.plans_id_seq OWNED BY public.plans.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    user_id integer,
    plan character varying(50) NOT NULL,
    status character varying(50) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    usage_count integer DEFAULT 0,
    usage_limit integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    plan_id integer,
    period_start timestamp without time zone DEFAULT now(),
    proc_usage integer DEFAULT 0,
    informe_usage integer DEFAULT 0,
    monitor_novedades_usage integer DEFAULT 0,
    proc_bonus integer DEFAULT 0,
    informe_bonus integer DEFAULT 0,
    monitor_novedades_bonus integer DEFAULT 0,
    monitor_partes_bonus integer DEFAULT 0,
    batch_usage integer DEFAULT 0,
    batch_bonus integer DEFAULT 0,
    CONSTRAINT check_plan_valid CHECK (((plan)::text = ANY ((ARRAY['BASIC'::character varying, 'PRO'::character varying, 'ENTERPRISE'::character varying, 'EXTENSION_PROMO'::character varying, 'COMBO_PROMO'::character varying])::text[]))),
    CONSTRAINT check_status_valid CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'cancelled'::character varying, 'expired'::character varying, 'suspended'::character varying])::text[]))),
    CONSTRAINT check_usage_count_positive CHECK ((usage_count >= 0)),
    CONSTRAINT check_usage_limit_positive CHECK ((usage_limit > 0))
);


ALTER TABLE public.subscriptions OWNER TO procurador_user;

--
-- Name: TABLE subscriptions; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON TABLE public.subscriptions IS 'Suscripciones y límites de uso por usuario';


--
-- Name: COLUMN subscriptions.usage_count; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON COLUMN public.subscriptions.usage_count IS 'Contador de ejecuciones en el periodo actual';


--
-- Name: COLUMN subscriptions.usage_limit; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON COLUMN public.subscriptions.usage_limit IS 'Límite de ejecuciones según el plan';


--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.subscriptions_id_seq OWNER TO procurador_user;

--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.support_tickets (
    id integer NOT NULL,
    user_id integer,
    category character varying(20) NOT NULL,
    title character varying(200) NOT NULL,
    description text NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    benefit_type character varying(30),
    benefit_value numeric(10,2),
    benefit_applied boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone,
    CONSTRAINT support_tickets_category_check CHECK (((category)::text = ANY ((ARRAY['technical'::character varying, 'billing'::character varying, 'commercial'::character varying])::text[]))),
    CONSTRAINT support_tickets_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT support_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[])))
);


ALTER TABLE public.support_tickets OWNER TO procurador_user;

--
-- Name: support_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.support_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.support_tickets_id_seq OWNER TO procurador_user;

--
-- Name: support_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.support_tickets_id_seq OWNED BY public.support_tickets.id;


--
-- Name: ticket_comments; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.ticket_comments (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    author_id integer NOT NULL,
    author_role character varying(10) NOT NULL,
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT ticket_comments_author_role_check CHECK (((author_role)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[])))
);


ALTER TABLE public.ticket_comments OWNER TO procurador_user;

--
-- Name: ticket_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.ticket_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.ticket_comments_id_seq OWNER TO procurador_user;

--
-- Name: ticket_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.ticket_comments_id_seq OWNED BY public.ticket_comments.id;


--
-- Name: token_blacklist; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.token_blacklist (
    token_hash character varying(64) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.token_blacklist OWNER TO procurador_user;

--
-- Name: usage_adjustments; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.usage_adjustments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    admin_email character varying(255),
    subsystem character varying(30) NOT NULL,
    amount integer NOT NULL,
    reason text,
    ticket_id integer,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT usage_adjustments_subsystem_check CHECK (((subsystem)::text = ANY (ARRAY[('proc'::character varying)::text, ('batch'::character varying)::text, ('informe'::character varying)::text, ('monitor_novedades'::character varying)::text, ('monitor_partes'::character varying)::text])))
);


ALTER TABLE public.usage_adjustments OWNER TO procurador_user;

--
-- Name: usage_adjustments_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.usage_adjustments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.usage_adjustments_id_seq OWNER TO procurador_user;

--
-- Name: usage_adjustments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.usage_adjustments_id_seq OWNED BY public.usage_adjustments.id;


--
-- Name: usage_logs; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.usage_logs (
    id integer NOT NULL,
    user_id integer,
    script_name character varying(100),
    execution_date timestamp without time zone DEFAULT now(),
    success boolean,
    error_message text
);


ALTER TABLE public.usage_logs OWNER TO procurador_user;

--
-- Name: TABLE usage_logs; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON TABLE public.usage_logs IS 'Registro de ejecuciones de scripts';


--
-- Name: usage_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.usage_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.usage_logs_id_seq OWNER TO procurador_user;

--
-- Name: usage_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.usage_logs_id_seq OWNED BY public.usage_logs.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    machine_id character varying(255),
    role character varying(50) DEFAULT 'user'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    last_login timestamp without time zone,
    cuit character varying(20),
    nombre character varying(100),
    apellido character varying(100),
    domicilio jsonb,
    registration_status character varying(20) DEFAULT 'active'::character varying,
    toc_accepted_at timestamp without time zone,
    email_verified boolean DEFAULT false,
    email_verify_token character varying(64),
    email_verify_expires timestamp without time zone,
    password_reset_token character varying(128),
    password_reset_expires timestamp without time zone,
    CONSTRAINT check_role_valid CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[]))),
    CONSTRAINT users_registration_status_check CHECK (((registration_status)::text = ANY ((ARRAY['pending_email'::character varying, 'pending_activation'::character varying, 'active'::character varying, 'trial'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO procurador_user;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: procurador_user
--

CREATE TABLE IF NOT EXISTS public.app_settings (
    key         character varying(100) NOT NULL,
    value       text                   NOT NULL,
    updated_at  timestamp with time zone NOT NULL DEFAULT NOW(),
    CONSTRAINT app_settings_pkey PRIMARY KEY (key)
);

ALTER TABLE public.app_settings OWNER TO procurador_user;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON TABLE public.users IS 'Usuarios del sistema con autenticación y hardware binding';


--
-- Name: COLUMN users.machine_id; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON COLUMN public.users.machine_id IS 'ID único del dispositivo para hardware binding';


--
-- Name: COLUMN users.last_login; Type: COMMENT; Schema: public; Owner: procurador_user
--

COMMENT ON COLUMN public.users.last_login IS 'Timestamp del último login exitoso';


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: procurador_user
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO procurador_user;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: procurador_user
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: active_executions id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.active_executions ALTER COLUMN id SET DEFAULT nextval('public.active_executions_id_seq'::regclass);


--
-- Name: encrypted_scripts id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.encrypted_scripts ALTER COLUMN id SET DEFAULT nextval('public.encrypted_scripts_id_seq'::regclass);


--
-- Name: monitor_consultas_log id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_consultas_log ALTER COLUMN id SET DEFAULT nextval('public.monitor_consultas_log_id_seq'::regclass);


--
-- Name: monitor_expedientes id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_expedientes ALTER COLUMN id SET DEFAULT nextval('public.monitor_expedientes_id_seq'::regclass);


--
-- Name: monitor_partes id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_partes ALTER COLUMN id SET DEFAULT nextval('public.monitor_partes_id_seq'::regclass);


--
-- Name: plans id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.plans ALTER COLUMN id SET DEFAULT nextval('public.plans_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: support_tickets id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.support_tickets ALTER COLUMN id SET DEFAULT nextval('public.support_tickets_id_seq'::regclass);


--
-- Name: ticket_comments id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.ticket_comments ALTER COLUMN id SET DEFAULT nextval('public.ticket_comments_id_seq'::regclass);


--
-- Name: usage_adjustments id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.usage_adjustments ALTER COLUMN id SET DEFAULT nextval('public.usage_adjustments_id_seq'::regclass);


--
-- Name: usage_logs id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.usage_logs ALTER COLUMN id SET DEFAULT nextval('public.usage_logs_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: active_executions active_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.active_executions
    ADD CONSTRAINT active_executions_pkey PRIMARY KEY (id);


--
-- Name: encrypted_scripts encrypted_scripts_name_key; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.encrypted_scripts
    ADD CONSTRAINT encrypted_scripts_name_key UNIQUE (script_name);


--
-- Name: encrypted_scripts encrypted_scripts_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.encrypted_scripts
    ADD CONSTRAINT encrypted_scripts_pkey PRIMARY KEY (id);


--
-- Name: encrypted_scripts encrypted_scripts_script_name_key; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.encrypted_scripts
    ADD CONSTRAINT encrypted_scripts_script_name_key UNIQUE (script_name);


--
-- Name: monitor_consultas_log monitor_consultas_log_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_consultas_log
    ADD CONSTRAINT monitor_consultas_log_pkey PRIMARY KEY (id);


--
-- Name: monitor_expedientes monitor_expedientes_parte_id_numero_expediente_key; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_expedientes
    ADD CONSTRAINT monitor_expedientes_parte_id_numero_expediente_key UNIQUE (parte_id, numero_expediente);


--
-- Name: monitor_expedientes monitor_expedientes_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_expedientes
    ADD CONSTRAINT monitor_expedientes_pkey PRIMARY KEY (id);


--
-- Name: monitor_partes monitor_partes_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_partes
    ADD CONSTRAINT monitor_partes_pkey PRIMARY KEY (id);


--
-- Name: monitor_partes monitor_partes_user_id_nombre_parte_jurisdiccion_codigo_key; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_partes
    ADD CONSTRAINT monitor_partes_user_id_nombre_parte_jurisdiccion_codigo_key UNIQUE (user_id, nombre_parte, jurisdiccion_codigo);


--
-- Name: plans plans_name_key; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_name_key UNIQUE (name);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: ticket_comments ticket_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_pkey PRIMARY KEY (id);


--
-- Name: token_blacklist token_blacklist_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.token_blacklist
    ADD CONSTRAINT token_blacklist_pkey PRIMARY KEY (token_hash);


--
-- Name: usage_adjustments usage_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.usage_adjustments
    ADD CONSTRAINT usage_adjustments_pkey PRIMARY KEY (id);


--
-- Name: usage_logs usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_active_executions_expires; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_active_executions_expires ON public.active_executions USING btree (expires_at);


--
-- Name: idx_active_executions_user; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE UNIQUE INDEX idx_active_executions_user ON public.active_executions USING btree (user_id);


--
-- Name: idx_adj_subsystem; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_adj_subsystem ON public.usage_adjustments USING btree (subsystem);


--
-- Name: idx_adj_user; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_adj_user ON public.usage_adjustments USING btree (user_id);


--
-- Name: idx_comments_ticket; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_comments_ticket ON public.ticket_comments USING btree (ticket_id);


--
-- Name: idx_monitor_exp_confirmado; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_monitor_exp_confirmado ON public.monitor_expedientes USING btree (parte_id, confirmado);


--
-- Name: idx_monitor_exp_parte; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_monitor_exp_parte ON public.monitor_expedientes USING btree (parte_id);


--
-- Name: idx_monitor_log_parte; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_monitor_log_parte ON public.monitor_consultas_log USING btree (parte_id);


--
-- Name: idx_monitor_log_user; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_monitor_log_user ON public.monitor_consultas_log USING btree (user_id);


--
-- Name: idx_monitor_partes_activo; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_monitor_partes_activo ON public.monitor_partes USING btree (user_id, activo);


--
-- Name: idx_monitor_partes_user; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_monitor_partes_user ON public.monitor_partes USING btree (user_id);


--
-- Name: idx_plans_active; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_plans_active ON public.plans USING btree (active);


--
-- Name: idx_plans_extension_flows; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_plans_extension_flows ON public.plans USING gin (extension_flows);


--
-- Name: idx_plans_name; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_plans_name ON public.plans USING btree (name);


--
-- Name: idx_script_active; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_script_active ON public.encrypted_scripts USING btree (active);


--
-- Name: idx_script_name; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_script_name ON public.encrypted_scripts USING btree (script_name);


--
-- Name: idx_subscription_status; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_subscription_status ON public.subscriptions USING btree (status);


--
-- Name: idx_subscription_user; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_subscription_user ON public.subscriptions USING btree (user_id);


--
-- Name: idx_tickets_category; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_tickets_category ON public.support_tickets USING btree (category);


--
-- Name: idx_tickets_priority; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_tickets_priority ON public.support_tickets USING btree (priority);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_tickets_user; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_tickets_user ON public.support_tickets USING btree (user_id);


--
-- Name: idx_token_blacklist_expires; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_token_blacklist_expires ON public.token_blacklist USING btree (expires_at);


--
-- Name: idx_usage_date; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_usage_date ON public.usage_logs USING btree (execution_date);


--
-- Name: idx_usage_script; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_usage_script ON public.usage_logs USING btree (script_name);


--
-- Name: idx_usage_user; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_usage_user ON public.usage_logs USING btree (user_id);


--
-- Name: idx_user_email; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_user_email ON public.users USING btree (email);


--
-- Name: idx_user_machine_id; Type: INDEX; Schema: public; Owner: procurador_user
--

CREATE INDEX idx_user_machine_id ON public.users USING btree (machine_id);


--
-- Name: encrypted_scripts update_encrypted_scripts_updated_at; Type: TRIGGER; Schema: public; Owner: procurador_user
--

CREATE TRIGGER update_encrypted_scripts_updated_at BEFORE UPDATE ON public.encrypted_scripts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: plans update_plans_updated_at; Type: TRIGGER; Schema: public; Owner: procurador_user
--

CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: subscriptions update_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: procurador_user
--

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: support_tickets update_support_tickets_updated_at; Type: TRIGGER; Schema: public; Owner: procurador_user
--

CREATE TRIGGER update_support_tickets_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: procurador_user
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: procurador_user
--

CREATE TRIGGER update_users_updated_at_trigger BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_users_updated_at();


--
-- Name: active_executions active_executions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.active_executions
    ADD CONSTRAINT active_executions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: monitor_consultas_log monitor_consultas_log_parte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_consultas_log
    ADD CONSTRAINT monitor_consultas_log_parte_id_fkey FOREIGN KEY (parte_id) REFERENCES public.monitor_partes(id) ON DELETE SET NULL;


--
-- Name: monitor_consultas_log monitor_consultas_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_consultas_log
    ADD CONSTRAINT monitor_consultas_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: monitor_expedientes monitor_expedientes_parte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_expedientes
    ADD CONSTRAINT monitor_expedientes_parte_id_fkey FOREIGN KEY (parte_id) REFERENCES public.monitor_partes(id) ON DELETE CASCADE;


--
-- Name: monitor_partes monitor_partes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.monitor_partes
    ADD CONSTRAINT monitor_partes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ticket_comments ticket_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: ticket_comments ticket_comments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: usage_adjustments usage_adjustments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.usage_adjustments
    ADD CONSTRAINT usage_adjustments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id);


--
-- Name: usage_adjustments usage_adjustments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.usage_adjustments
    ADD CONSTRAINT usage_adjustments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: usage_logs usage_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: procurador_user
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict WUp7My2XYfGOikshQlXF6rd4T0iCn5eZeaG5g7IHMiKLpXFmwLtRwJFjeSylskF

