/* Add a short, globally-unique 5-digit join code to teams — a parent types it instead of
   following an invite link. Globally unique (not per-club) because the parent enters only the
   code, with no club context, so the resolver maps it straight to a club+team.
   Codes themselves are backfilled at runtime (server/people.js ensureJoinCodes), because deploys
   don't run migrations — this file just guarantees the column + uniqueness for formal migration runs. */

exports.up = (pgm) => {
    pgm.sql(`
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_code text;
    CREATE UNIQUE INDEX IF NOT EXISTS teams_join_code_uniq ON teams (join_code) WHERE join_code IS NOT NULL;
  `);
};

exports.down = (pgm) => {
    pgm.sql(`
    DROP INDEX IF EXISTS teams_join_code_uniq;
    ALTER TABLE teams DROP COLUMN IF EXISTS join_code;
  `);
};
