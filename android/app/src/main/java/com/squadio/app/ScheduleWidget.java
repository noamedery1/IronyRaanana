package com.squadio.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

// Home-screen widget: a live weekly schedule summary, pulled from the existing public API
// (/api/<club>/schedule) — no new service, no configuration. The data comes from the app itself: the
// home screen mirrors the user's memberships {club, team} into Capacitor Preferences
// ("CapacitorStorage"/"squadio_members"). A membership with a team shows just that team (a parent);
// one without a team shows the whole club (an operator). ⇄ cycles memberships, ↻ refreshes.
public class ScheduleWidget extends AppWidgetProvider {
    static final String CAP_PREFS = "CapacitorStorage"; // where @capacitor/preferences stores on Android
    static final String PREFS = "squadio_widget";        // our per-widget index
    static final String ACTION_REFRESH = "com.squadio.app.WIDGET_REFRESH";
    static final String ACTION_SWITCH = "com.squadio.app.WIDGET_SWITCH";
    static final String BASE = "https://squadio.techbynoam.com"; // apex serves /api for every club
    static final String[] HEB_DAYS = {"ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"};
    static final int MAX_LINES = 6;

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) renderAsync(context, mgr, id);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) e.remove("idx_" + id);
        e.apply();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        if (ACTION_SWITCH.equals(action)) {
            int n = members(context).size();
            if (n > 1) {
                SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                int idx = sp.getInt("idx_" + id, 0);
                sp.edit().putInt("idx_" + id, (idx + 1) % n).apply();
            }
            renderAsync(context, mgr, id);
        } else if (ACTION_REFRESH.equals(action)) {
            renderAsync(context, mgr, id);
        }
    }

    static List<String> clubs(Context context) {
        List<String> out = new ArrayList<>();
        try {
            String raw = context.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).getString("squadio_clubs", "[]");
            JSONArray a = new JSONArray(raw);
            for (int i = 0; i < a.length(); i++) {
                String s = a.optString(i, "").trim();
                if (!s.isEmpty()) out.add(s);
            }
        } catch (Exception ignored) {}
        return out;
    }

    // Memberships {club, team}; team "" = whole club. Falls back to whole-club per saved club.
    static List<String[]> members(Context context) {
        List<String[]> out = new ArrayList<>();
        try {
            String raw = context.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).getString("squadio_members", "[]");
            JSONArray a = new JSONArray(raw);
            for (int i = 0; i < a.length(); i++) {
                JSONObject m = a.optJSONObject(i);
                if (m == null) continue;
                String club = m.optString("club", "").trim();
                String team = m.optString("team", "").trim();
                if (!club.isEmpty()) out.add(new String[]{club, team});
            }
        } catch (Exception ignored) {}
        if (out.isEmpty()) for (String c : clubs(context)) out.add(new String[]{c, ""});
        return out;
    }

    void renderAsync(final Context context, final AppWidgetManager mgr, final int id) {
        RemoteViews loading = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
        loading.setTextViewText(R.id.w_title, "טוען…");
        wireButtons(context, loading, id);
        mgr.updateAppWidget(id, loading);

        new Thread(new Runnable() {
            public void run() {
                try { renderNow(context, mgr, id); }
                catch (Exception e) {
                    RemoteViews err = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
                    err.setTextViewText(R.id.w_title, "שגיאה בטעינה");
                    err.setViewVisibility(R.id.w_line0, View.VISIBLE);
                    err.setTextViewText(R.id.w_line0, "בדקו חיבור ולחצו ↻");
                    wireButtons(context, err, id);
                    mgr.updateAppWidget(id, err);
                }
            }
        }).start();
    }

    void renderNow(Context context, AppWidgetManager mgr, int id) throws Exception {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
        wireButtons(context, rv, id);

        List<String[]> mem = members(context);
        if (mem.isEmpty()) {
            rv.setTextViewText(R.id.w_title, "Squadio");
            rv.setViewVisibility(R.id.w_line0, View.VISIBLE);
            rv.setTextViewText(R.id.w_line0, "היכנסו לאפליקציה למועדון כדי לטעון לו\"ז");
            hideLinesFrom(rv, 1);
            mgr.updateAppWidget(id, rv);
            return;
        }

        SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int idx = sp.getInt("idx_" + id, 0) % mem.size();
        String club = mem.get(idx)[0];
        String team = mem.get(idx)[1];
        boolean wholeClub = team.isEmpty();
        String nt = norm(team);

        String json = httpGet(BASE + "/api/" + club + "/schedule");
        JSONArray sessions = new JSONObject(json).optJSONArray("sessions");

        // The published schedule is a weekly template dated to its publication week; treat it by
        // day-of-week, ordered from today, so nothing looks "in the past".
        int todayDow = Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1; // 0 = Sunday
        List<Row> rows = new ArrayList<>();
        if (sessions != null) {
            for (int i = 0; i < sessions.length(); i++) {
                JSONObject s = sessions.getJSONObject(i);
                if ("cancelled".equals(s.optString("status"))) continue;
                if (!wholeClub && !norm(s.optString("team")).equals(nt)) continue;
                Row r = new Row();
                r.team = s.optString("team", "");
                r.dow = s.has("day_of_week") ? s.optInt("day_of_week", 0) : dowFromDate(s.optString("date", ""));
                r.start = s.optString("start_time", "");
                r.end = s.optString("end_time", "");
                r.hall = s.optString("hall", "");
                r.type = s.optString("type", "");
                r.order = ((r.dow - todayDow) % 7 + 7) % 7;
                rows.add(r);
            }
        }
        Collections.sort(rows, new Comparator<Row>() {
            public int compare(Row a, Row b) { return a.order != b.order ? a.order - b.order : a.start.compareTo(b.start); }
        });

        rv.setTextViewText(R.id.w_title, wholeClub ? club : team);
        rv.setTextViewText(R.id.w_sub, "לו\"ז השבוע" + (mem.size() > 1 ? "   ·   " + (idx + 1) + "/" + mem.size() : ""));

        int[] lineIds = {R.id.w_line0, R.id.w_line1, R.id.w_line2, R.id.w_line3, R.id.w_line4, R.id.w_line5};
        int shown = Math.min(rows.size(), MAX_LINES);
        for (int i = 0; i < lineIds.length; i++) {
            if (i < shown) {
                rv.setTextViewText(lineIds[i], formatRow(rows.get(i), wholeClub));
                rv.setViewVisibility(lineIds[i], View.VISIBLE);
            } else {
                rv.setViewVisibility(lineIds[i], View.GONE);
            }
        }
        if (shown == 0) {
            rv.setViewVisibility(R.id.w_line0, View.VISIBLE);
            rv.setTextViewText(R.id.w_line0, "אין אימונים השבוע");
        }
        rv.setTextViewText(R.id.w_updated, "עודכן " + new SimpleDateFormat("HH:mm", Locale.US).format(new Date()));
        mgr.updateAppWidget(id, rv);
    }

    void hideLinesFrom(RemoteViews rv, int from) {
        int[] lineIds = {R.id.w_line0, R.id.w_line1, R.id.w_line2, R.id.w_line3, R.id.w_line4, R.id.w_line5};
        for (int i = from; i < lineIds.length; i++) rv.setViewVisibility(lineIds[i], View.GONE);
    }

    int dowFromDate(String ymd) {
        try {
            Calendar c = Calendar.getInstance();
            c.setTime(new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(ymd));
            return c.get(Calendar.DAY_OF_WEEK) - 1;
        } catch (Exception e) { return 0; }
    }

    String formatRow(Row r, boolean showTeam) {
        String day = (r.dow >= 0 && r.dow < 7) ? HEB_DAYS[r.dow] : "";
        String time = r.start + (r.end.isEmpty() ? "" : "–" + r.end);
        String line = (showTeam && !r.team.isEmpty() ? r.team + "  ·  " : "") + "יום " + day + "  " + time;
        if (!r.hall.isEmpty()) line += "  ·  " + r.hall;
        if ("MATCH".equalsIgnoreCase(r.type)) line = "🏆 " + line;
        return line;
    }

    void wireButtons(Context context, RemoteViews rv, int id) {
        rv.setOnClickPendingIntent(R.id.w_refresh, broadcast(context, ACTION_REFRESH, id));
        rv.setOnClickPendingIntent(R.id.w_switch, broadcast(context, ACTION_SWITCH, id));
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) {
            PendingIntent op = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
            rv.setOnClickPendingIntent(R.id.w_root, op);
        }
    }

    PendingIntent broadcast(Context context, String action, int id) {
        Intent i = new Intent(context, ScheduleWidget.class);
        i.setAction(action);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(context, action.hashCode() ^ id, i, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
    }

    static int immutable() { return Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_IMMUTABLE : 0; }

    static String norm(String s) {
        if (s == null) return "";
        return s.replaceAll("['\"׳״]", "").replaceAll("\\s+", " ").trim();
    }

    static String httpGet(String urlStr) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(urlStr).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(12000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Accept", "application/json");
        int code = c.getResponseCode();
        BufferedReader br = new BufferedReader(new InputStreamReader(
                (code >= 200 && code < 400) ? c.getInputStream() : c.getErrorStream(), "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String ln;
        while ((ln = br.readLine()) != null) sb.append(ln);
        br.close();
        c.disconnect();
        return sb.toString();
    }

    static class Row {
        String team, start, end, hall, type;
        int dow, order;
    }
}
