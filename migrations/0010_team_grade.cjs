/* Add a school-grade (כיתה) definition to teams (e.g. "א", "ז", "י"א"). Optional. */

exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS grade text;`);
};

exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE teams DROP COLUMN IF EXISTS grade;`);
};
