/* Two-schedule model: besides 'live'/'archived', a club has exactly ONE open
   'draft' publication (the next week the manager is building). Publishing promotes
   the draft to live. This index enforces a single draft per club. */

exports.up = (pgm) => {
    pgm.sql(`
        CREATE UNIQUE INDEX IF NOT EXISTS publications_draft_uniq
          ON schedule_publications (club_id) WHERE status = 'draft';
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS publications_draft_uniq;`);
};
