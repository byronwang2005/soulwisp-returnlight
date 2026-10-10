CREATE TABLE auth_user (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false,
 image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_session (
 id text PRIMARY KEY, token text NOT NULL UNIQUE, user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, ip_address text, user_agent text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_session_user_idx ON auth_session(user_id);
CREATE TABLE auth_account (
 id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz,
 refresh_token_expires_at timestamptz, scope text, password text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_account_provider_identity ON auth_account(provider_id,account_id);
CREATE INDEX auth_account_user_idx ON auth_account(user_id);
CREATE TABLE auth_verification (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verification_identifier_idx ON auth_verification(identifier);
CREATE TABLE camps (
 user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
 fragments integer NOT NULL DEFAULT 0, secrets integer NOT NULL DEFAULT 0,
 cosmetics text[] NOT NULL DEFAULT ARRAY['base']::text[], research text[] NOT NULL DEFAULT ARRAY[]::text[],
 equipment jsonb NOT NULL DEFAULT '{"cosmeticId":"base","profession":"warden","form":0}'::jsonb,
 tutorial_step integer NOT NULL DEFAULT 0, tutorial_completed boolean NOT NULL DEFAULT false,
 matches integer NOT NULL DEFAULT 0, wins integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT camp_nonnegative CHECK (fragments>=0 AND secrets>=0 AND matches>=0 AND wins>=0)
);
CREATE TABLE camp_requests (
 user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE, request_id text NOT NULL,
 operation text NOT NULL, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id)
);
CREATE TABLE matches (
 id text PRIMARY KEY, rule_version text NOT NULL, winner text NOT NULL, reason text NOT NULL,
 payload_hash text NOT NULL, events jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE match_rewards (
 match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 fragments integer NOT NULL, secrets integer NOT NULL, won boolean NOT NULL,
 PRIMARY KEY(match_id,user_id)
);
CREATE TABLE redeemed_loot (
 loot_id text PRIMARY KEY, match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now()
);
