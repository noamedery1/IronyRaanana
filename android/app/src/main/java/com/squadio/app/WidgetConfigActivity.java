package com.squadio.app;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

// Shown when the user adds the schedule widget: type a club code, load its teams, tick the teams to
// show, save. The widget then renders those teams (⇄ cycles between them).
public class WidgetConfigActivity extends AppCompatActivity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private EditText clubEdit;
    private LinearLayout teamsBox;
    private TextView status;
    private String currentClub = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        setContentView(R.layout.widget_config);

        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        clubEdit = findViewById(R.id.cfg_club);
        teamsBox = findViewById(R.id.cfg_teams);
        status = findViewById(R.id.cfg_status);
        ((Button) findViewById(R.id.cfg_load)).setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { loadTeams(); }
        });
        ((Button) findViewById(R.id.cfg_save)).setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { save(); }
        });
    }

    private void loadTeams() {
        final String club = clubEdit.getText().toString().toLowerCase().replaceAll("[^a-z0-9-]", "");
        if (club.isEmpty()) { status.setText("הקלידו קוד מועדון"); return; }
        status.setText("טוען קבוצות…");
        teamsBox.removeAllViews();
        new Thread(new Runnable() {
            public void run() {
                try {
                    String json = ScheduleWidget.httpGet(ScheduleWidget.BASE + "/api/" + club + "/teams");
                    JSONObject o = new JSONObject(json);
                    JSONArray arr = o.optJSONArray("teams");
                    final List<String> names = new ArrayList<>();
                    if (arr != null) for (int i = 0; i < arr.length(); i++) {
                        String nm = arr.getJSONObject(i).optString("name", "");
                        if (!nm.isEmpty()) names.add(nm);
                    }
                    runOnUiThread(new Runnable() {
                        public void run() {
                            currentClub = club;
                            if (names.isEmpty()) { status.setText("לא נמצאו קבוצות למועדון הזה"); return; }
                            status.setText("סמנו קבוצות (" + names.size() + "):");
                            for (String nm : names) {
                                CheckBox cb = new CheckBox(WidgetConfigActivity.this);
                                cb.setText(nm);
                                cb.setTextColor(0xFFE8EDF7);
                                teamsBox.addView(cb);
                            }
                        }
                    });
                } catch (Exception e) {
                    runOnUiThread(new Runnable() { public void run() { status.setText("שגיאה בטעינת הקבוצות — בדקו את הקוד והחיבור"); } });
                }
            }
        }).start();
    }

    private void save() {
        if (currentClub.isEmpty()) { status.setText("טענו קבוצות קודם"); return; }
        JSONArray sources = new JSONArray();
        for (int i = 0; i < teamsBox.getChildCount(); i++) {
            View v = teamsBox.getChildAt(i);
            if (v instanceof CheckBox && ((CheckBox) v).isChecked()) {
                try {
                    JSONObject s = new JSONObject();
                    s.put("club", currentClub);
                    s.put("team", ((CheckBox) v).getText().toString());
                    sources.put(s);
                } catch (Exception ignored) {}
            }
        }
        if (sources.length() == 0) { status.setText("סמנו לפחות קבוצה אחת"); return; }

        SharedPreferences sp = getSharedPreferences(ScheduleWidget.PREFS, MODE_PRIVATE);
        sp.edit().putString("sources_" + widgetId, sources.toString()).putInt("idx_" + widgetId, 0).apply();

        // Tell the widget to render now.
        Intent update = new Intent(this, ScheduleWidget.class);
        update.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        update.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[]{widgetId});
        sendBroadcast(update);

        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }
}
