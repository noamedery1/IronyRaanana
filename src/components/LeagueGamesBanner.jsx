import { useState, useEffect } from 'react';
import Papa from 'papaparse';

// URLs for the two sheets
const DATA_URL = "https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0";
const LeagueGamesBanner = () => {
    const [games, setGames] = useState([]);
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const fetchBannerData = async () => {
            const fetchSheet = (url) => {
                return new Promise((resolve) => {
                    Papa.parse(url, {
                        download: true,
                        complete: (results) => {
                            resolve(results.data);
                        },
                        error: () => resolve([])
                    });
                });
            };

            const data = await fetchSheet(DATA_URL);
            const allRows = data;
            const parsedGames = [];

            allRows.forEach(row => {
                // Check if row is a "Banner" row
                // User should write "באנר" or "Banner" in the first column (Team Name)
                if (row[0] && (row[0].trim() === 'באנר' || row[0].trim().toLowerCase() === 'banner')) {

                    // We assume standard structure: 
                    // Col 0: "Banner", Col ...: Days
                    // We need to find the day headers to map correct dates, but since we concatenated rows without headers, 
                    // it's tricky. 
                    // BETTER APPROACH: Just find the row and assume columns 1 to 7 are the days? 
                    // OR: Use the fact that usually Sunday is col index ~4 or 5?
                    // To be safe, let's look for content in the row and try to parse it.

                    // Let's assume the user puts the *full text* to display in the cells.
                    // e.g. Under "Sunday" col, they write "Game vs Gilboa...".
                    // The banner will just show non-empty cells.

                    // We Iterate columns 1 to 20 to find content
                    for (let i = 1; i < row.length; i++) {
                        const content = row[i];
                        if (content && content.trim() && !content.toLowerCase().includes('xxx')) {
                            parsedGames.push({
                                text: content.trim()
                            });
                        }
                    }
                }
            });

            if (parsedGames.length > 0) {
                setGames(parsedGames);
            }
        };

        fetchBannerData();
    }, []);

    if (!isVisible || games.length === 0) return null;

    return (
        <div style={{
            background: 'linear-gradient(90deg, #1e3a8a 0%, #3b82f6 50%, #1e3a8a 100%)',
            color: 'white',
            padding: '12px 0',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            direction: 'rtl'
        }}>
            <div className="banner-container" style={{
                width: '100%',
                overflow: 'hidden',
                whiteSpace: 'nowrap'
            }}>
                <div className="banner-scroll" style={{
                    display: 'inline-block',
                    whiteSpace: 'nowrap',
                    animation: 'scroll 15s linear infinite',
                    paddingRight: '100%' // Start off-screen
                }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>🏀 הודעות / משחקים: </span>
                    {games.map((game, idx) => (
                        <span key={idx} style={{ margin: '0 15px', fontSize: '1.1rem', borderLeft: idx < games.length - 1 ? '1px solid rgba(255,255,255,0.3)' : 'none', paddingLeft: '15px' }}>
                            {game.text}
                        </span>
                    ))}
                </div>
            </div>

            <style>
                {`
                    @keyframes scroll {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(100%); } /* RTL Scroll: Move Right */
                    }
                    /* On mobile, make font slightly smaller if needed, but scrolling solves space */
                    @media (max-width: 600px) {
                        .banner-scroll span {
                            font-size: 1rem !important;
                        }
                    }
                `}
            </style>
        </div>
    );
};

export default LeagueGamesBanner;
