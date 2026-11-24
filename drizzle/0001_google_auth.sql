CREATE TABLE auth_oauth_states(
  state_hash TEXT PRIMARY KEY NOT NULL,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_oauth_states_expiry ON auth_oauth_states(expires_at);
--> statement-breakpoint
CREATE TABLE auth_sessions(
  token_hash TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
