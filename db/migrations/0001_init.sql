-- Bulkskart AI platform: initial schema.
-- Conventions: uuid primary keys, timestamptz audit columns, CHECK constraints for enumerations.
-- Secrets are never stored here. Integration rows hold display metadata only.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 20 AND 400),
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'researcher', 'marketing', 'viewer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
  state text NOT NULL CHECK (length(state) BETWEEN 2 AND 80),
  city text CHECK (city IS NULL OR length(city) BETWEEN 1 AND 80),
  requested_limit integer NOT NULL CHECK (requested_limit BETWEEN 1 AND 20),
  provider text NOT NULL CHECK (provider IN ('mock', 'google_places')),
  provider_mode text NOT NULL CHECK (provider_mode IN ('mock', 'real')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  discovered_count integer NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  inserted_count integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  needs_review_count integer NOT NULL DEFAULT 0 CHECK (needs_review_count >= 0),
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 500),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  CHECK (inserted_count + skipped_count <= discovered_count OR status <> 'completed')
);
CREATE INDEX research_jobs_created_idx ON research_jobs (created_at DESC);
CREATE INDEX research_jobs_requested_by_idx ON research_jobs (requested_by, created_at DESC);
CREATE INDEX research_jobs_status_idx ON research_jobs (status, started_at);

CREATE TABLE manufacturer_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL CHECK (length(company_name) BETWEEN 2 AND 200),
  normalized_company_name text NOT NULL CHECK (length(normalized_company_name) BETWEEN 1 AND 200),
  product_category text NOT NULL CHECK (length(product_category) BETWEEN 1 AND 80),
  state text NOT NULL CHECK (length(state) BETWEEN 2 AND 80),
  city text CHECK (city IS NULL OR length(city) BETWEEN 1 AND 80),
  normalized_city text NOT NULL DEFAULT '' CHECK (length(normalized_city) <= 80),
  business_phone text CHECK (business_phone IS NULL OR length(business_phone) <= 40),
  normalized_phone text CHECK (normalized_phone IS NULL OR normalized_phone ~ '^\+91[6-9][0-9]{9}$'),
  source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 120),
  source_url text NOT NULL CHECK (source_url ~ '^https://' AND length(source_url) <= 2048),
  normalized_source_url text NOT NULL CHECK (normalized_source_url ~ '^https://' AND length(normalized_source_url) <= 2048),
  evidence_summary text CHECK (evidence_summary IS NULL OR length(evidence_summary) <= 2000),
  verification_status text NOT NULL CHECK (verification_status IN ('unverified', 'needs_review', 'verified', 'synthetic')),
  lead_status text NOT NULL CHECK (lead_status IN (
    'discovered', 'needs_review', 'verified', 'contact_ready', 'outreach_approved', 'contacted', 'replied',
    'interested', 'registration_started', 'registered', 'subscription_active', 'not_interested', 'opted_out', 'archived'
  )),
  is_synthetic boolean NOT NULL DEFAULT false,
  research_query text NOT NULL CHECK (length(research_query) <= 500),
  research_job_id uuid REFERENCES research_jobs (id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  possible_duplicate_of uuid REFERENCES manufacturer_leads (id) ON DELETE SET NULL,
  duplicate_reason text CHECK (duplicate_reason IS NULL OR length(duplicate_reason) <= 300),
  assigned_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  follow_up_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((verification_status = 'synthetic') = is_synthetic),
  CHECK (verification_status <> 'verified' OR last_verified_at IS NOT NULL),
  CHECK (possible_duplicate_of IS NULL OR possible_duplicate_of <> id)
);
-- Conservative exact-duplicate key: same business name, state, city and category.
CREATE UNIQUE INDEX manufacturer_leads_exact_key
  ON manufacturer_leads (normalized_company_name, state, normalized_city, product_category);
CREATE INDEX manufacturer_leads_phone_idx ON manufacturer_leads (normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX manufacturer_leads_name_state_idx ON manufacturer_leads (state, normalized_company_name);
CREATE INDEX manufacturer_leads_source_idx ON manufacturer_leads (normalized_source_url);
CREATE INDEX manufacturer_leads_filter_idx ON manufacturer_leads (product_category, state, lead_status, verification_status);
CREATE INDEX manufacturer_leads_created_idx ON manufacturer_leads (created_at DESC);
CREATE INDEX manufacturer_leads_job_idx ON manufacturer_leads (research_job_id);
CREATE INDEX manufacturer_leads_assigned_idx ON manufacturer_leads (assigned_user_id);

CREATE TABLE lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES manufacturer_leads (id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_notes_lead_idx ON lead_notes (lead_id, created_at DESC);

CREATE TABLE agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL CHECK (agent_name IN ('SCOUT', 'CLERK', 'PEN', 'LEDGER', 'FOREMAN')),
  task_type text NOT NULL CHECK (length(task_type) BETWEEN 1 AND 80),
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  output_json jsonb,
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 500),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_tasks_status_idx ON agent_tasks (status, created_at);

CREATE TABLE outreach_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES manufacturer_leads (id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'call_script')),
  language text NOT NULL CHECK (language IN ('en', 'ta', 'hi', 'te', 'ml')),
  subject text CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 200),
  message_body text NOT NULL CHECK (length(message_body) BETWEEN 1 AND 3000),
  generation_mode text NOT NULL CHECK (generation_mode IN ('template', 'ai')),
  approval_status text NOT NULL CHECK (approval_status IN ('draft', 'pending_review', 'approved', 'rejected', 'cancelled')),
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  approved_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Separation of duties: the approver can never be the author of the draft.
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (approval_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (approval_status <> 'rejected' OR decision_note IS NOT NULL)
);
CREATE INDEX outreach_drafts_status_idx ON outreach_drafts (approval_status, created_at DESC);
CREATE INDEX outreach_drafts_lead_idx ON outreach_drafts (lead_id, created_at DESC);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 60),
  entity_id text CHECK (entity_id IS NULL OR length(entity_id) <= 100),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);

-- Display metadata only. Availability is derived from server-side environment variables at runtime.
CREATE TABLE integrations (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('research', 'ai', 'messaging', 'email', 'telephony')),
  description text NOT NULL CHECK (length(description) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO integrations (key, display_name, category, description) VALUES
  ('mock_research', 'Mock research (synthetic data)', 'research',
   'Generates clearly labelled synthetic records for development and UI testing. These are never real manufacturers.'),
  ('google_places', 'Google Places API (text search)', 'research',
   'Official Places API text search. Requires GOOGLE_PLACES_API_KEY and a billing-enabled Google Cloud project. Review Google Maps Platform terms on storing Places data before enabling.'),
  ('anthropic', 'Anthropic Messages API', 'ai',
   'Optional AI text generation for outreach drafts. Requires ANTHROPIC_API_KEY. Without it, labelled template drafts are used.'),
  ('whatsapp_business', 'WhatsApp Business Platform', 'messaging',
   'Not implemented. Needs official Meta WhatsApp Business Platform onboarding, approved message templates and recorded opt-ins.'),
  ('email_provider', 'Email delivery provider', 'email',
   'Not implemented. Needs a provider account, domain authentication (SPF, DKIM, DMARC) and recorded consent.');
