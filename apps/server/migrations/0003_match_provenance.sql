ALTER TABLE matches ADD COLUMN map_seed bigint;
ALTER TABLE matches ADD COLUMN player_count integer;
UPDATE matches SET player_count = rewards.total
FROM (SELECT match_id, count(*)::integer AS total FROM match_rewards GROUP BY match_id) rewards
WHERE matches.id = rewards.match_id;
ALTER TABLE matches ADD CONSTRAINT matches_map_seed_uint32
  CHECK (map_seed IS NULL OR map_seed BETWEEN 0 AND 4294967295);
ALTER TABLE matches ADD CONSTRAINT matches_player_count_positive
  CHECK (player_count IS NULL OR player_count BETWEEN 1 AND 10);
