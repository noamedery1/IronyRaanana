
import { saveAs } from 'file-saver';

// Helper to parse the raw structure into a flat list of sessions
export const flattenScheduleData = (teams, headers, dayStart, indices) => {
    // teams: Array of { name, coach, row, value, label }
    // headers: Array of strings
    // dayStart: index where Sunday starts
    // indices: optional { dayStart }

    const startIndex = dayStart || indices?.dayStart || 1;
    const flatData = [];

    teams.forEach(team => {
        // Loop through 7 days
        for (let i = 0; i < 7; i++) {
            const colIndex = startIndex + i;
            const content = team.row[colIndex];
            if (!content || !content.trim() || content.toLowerCase().includes('xxx')) continue;

            const header = headers[colIndex] || '';
            const dayParts = header.split(' ');
            const dayName = dayParts[0];

            // Simple parsing of location/time
            // Matches "17:00-18:30 Hall Name" or "Hall Name 17:00"
            const { time, location, isMatch } = parseCellContent(content);

            flatData.push({
                team: team.name,
                coach: team.coach,
                dayIndex: i,
                dayName: dayName,
                rawContent: content,
                time: time,
                location: location,
                isMatch: isMatch,
                status: status,
                fullDate: header // e.g. "Sunday 25.1"
            });
        }
    });

    return flatData;
};

// Parse individual cell
export const parseCellContent = (text) => {
    if (!text) return { time: '', location: '', isMatch: false, status: 'normal', originalText: '' };

    let status = 'normal';
    let cleanText = text;

    // Check for Cancellation
    if (text.match(/^(x|X|בוטל|CANCELED)\b/) || text.includes('X ') || text.includes('בוטל')) {
        status = 'cancelled';
        // Aggressively remove X and labels
        cleanText = text.replace(/^(x|X|בוטל|X |CANCELED)/i, '').replace(/בוטל|CANCELED/g, '').replace(/\bX\b/g, '').trim();
    }
    // Check for Change (prefixes or symbols: !, ⚠️, שינוי)
    else if (text.includes('!') || text.includes('⚠️') || text.includes('שינוי') || text.includes('CHANGE')) {
        status = 'changed';
        cleanText = text.replace(/[!⚠️]/g, '').replace(/(שינוי|CHANGE)/g, '').trim();
    }

    const isMatch = cleanText.includes('משחק');

    // Normalize time format to HH:MM
    let formatted = cleanText.replace(/\b([0-1][0-9]|2[0-3])([0-5][0-9])\b/g, '$1:$2');

    // Extract time range or single time
    const timeRegex = /\b\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\b/g;
    const matches = formatted.match(timeRegex);

    let time = '';
    let location = formatted;

    if (matches && matches.length > 0) {
        time = matches[matches.length - 1]; // usually time is at the end or recognized
        // Remove time from location string
        matches.forEach(m => {
            location = location.replace(m, '');
        });
    }

    return {
        time: time.trim(),
        location: location.replace('משחק', '').trim(), // Clean up
        isMatch,
        status, // 'normal', 'cancelled', 'changed'
        originalText: text
    };
};

export const groupDataByHall = (flatData) => {
    const halls = {};

    flatData.forEach(item => {
        const loc = item.location || 'אחר';
        if (!halls[loc]) {
            halls[loc] = [];
        }
        halls[loc].push(item);
    });

    return halls;
};

export const normalizeLocation = (loc) => {
    return loc.trim().toLowerCase().replace(/['"]+/g, '');
};

// Helper: Parse Hebrew Date header "Sunday 25.1" to Date object
export const parseHeaderDate = (header) => {
    // header format: "Name DD.MM" or "Name DD.MM.YY"
    // e.g. "ראשון 25.1"
    if (!header) return null;
    try {
        // Remove Hebrew/English chars to find the date part
        // This regex looks for DD.MM.YY or DD.MM pattern with dot, slash or hyphen
        const dateMatch = header.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);

        if (!dateMatch) return null;

        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10);
        let year = dateMatch[3] ? parseInt(dateMatch[3], 10) : 2026; // Default to 2026 as requested

        // Handle 2-digit year
        if (year < 100) year += 2000;

        // Month is 0-indexed in JS
        const date = new Date(year, month - 1, day);
        return date;
    } catch (e) {
        console.error("Date parse error", e);
        return null;
    }
};

// Improved Excel Export using exceljs for styling
import ExcelJS from 'exceljs';

export const exportToExcel = async (flatData, fileName = 'schedule.xlsx') => {
    // Sort by DayIndex -> Hall -> Time
    const sortedData = [...flatData].sort((a, b) => {
        if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
        if (a.location !== b.location) return a.location.localeCompare(b.location);
        return a.time.localeCompare(b.time);
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Raanana Scheduler';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('לוז שבועי', {
        views: [{ rightToLeft: true }] // RTL Sheet
    });

    // Define Columns
    sheet.columns = [
        { header: 'יום', key: 'day', width: 12 },
        { header: 'תאריך', key: 'date', width: 15 },
        { header: 'אולם', key: 'hall', width: 25 },
        { header: 'שעה', key: 'time', width: 15 },
        { header: 'קבוצה', key: 'team', width: 30 },
        { header: 'מאמן', key: 'coach', width: 20 },
        { header: 'סוג פעילות', key: 'type', width: 15 },
    ];

    // Style the main header row
    const headerRow = sheet.getRow(1);
    headerRow.height = 25;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' } // Dark Blue
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    let currentDayIndex = -1;

    sortedData.forEach(item => {
        // Add Day Separator Header if day changes
        if (item.dayIndex !== currentDayIndex) {
            currentDayIndex = item.dayIndex;
            const separatorRow = sheet.addRow([
                item.dayName + ' ' + (item.fullDate.split(' ')[1] || ''),
                '', '', '', '', '', ''
            ]);

            // Merge cells for the separator
            sheet.mergeCells(`A${separatorRow.number}:G${separatorRow.number}`);

            // Style separator
            separatorRow.height = 22;
            separatorRow.font = { bold: true, color: { argb: 'FF1F4E78' }, size: 12 }; // Dark text
            separatorRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD9E1F2' } // Light Blue
            };
            separatorRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };
            separatorRow.getCell(1).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' }
            };
        }

        // Add Data Row
        const row = sheet.addRow({
            day: item.dayName,
            date: item.fullDate,
            hall: item.location,
            time: item.time,
            team: item.team,
            coach: item.coach,
            type: item.isMatch ? '🏀 משחק' : (item.status === 'cancelled' ? '❌ בוטל' : (item.status === 'changed' ? '⚠️ שינוי' : 'אימון'))
        });

        // Row Styling
        row.alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('hall').font = { bold: true };
        row.getCell('hall').alignment = { vertical: 'middle', horizontal: 'right' };
        row.getCell('team').alignment = { vertical: 'middle', horizontal: 'right' };
        row.getCell('time').font = { name: 'Courier New' };

        // Conditional Styling based on status
        if (item.status === 'cancelled') {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFE6E6' } // Red background
            };
            row.font = { strike: true, color: { argb: 'FF990000' } }; // Strike text
        } else if (item.status === 'changed') {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFF9C4' } // Yellow background
            };
            row.getCell('time').font = { bold: true, color: { argb: 'FFE65100' } }; // Bold Orange Time
        } else if (item.isMatch) {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFE6E6' } // Light Red/Pink
            };
            row.getCell('type').font = { color: { argb: 'FFFF0000' }, bold: true };
        } else {
            // Alternating basic rows? Or just white. White is clean.
            row.border = {
                bottom: { style: 'dotted', color: { argb: 'FFCCCCCC' } }
            };
        }
    });

    // Final borders for the whole table (optional, but cleaner per cell)
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip checking header again, done above
            row.eachCell((cell) => {
                if (!cell.border) {
                    cell.border = {
                        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
                        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }, // Vertical borders
                        left: { style: 'thin', color: { argb: 'FFDDDDDD' } }
                    };
                }
            });
        }
    });


    // Write and Save
    const buffer = await workbook.xlsx.writeBuffer();
    const data = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' });
    saveAs(data, fileName);
};

// Google Calendar Link (Single Event)
export const generateGoogleCalendarLink = (event) => {
    // dates must be YYYYMMDDTHHMMSSZ
    const formatDate = (date) => {
        return date.toISOString().replace(/-|:|\.\d+/g, '');
    };

    const baseUrl = "https://calendar.google.com/calendar/render?action=TEMPLATE";
    const title = encodeURIComponent(event.title);
    const details = encodeURIComponent(event.details || '');
    const location = encodeURIComponent(event.location || '');

    // If we have real start/end dates
    let datesParam = '';
    if (event.start && event.end) {
        datesParam = `&dates=${formatDate(event.start)}/${formatDate(event.end)}`;
    }

    return `${baseUrl}&text=${title}&details=${details}&location=${location}${datesParam}`;
};

// Helper: Parse time "17:00" to hours/minutes
export const parseTime = (timeStr) => {
    if (!timeStr) return { h: 0, m: 0 };
    const [h, m] = timeStr.split(':').map(Number);
    return { h: h || 0, m: m || 0 };
};

export const createICSFile = (events, calendarName = 'Schedule') => {
    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Raanana//Scheduler//HE\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n";

    events.forEach(ev => {
        if (!ev.start || !ev.end) return;

        const formatDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

        icsContent += "BEGIN:VEVENT\n";
        icsContent += `DTSTART:${formatDate(ev.start)}\n`;
        icsContent += `DTEND:${formatDate(ev.end)}\n`;
        icsContent += `SUMMARY:${ev.title}\n`;
        icsContent += `DESCRIPTION:${ev.details || ''}\n`;
        icsContent += `LOCATION:${ev.location || ''}\n`;
        icsContent += `UID:${Date.now()}_${Math.random().toString(36).substr(2, 9)}@raanana.scheduler\n`;
        icsContent += "END:VEVENT\n";
    });

    icsContent += "END:VCALENDAR";

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    saveAs(blob, `${calendarName}.ics`);
};
