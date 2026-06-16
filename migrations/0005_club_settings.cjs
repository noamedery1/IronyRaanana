/* Per-club settings (halls config, floating message, future toggles) as key/value JSON. */

exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS club_settings (
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      key         text NOT NULL,
      value       jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (club_id, key)
    );
  `);
};

exports.down = (pgm) => { pgm.sql(`DROP TABLE IF EXISTS club_settings CASCADE;`); };
