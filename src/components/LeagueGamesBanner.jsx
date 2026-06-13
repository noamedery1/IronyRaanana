import { useState, useEffect } from 'react';

const LeagueGamesBanner = ({ data, headers, targetGender }) => {
    const [games, setGames] = useState([]);

    useEffect(() => {
        if (!data || data.length === 0 || !headers) {
            setGames([]);
            return;
        }

        const processBanner = () => {
            // 1. Find Type/Gender Column - Enhanced detection
            const typeIndex = headers.findIndex(h => h && (
                h.toLowerCase() === 'type' ||
                h.toLowerCase() === 'category' ||
                h.includes('סוג') ||
                h.toLowerCase().includes('gender') ||
                h.includes('מין')
            ));

            const parsedGames = [];

            data.forEach(row => {
                const name = row[0];
                if (!name) return;

                // Check if row is a "Banner" row
                if (['באנר', 'banner'].some(b => name.trim().toLowerCase().includes(b))) {

                    // Check Gender
                    let show = true;
                    if (typeIndex !== -1 && targetGender) {
                        const rawType = row[typeIndex];
                        const type = rawType ? rawType.trim().toUpperCase() : '';

                        // Logic:
                        // If type matches valid gender indicators (W/M) and doesn't match target, hide it.
                        // If type is empty, we assume it's for everyone.

                        // Check explicit mismatch
                        if (type === 'W' && targetGender !== 'W') show = false;
                        if (type === 'M' && targetGender !== 'M') show = false;

                        // Handle localized or full names just in case
                        if ((type === 'WOMEN' || type === 'נשים') && targetGender !== 'W') show = false;
                        if ((type === 'MEN' || type === 'גברים') && targetGender !== 'M') show = false;
                    }

                    if (show) {
                        // Extract content from all columns except Name (0) and Type/Gender
                        for (let i = 1; i < row.length; i++) {
                            if (i === typeIndex) continue; // Skip type column text

                            // IMPORTANT: We do NOT skip the 'Coach' column here. 
                            // The banner text usually spans across columns B, C etc. 
                            // Column B is usually "Coach", so skipping it hides the main message.

                            const content = row[i];
                            if (content && content.trim() && !content.toLowerCase().includes('xxx')) {
                                parsedGames.push({
                                    text: content.trim()
                                });
                            }
                        }
                    }
                }
            });

            console.log("LeagueGamesBanner processed:", parsedGames.length, "games. Target:", targetGender);
            setGames(parsedGames);
        };

        processBanner();
    }, [data, headers, targetGender]);

    if (games.length === 0) return null;

    return (
        <div style={{
            background: 'linear-gradient(90deg, rgba(30,58,138,0.55), rgba(34,211,238,0.28), rgba(30,58,138,0.55))',
            color: '#eaf6ff',
            padding: '11px 0',
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '14px',
            margin: '0.6rem 0',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 10px 30px -16px rgba(0,0,0,0.7)',
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
