/* Native (store-app) push tokens — FCM/APNs device tokens for the bundled Android/iOS apps, which
   can't receive Web Push. Delivered to from broadcast() alongside push_subscriptions. Additive: the
   existing Web Push tables and flow are untouched. Also created idempotently in ensureStore() so a
   deploy that doesn't run migrations still has the table. */

exports.up = (pgm) => {
    pgm.sql(`
    CREATE TABLE IF NOT EXISTS native_push_tokens (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      token       text UNIQUE NOT NULL,   -- FCM registration token (routes APNs for iOS too)
      segment     text,                   -- '' all · team:<name> · __TRAINER__:<name> · __OPERATOR__
      platform    text,                   -- android | ios
      label       text,                   -- registrant's name, if captured
      host        text,                   -- origin the token registered from
      user_token  text,                   -- optional link to the signed-in user (debug/association)
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS native_push_seg_idx ON native_push_tokens (club_id, segment);
  `);
};

exports.down = (pgm) => {
    pgm.sql('DROP TABLE IF EXISTS native_push_tokens CASCADE;');
};
