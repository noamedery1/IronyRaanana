/* Phase 1 schema: clubs, schedule_publications, sessions, change_requests, audit_log.
   Raw SQL via pgm.sql to keep it close to docs/db-migration-phase1.md. */

exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS clubs (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        text UNIQUE NOT NULL,
      name        text NOT NULL,
      sport       text,
      data_url    text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS schedule_publications (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      week_start    date NOT NULL,
      status        text NOT NULL DEFAULT 'live',
      source_url    text,
      published_by  text,
      published_at  timestamptz NOT NULL DEFAULT now()
    );
    -- only one LIVE publication per club+week
    CREATE UNIQUE INDEX IF NOT EXISTS publications_live_uniq
      ON schedule_publications (club_id, week_start) WHERE status = 'live';

    CREATE TABLE IF NOT EXISTS sessions (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      publication_id  uuid NOT NULL REFERENCES schedule_publications(id) ON DELETE CASCADE,
      club_id         uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      team            text NOT NULL,
      coach           text,
      gender          char(1) NOT NULL DEFAULT 'M',
      hall            text,
      date            date,
      day_of_week     smallint,
      start_time      time,
      end_time        time,
      type            text NOT NULL DEFAULT 'training',
      status          text NOT NULL DEFAULT 'active',
      note            text,
      updated_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sessions_pub_idx  ON sessions (publication_id);
    CREATE INDEX IF NOT EXISTS sessions_conf_idx ON sessions (club_id, date, hall, start_time);

    CREATE TABLE IF NOT EXISTS change_requests (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      session_id    uuid REFERENCES sessions(id) ON DELETE SET NULL,
      requested_by  text,
      type          text NOT NULL,
      proposed      jsonb,
      reason        text,
      status        text NOT NULL DEFAULT 'pending',
      created_at    timestamptz NOT NULL DEFAULT now(),
      resolved_at   timestamptz
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          bigserial PRIMARY KEY,
      club_id     uuid,
      actor       text,
      action      text,
      entity      text,
      entity_id   uuid,
      diff        jsonb,
      at          timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
    pgm.sql(`
    DROP TABLE IF EXISTS audit_log CASCADE;
    DROP TABLE IF EXISTS change_requests CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
    DROP TABLE IF EXISTS schedule_publications CASCADE;
    DROP TABLE IF EXISTS clubs CASCADE;
  `);
};
