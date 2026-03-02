-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 002_pgvector_embeddings.sql
-- Purpose:   Add vector embeddings for semantic search & lead similarity
-- Requires:  Supabase pgvector extension (available on all Supabase projects)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- Add embedding columns to existing tables
-- Using text-embedding-3-small (1536 dimensions, OpenAI) or
-- voyage-3 (1024 dimensions, Anthropic recommended)
-- ─────────────────────────────────────────────────────────────────────────────

-- Embedding on call summaries (1536 dim = OpenAI text-embedding-3-small)
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS summary_embedding vector(1536);

-- Embedding on lead profiles (for lead similarity matching)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS profile_embedding vector(1536);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: objection_embeddings
-- Stores embeddings of objections for semantic clustering
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS objection_embeddings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  call_id      UUID REFERENCES calls(id) ON DELETE CASCADE,
  raw_text     TEXT NOT NULL,               -- original objection text
  category     TEXT,                        -- cluster label (after clustering)
  embedding    vector(1536),

  -- Metadata
  phase        TEXT,
  was_handled  BOOLEAN DEFAULT false,
  lead_grade   CHAR(1)
);

CREATE INDEX idx_objections_embedding ON objection_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: product_knowledge
-- RAG knowledge base: TalentFlow product docs, FAQs, case studies
-- The agent can retrieve relevant chunks at runtime for accurate answers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_knowledge (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  title        TEXT NOT NULL,
  content      TEXT NOT NULL,              -- chunk text (500-1000 chars recommended)
  source       TEXT,                       -- e.g. 'case_study', 'faq', 'pricing', 'feature'
  embedding    vector(1536),

  -- Metadata for filtering
  category     TEXT,
  is_active    BOOLEAN DEFAULT true
);

-- IVFFlat index for fast approximate nearest-neighbor search
-- Rebuild with CREATE INDEX if adding more than 10k rows
CREATE INDEX idx_knowledge_embedding ON product_knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: match_similar_leads
-- Find leads similar to a given embedding (for account-based insights)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_similar_leads(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.78,
  match_count     INT DEFAULT 5
)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  company      TEXT,
  lead_grade   CHAR(1),
  lead_score   SMALLINT,
  similarity   FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    name,
    company,
    lead_grade,
    lead_score,
    1 - (profile_embedding <=> query_embedding) AS similarity
  FROM leads
  WHERE profile_embedding IS NOT NULL
    AND 1 - (profile_embedding <=> query_embedding) > match_threshold
  ORDER BY profile_embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: match_product_knowledge
-- RAG retrieval: find relevant product knowledge chunks for a query
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_product_knowledge(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.75,
  match_count     INT DEFAULT 3
)
RETURNS TABLE (
  id         UUID,
  title      TEXT,
  content    TEXT,
  source     TEXT,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    title,
    content,
    source,
    1 - (embedding <=> query_embedding) AS similarity
  FROM product_knowledge
  WHERE is_active = true
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: match_similar_objections
-- Semantic objection clustering: find semantically similar objections
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_similar_objections(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.80,
  match_count     INT DEFAULT 10
)
RETURNS TABLE (
  id          UUID,
  raw_text    TEXT,
  category    TEXT,
  was_handled BOOLEAN,
  similarity  FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    raw_text,
    category,
    was_handled,
    1 - (embedding <=> query_embedding) AS similarity
  FROM objection_embeddings
  WHERE embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Initial product knowledge chunks (TalentFlow RAG base)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO product_knowledge (title, content, source, category) VALUES
(
  'TalentFlow Pricing – Starter Plan',
  'TalentFlow Starter kostet 499 EUR pro Monat und umfasst bis zu 10 aktive Stellenanzeigen, KI-gestützte Bewerbervorauswahl, Integration mit Personio und bis zu 3 HR-Nutzer. Jährliche Zahlung spart 15%.',
  'pricing',
  'pricing'
),
(
  'TalentFlow Pricing – Growth Plan',
  'TalentFlow Growth kostet 999 EUR pro Monat für bis zu 30 aktive Stellen, erweiterte Analytics, API-Zugriff und Slack-Integration. Ideal für mittelständische Unternehmen mit regelmäßigem Recruiting.',
  'pricing',
  'pricing'
),
(
  'TalentFlow Case Study – Müller Logistik GmbH',
  'Müller Logistik GmbH (180 Mitarbeiter) reduzierte mit TalentFlow die Time-to-Hire von 45 auf 18 Tage (−60%). Das HR-Team sparte 20 Stunden pro Woche bei der Bewerbervorauswahl. Innerhalb von 6 Wochen war der ROI positiv.',
  'case_study',
  'social_proof'
),
(
  'TalentFlow DSGVO & Datenschutz',
  'TalentFlow ist vollständig DSGVO-konform. Alle Daten werden ausschließlich auf EU-Servern (Frankfurt, AWS) gespeichert. Das System ist ISO 27001 zertifiziert. Bewerberdaten werden nach Ablauf der Aufbewahrungsfrist automatisch gelöscht.',
  'compliance',
  'objection_handling'
),
(
  'TalentFlow Integrationen',
  'TalentFlow integriert sich nahtlos in alle führenden ATS-Systeme: Personio, Workday, SAP SuccessFactors, d.vinci und Softgarden. Die Integration dauert typischerweise 1-2 Werktage über API oder direkte Konnektoren.',
  'integrations',
  'feature'
),
(
  'TalentFlow Setup & Onboarding',
  'Der Onboarding-Prozess bei TalentFlow dauert durchschnittlich 3 Werktage. Ein dedizierter Customer Success Manager begleitet die Einrichtung. Es gibt keine versteckten Setup-Kosten. Mitarbeiterschulungen werden kostenlos als Webinar angeboten.',
  'onboarding',
  'objection_handling'
);

-- RLS Policies for new tables
ALTER TABLE objection_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_knowledge     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON objection_embeddings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON product_knowledge     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_read" ON objection_embeddings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON product_knowledge     FOR SELECT TO anon USING (true);
