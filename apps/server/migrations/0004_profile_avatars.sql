CREATE TABLE profile_avatars (
  user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
  asset_id text NOT NULL UNIQUE,
  version text NOT NULL,
  data bytea NOT NULL,
  CONSTRAINT profile_avatar_size CHECK (octet_length(data) BETWEEN 1 AND 65536)
);
