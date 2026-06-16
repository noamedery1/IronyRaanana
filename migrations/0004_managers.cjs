/* Manager accounts per club (login to the manager app -> enable manager push). */

exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS managers (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      username    text NOT NULL,
      password    text NOT NULL,   -- scrypt: <salt>:<hash> (hex)
      name        text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS managers_username_uniq ON managers (club_id, lower(username));
  `);
};

exports.down = (pgm) => { pgm.sql(`DROP TABLE IF EXISTS managers CASCADE;`); };
