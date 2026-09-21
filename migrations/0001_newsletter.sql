-- Newsletter storage. KV keeps the notes; everything about readers lives here.
-- Addresses appear in exactly one place (subscribers.email). Events and the
-- suppression list carry only an HMAC of the address.

CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,      -- replaced by 'deleted:<email_hash>' on unsubscribe
  email_hash TEXT NOT NULL,                       -- HMAC-SHA256(TOKEN_HMAC_SECRET, 'hash:' + lowercased email), base64url
  tz TEXT,                                        -- IANA zone; NULL once unsubscribed
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  edition TEXT NOT NULL CHECK (edition IN ('today', 'tomorrow')),
  hold_shabbat INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active', 'unsubscribed', 'bounced', 'complained')),
  unsub_token TEXT NOT NULL UNIQUE,               -- 48 lowercase hex chars (the router lower-cases paths)
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsubscribed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'active' OR tz IS NOT NULL)
);
CREATE INDEX subscribers_status_tz ON subscribers (status, tz);
CREATE INDEX subscribers_email_hash ON subscribers (email_hash);

-- One row per subscriber per edition date: the idempotency ledger for sends.
CREATE TABLE deliveries (
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
  edition_date TEXT NOT NULL,                     -- civil date of the daf that was (or will be) sent
  variant TEXT NOT NULL,                          -- full | nonote
  status TEXT NOT NULL CHECK (status IN ('reserved', 'sent', 'failed', 'held')),
  attempts INTEGER NOT NULL DEFAULT 0,
  batch_key TEXT,                                 -- provider idempotency key of the chunk this row went out in
  provider_id TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subscriber_id, edition_date)
);
CREATE INDEX deliveries_status ON deliveries (status, edition_date);
CREATE INDEX deliveries_batch ON deliveries (batch_key);

-- The issue as rendered once per (edition date, variant); what every reader got, verbatim.
CREATE TABLE editions (
  edition_date TEXT NOT NULL,
  variant TEXT NOT NULL,
  slug TEXT NOT NULL,
  daf INTEGER NOT NULL,
  note_present INTEGER NOT NULL,
  subject TEXT NOT NULL,
  preheader TEXT NOT NULL,
  html TEXT NOT NULL,                             -- with __UNSUB__ / __PREFS__ / __HELD__ placeholders
  text TEXT NOT NULL,
  rendered_at TEXT NOT NULL,
  PRIMARY KEY (edition_date, variant)
);

CREATE TABLE send_runs (
  tick TEXT PRIMARY KEY,                          -- UTC hour, e.g. 2026-09-21T06
  due INTEGER NOT NULL,
  sent INTEGER NOT NULL,
  deferred INTEGER NOT NULL,
  held INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  log TEXT
);

CREATE TABLE email_events (
  id INTEGER PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,         -- the webhook's svix-id header
  type TEXT NOT NULL,
  email_hash TEXT,
  subscriber_id INTEGER,
  received_at TEXT NOT NULL,
  payload TEXT                                    -- JSON with addresses removed
);

CREATE TABLE suppressions (
  email_hash TEXT PRIMARY KEY,
  reason TEXT NOT NULL,                           -- complaint | bounce
  created_at TEXT NOT NULL
);
