-- Fase 7: materialized view for intelligence dashboard performance
-- No Prisma-tracked schema changes — only the view and its unique index.

CREATE MATERIALIZED VIEW IF NOT EXISTS research_vertical_stats AS
SELECT
  v.slug          AS vertical_slug,
  v.name          AS vertical_name,
  COUNT(DISTINCT t.id)  AS target_count,
  COUNT(DISTINCT a.id)  AS analysis_count,
  COUNT(DISTINCT a.id) FILTER (WHERE ps.level = 'L1_SURFACE')      AS l1_count,
  COUNT(DISTINCT a.id) FILTER (WHERE ps.level = 'L2_CAPABILITIES') AS l2_count,
  COUNT(DISTINCT a.id) FILTER (WHERE ps.level = 'L3_ARCHITECTURE') AS l3_count,
  COUNT(DISTINCT a.id) FILTER (WHERE ps.level = 'L4_ADVERSARIAL')  AS l4_count,
  AVG(a.score_total)    AS avg_score
FROM research_verticals v
LEFT JOIN research_targets   t  ON t.vertical_slug = v.slug AND t.dsar_deleted_at IS NULL
LEFT JOIN research_sessions  s  ON s.target_id = t.id AND s.status = 'completed'
LEFT JOIN research_analyses  a  ON a.session_id = s.id
LEFT JOIN probe_scripts      ps ON ps.id = s.script_id
GROUP BY v.slug, v.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_vertical_stats_slug
  ON research_vertical_stats(vertical_slug);
