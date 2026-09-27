/* Record the origin (host) a push subscription was created on, so a club that moved to its own
   subdomain can deliver only to that subdomain's subscriptions and drop the stale apex duplicate
   the same device left behind (two origins => two endpoints => two notifications). */

exports.up = (pgm) => {
    pgm.sql('ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS host text;');
    pgm.sql('CREATE INDEX IF NOT EXISTS push_host_idx ON push_subscriptions (club_id, host);');
};

exports.down = (pgm) => {
    pgm.sql('DROP INDEX IF EXISTS push_host_idx;');
    pgm.sql('ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS host;');
};
