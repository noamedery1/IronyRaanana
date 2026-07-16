/* Add an age / age-group definition to teams (e.g. "2015", "נוער", "ילדים א"). */

exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS age text;`);
};

exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE teams DROP COLUMN IF EXISTS age;`);
};
