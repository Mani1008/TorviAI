-- Torvi Second Brain — initial schema (migration 001)
-- Tables: profiles, usage, settings, memory_items, memory_sources
-- See docs/supabase-schema-plan.md

-- ─── Extensions ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Shared functions ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ON CONFLICT: never block auth signup if rows already exist (re-auth, retries)
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    coalesce(NEW.raw_user_meta_data ->> 'name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.usage (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ─── profiles ───────────────────────────────────────────────────────────────

CREATE TABLE public.profiles (
  id                 uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email              text        NOT NULL,
  name               text        NOT NULL DEFAULT '',
  avatar_url         text,
  plan               text        NOT NULL DEFAULT 'starter'
                     CHECK (plan IN ('starter', 'plus', 'pro', 'dev')),
  is_active          boolean     NOT NULL DEFAULT true,
  legacy_appwrite_id text        UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_plan ON public.profiles (plan);
CREATE INDEX idx_profiles_legacy_appwrite_id ON public.profiles (legacy_appwrite_id)
  WHERE legacy_appwrite_id IS NOT NULL;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── usage ──────────────────────────────────────────────────────────────────

CREATE TABLE public.usage (
  user_id                 uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  ai_responses_used       integer     NOT NULL DEFAULT 0 CHECK (ai_responses_used >= 0),
  listening_seconds_used  integer     NOT NULL DEFAULT 0 CHECK (listening_seconds_used >= 0),
  period_start            date        NOT NULL DEFAULT CURRENT_DATE,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_period ON public.usage (period_start);

CREATE TRIGGER usage_updated_at
  BEFORE UPDATE ON public.usage
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── settings ─────────────────────────────────────────────────────────────────

CREATE TABLE public.settings (
  user_id          uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  selected_model   text        NOT NULL DEFAULT 'nvidia/nemotron-3-super-120b-a12b:free',
  response_length  text        NOT NULL DEFAULT 'auto'
                   CHECK (response_length IN ('short', 'medium', 'auto')),
  language         text        NOT NULL DEFAULT 'English',
  system_prompt    text        NOT NULL DEFAULT '',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── memory_items ─────────────────────────────────────────────────────────────

CREATE TABLE public.memory_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT '',
  tags            text[]      NOT NULL DEFAULT '{}',
  content         text        NOT NULL,
  summary         text,
  knowledge_type  text        NOT NULL DEFAULT 'reference'
                  CHECK (knowledge_type IN ('fact', 'procedure', 'decision', 'reference', 'preference', 'event')),
  domain          text        NOT NULL DEFAULT 'generic'
                  CHECK (domain IN ('code', 'meeting', 'email', 'browser', 'people', 'project', 'generic')),
  importance      smallint    NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  created_by      text        NOT NULL DEFAULT 'user'
                  CHECK (created_by IN ('user', 'ai', 'import', 'connector')),
  content_hash    text,
  confirmed_at    timestamptz,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  search_vector   tsvector    GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || content
    )
  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_memory_user_updated ON public.memory_items (user_id, updated_at DESC);
CREATE INDEX idx_memory_user_domain ON public.memory_items (user_id, domain);
CREATE INDEX idx_memory_user_knowledge_type ON public.memory_items (user_id, knowledge_type);
CREATE INDEX idx_memory_user_importance ON public.memory_items (user_id, importance DESC, updated_at DESC);
-- Dedup active memories per user (soft-deleted rows excluded so re-promotion works)
CREATE UNIQUE INDEX idx_memory_user_content_hash_unique ON public.memory_items (user_id, content_hash)
  WHERE content_hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_memory_tags ON public.memory_items USING gin (tags);
CREATE INDEX idx_memory_search ON public.memory_items USING gin (search_vector);
CREATE INDEX idx_memory_deleted_at ON public.memory_items (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TRIGGER memory_items_updated_at
  BEFORE UPDATE ON public.memory_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Composite uniqueness enables FK: memory_sources.user_id must match memory owner
ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_id_user_unique UNIQUE (id, user_id);

-- ─── memory_sources ───────────────────────────────────────────────────────────

CREATE TABLE public.memory_sources (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id     uuid        NOT NULL,
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  source_kind   text        NOT NULL
                CHECK (source_kind IN (
                  'local_chunk', 'screen_capture', 'screenshot', 'chat_excerpt',
                  'meeting', 'browser_tab', 'connector', 'manual'
                )),
  source_ref    text,
  connector     text,
  connector_ref text,
  app_name      text,
  window_title  text,
  content_type  text,
  url           text,
  captured_at   timestamptz,
  excerpt       text,
  metadata      jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memory_sources_memory_user_fk
    FOREIGN KEY (memory_id, user_id)
    REFERENCES public.memory_items (id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_memory_sources_memory_id ON public.memory_sources (memory_id);
CREATE INDEX idx_memory_sources_user_captured ON public.memory_sources (user_id, captured_at DESC);
CREATE INDEX idx_memory_sources_user_kind ON public.memory_sources (user_id, source_kind);
CREATE INDEX idx_memory_sources_connector ON public.memory_sources (user_id, connector, connector_ref)
  WHERE connector IS NOT NULL;
CREATE INDEX idx_memory_sources_local_ref ON public.memory_sources (user_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- ─── Usage RPCs (service-role / SECURITY DEFINER) ───────────────────────────

CREATE OR REPLACE FUNCTION public.initialize_user_usage(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid,
  p_field   text,
  p_delta   integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new integer;
BEGIN
  IF p_delta < 0 THEN
    RAISE EXCEPTION 'delta must be non-negative';
  END IF;

  IF p_field = 'ai_responses_used' THEN
    UPDATE public.usage
    SET ai_responses_used = ai_responses_used + p_delta,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING ai_responses_used INTO v_new;
  ELSIF p_field = 'listening_seconds_used' THEN
    UPDATE public.usage
    SET listening_seconds_used = listening_seconds_used + p_delta,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING listening_seconds_used INTO v_new;
  ELSE
    RAISE EXCEPTION 'unknown usage field: %', p_field;
  END IF;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'usage row not found for user %', p_user_id;
  END IF;

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.push_local_usage(
  p_user_id uuid,
  p_ai_used integer,
  p_listening_used integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.usage
  SET
    ai_responses_used = greatest(ai_responses_used, p_ai_used),
    listening_seconds_used = greatest(listening_seconds_used, p_listening_used),
    updated_at = now()
  WHERE user_id = p_user_id
    AND (
      p_ai_used > ai_responses_used
      OR p_listening_used > listening_seconds_used
    );
END;
$$;

-- Hard-delete soft-deleted memories older than 30 days (schedule via pg_cron or Edge Function)
CREATE OR REPLACE FUNCTION public.purge_deleted_memories()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.memory_items
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '30 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ─── Auth signup hook ─────────────────────────────────────────────────────────

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_sources ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- usage: read-only for users
CREATE POLICY usage_select_own ON public.usage
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- settings
CREATE POLICY settings_select_own ON public.settings
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY settings_insert_own ON public.settings
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY settings_update_own ON public.settings
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY settings_delete_own ON public.settings
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- memory_items
CREATE POLICY memory_items_select_own ON public.memory_items
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id AND deleted_at IS NULL);

CREATE POLICY memory_items_insert_own ON public.memory_items
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY memory_items_update_own ON public.memory_items
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY memory_items_delete_own ON public.memory_items
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- memory_sources
CREATE POLICY memory_sources_select_own ON public.memory_sources
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY memory_sources_insert_own ON public.memory_sources
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY memory_sources_update_own ON public.memory_sources
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY memory_sources_delete_own ON public.memory_sources
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ─── Grants ─────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
-- plan is billing-controlled: only service_role may UPDATE this column
REVOKE UPDATE (plan) ON public.profiles FROM authenticated, anon;
GRANT SELECT ON public.usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_sources TO authenticated;

GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.usage TO service_role;
GRANT ALL ON public.settings TO service_role;
GRANT ALL ON public.memory_items TO service_role;
GRANT ALL ON public.memory_sources TO service_role;

GRANT EXECUTE ON FUNCTION public.initialize_user_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_local_usage(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_deleted_memories() TO service_role;
