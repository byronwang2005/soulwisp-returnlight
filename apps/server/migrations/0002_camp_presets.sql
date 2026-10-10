ALTER TABLE camps ADD COLUMN presets jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE camps ADD CONSTRAINT camp_presets_array_limit
  CHECK (jsonb_typeof(presets) = 'array' AND jsonb_array_length(presets) <= 5);
