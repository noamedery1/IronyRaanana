/* Move the club registry fully into the DB: a jsonb `config` holds all extra club
   fields (colors, logo/icons, shortName, publishUrl, sheetApi, managerEmails, …). */

exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;`);
};

exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE clubs DROP COLUMN IF EXISTS config;`);
};
