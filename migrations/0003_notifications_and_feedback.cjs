/* Phase 2b: push subscriptions, email subscribers, feedback — move off the Sheet. */

exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      segment     text,                 -- '' all · team:<name> · __TRAINER__:<name> · __OPERATOR__
      endpoint    text UNIQUE NOT NULL,
      subscription jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_seg_idx ON push_subscriptions (club_id, segment);

    CREATE TABLE IF NOT EXISTS email_subscribers (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      team        text,
      name        text,
      email       text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS email_sub_uniq ON email_subscribers (club_id, lower(email), coalesce(team,''));

    CREATE TABLE IF NOT EXISTS feedback (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid,
      name        text,
      email       text,
      message     text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
    pgm.sql(`
    DROP TABLE IF EXISTS feedback CASCADE;
    DROP TABLE IF EXISTS email_subscribers CASCADE;
    DROP TABLE IF EXISTS push_subscriptions CASCADE;
  `);
};
