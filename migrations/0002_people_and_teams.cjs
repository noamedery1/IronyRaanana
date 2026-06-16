/* Phase 2: move trainers, members/operators, and teams into the DB. */

exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS trainers (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      name        text NOT NULL,
      code        text,                 -- login code (plain for now; hashing is a follow-up)
      teams       text,                 -- comma-separated team names (mirrors the old sheet)
      color       text,
      token       text UNIQUE,          -- personal login link
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS trainers_name_uniq ON trainers (club_id, lower(name));

    CREATE TABLE IF NOT EXISTS app_users (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      token       text UNIQUE NOT NULL,
      role        text NOT NULL,        -- member / operator
      team        text,
      name        text,
      email       text,
      phone       text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS teams (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      name        text NOT NULL,
      gender      char(1) NOT NULL DEFAULT 'M',
      coach       text,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS teams_name_uniq ON teams (club_id, lower(name));
  `);
};

exports.down = (pgm) => {
    pgm.sql(`
    DROP TABLE IF EXISTS teams CASCADE;
    DROP TABLE IF EXISTS app_users CASCADE;
    DROP TABLE IF EXISTS trainers CASCADE;
  `);
};
