/* Store uploaded club images (logo + PWA icons) in the DB as bytes, instead of on the
   volume. One row per (club, kind); served via GET /api/:club/icon/:kind with caching.
   Keeping bytes in the DB means a single DB backup carries everything (portable,
   no volume dependency), while config holds only the lightweight URL. */

exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS club_assets (
            club_slug  text        NOT NULL,
            kind       text        NOT NULL,
            mime       text        NOT NULL DEFAULT 'image/png',
            bytes      bytea       NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (club_slug, kind)
        );
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS club_assets;`);
};
