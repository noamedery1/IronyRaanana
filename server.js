import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildTeamICSFromCsv } from './server/scheduleCore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Live public schedule CSV (same source the public site reads)
const DATA_URL = "https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0";

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Standalone sales landing page (clean URL without .html)
app.get('/sales-landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'sales-landing.html'));
});

// Live, auto-updating calendar feed per team (subscribe once -> phone calendar refreshes).
// e.g. webcal://<host>/calendar.ics?team=<encoded team label>
app.get('/calendar.ics', async (req, res) => {
    const team = (req.query.team || '').toString();
    if (!team) return res.status(400).send('Missing team parameter');
    try {
        const r = await fetch(DATA_URL);
        const csv = await r.text();
        const ics = buildTeamICSFromCsv(csv, team);
        if (!ics) return res.status(404).send('Team not found');
        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=1800');
        res.set('Content-Disposition', 'inline; filename="schedule.ics"');
        return res.send(ics);
    } catch (e) {
        console.error('calendar feed error:', e);
        return res.status(500).send('Error building calendar');
    }
});

// Handle React routing, return all requests to React app
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
