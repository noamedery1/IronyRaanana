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

// Home-screen widget: a live summary of a team's upcoming schedule, pulled from the existing public
// API (/api/<club>/schedule). Configured per-instance (club + one or more teams); the ⇄ button
// cycles between the configured teams, ↻ refreshes, and tapping the body opens the app.
public class ScheduleWidget extends AppWidgetProvider {
    static final String PREFS = "squadio_widget";
    static final String ACTION_REFRESH = "com.squadio.app.WIDGET_REFRESH";
    static final String ACTION_SWITCH = "com.squadio.app.WIDGET_SWITCH";
    static final String BASE = "https://squadio.techbynoam.com"; // apex serves /api for every club
    static final String[] HEB_DAYS = {"ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"};

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) renderAsync(context, mgr, id);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) { e.remove("sources_" + id); e.remove("idx_" + id); }
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
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            int n = sourcesCount(sp, id);
            if (n > 1) {
                int idx = sp.getInt("idx_" + id, 0);
                sp.edit().putInt("idx_" + id, (idx + 1) % n).apply();
            }
            renderAsync(context, mgr, id);
        } else if (ACTION_REFRESH.equals(action)) {
            renderAsync(context, mgr, id);
        }
    }

    static int sourcesCount(SharedPreferences sp, int id) {
        try { return new JSONArray(sp.getString("sources_" + id, "[]")).length(); } catch (Exception e) { return 0; }
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
        SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray sources = new JSONArray(sp.getString("sources_" + id, "[]"));
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
        wireButtons(context, rv, id);

        if (sources.length() == 0) {
            rv.setTextViewText(R.id.w_title, "לא הוגדר");
            rv.setViewVisibility(R.id.w_line0, View.VISIBLE);
            rv.setTextViewText(R.id.w_line0, "הסירו והוסיפו את הווידג׳ט כדי להגדיר קבוצה");
            mgr.updateAppWidget(id, rv);
            return;
        }

        int idx = sp.getInt("idx_" + id, 0) % sources.length();
        JSONObject src = sources.getJSONObject(idx);
        String club = src.getString("club");
        String team = src.getString("team");

        String json = httpGet(BASE + "/api/" + club + "/schedule");
        JSONObject data = new JSONObject(json);
        JSONArray sessions = data.optJSONArray("sessions");

        String nt = norm(team);
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0); today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0); today.set(Calendar.MILLISECOND, 0);

        List<Row> rows = new ArrayList<>();
        if (sessions != null) {
            for (int i = 0; i < sessions.length(); i++) {
                JSONObject s = sessions.getJSONObject(i);
                if (!norm(s.optString("team")).equals(nt)) continue;
                String date = s.optString("date", "");
                Date d;
                try { d = f.parse(date); } catch (Exception e) { continue; }
                if (d == null || d.before(today.getTime())) continue;
                Row r = new Row();
                r.date = d; r.dateStr = date;
                r.start = s.optString("start_time", ""); r.end = s.optString("end_time", "");
                r.hall = s.optString("hall", ""); r.status = s.optString("status", ""); r.type = s.optString("type", "");
                rows.add(r);
            }
        }
        Collections.sort(rows, new Comparator<Row>() {
            public int compare(Row a, Row b) { int c = a.date.compareTo(b.date); return c != 0 ? c : a.start.compareTo(b.start); }
        });

        rv.setTextViewText(R.id.w_title, team);
        rv.setTextViewText(R.id.w_sub, club + (sources.length() > 1 ? "   ·   " + (idx + 1) + "/" + sources.length() : ""));

        int[] lineIds = {R.id.w_line0, R.id.w_line1, R.id.w_line2, R.id.w_line3, R.id.w_line4, R.id.w_line5};
        for (int i = 0; i < lineIds.length; i++) {
            if (i < rows.size()) {
                rv.setTextViewText(lineIds[i], formatRow(rows.get(i)));
                rv.setViewVisibility(lineIds[i], View.VISIBLE);
            } else {
                rv.setViewVisibility(lineIds[i], View.GONE);
            }
        }
        if (rows.isEmpty()) {
            rv.setViewVisibility(R.id.w_line0, View.VISIBLE);
            rv.setTextViewText(R.id.w_line0, "אין אימונים קרובים");
        }
        rv.setTextViewText(R.id.w_updated, "עודכן " + new SimpleDateFormat("HH:mm", Locale.US).format(new Date()));
        mgr.updateAppWidget(id, rv);
    }

    String formatRow(Row r) {
        Calendar c = Calendar.getInstance();
        try { c.setTime(new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(r.dateStr)); } catch (Exception e) { /* keep now */ }
        int dow = c.get(Calendar.DAY_OF_WEEK) - 1; // 0 = Sunday
        String day = (dow >= 0 && dow < 7) ? HEB_DAYS[dow] : "";
        String dm = c.get(Calendar.DAY_OF_MONTH) + "/" + (c.get(Calendar.MONTH) + 1);
        String time = r.start + (r.end.isEmpty() ? "" : "–" + r.end);
        String line = day + " " + dm + "   " + time;
        if (!r.hall.isEmpty()) line += "   ·   " + r.hall;
        if ("cancelled".equals(r.status)) line = "✗ " + line;
        else if ("MATCH".equalsIgnoreCase(r.type) || "match".equals(r.type)) line = "🏆 " + line;
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
        Date date;
        String dateStr, start, end, hall, status, type;
    }
}
