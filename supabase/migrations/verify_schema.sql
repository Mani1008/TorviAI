-- Run in Supabase SQL Editor to verify migration 001 is applied.
-- Expected: 5 tables, RLS enabled, memory_items has search_vector.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'usage', 'settings', 'memory_items', 'memory_sources')
ORDER BY table_name;

-- Should return 5 rows. If memory_items or memory_sources is missing, run:
--   supabase/migrations/001_initial_schema.sql

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('memory_items', 'memory_sources');

-- rowsecurity should be true for both.

SELECT COUNT(*) AS memory_item_count FROM public.memory_items;
SELECT COUNT(*) AS memory_source_count FROM public.memory_sources;
