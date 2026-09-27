/* Store the registrant's name on a push subscription, so the manager's subscriptions screen can
   show WHO each device is (not only its team/origin) when deciding what to remove. */

exports.up = (pgm) => {
    pgm.sql('ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS label text;');
};

exports.down = (pgm) => {
    pgm.sql('ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS label;');
};
