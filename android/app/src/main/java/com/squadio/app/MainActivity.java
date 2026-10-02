package com.squadio.app;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Capacitor serves the bundled home screen at the app's local origin.
    static final String HOME_URL = "https://localhost/";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Back → walk the WebView history so no page is a dead-end; backing out reaches the home screen.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        // A floating home button → always one tap back to the Squadio home (switch club / add a link),
        // independent of the hardware/gesture Back button (which some launchers intercept).
        addHomeButton();
    }

    private void addHomeButton() {
        try {
            Button home = new Button(this);
            home.setText("⌂");
            home.setTextColor(Color.WHITE);
            home.setTextSize(20);
            home.setAllCaps(false);
            home.setPadding(0, 0, 0, 0);

            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.OVAL);
            bg.setColor(Color.parseColor("#E60C1324"));
            bg.setStroke(dp(1), Color.parseColor("#3B82F6"));
            home.setBackground(bg);

            int size = dp(46);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(size, size);
            lp.gravity = Gravity.BOTTOM | Gravity.LEFT;
            lp.setMargins(dp(12), 0, 0, dp(96));
            home.setLayoutParams(lp);

            home.setOnClickListener(v -> {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) webView.loadUrl(HOME_URL);
            });

            addContentView(home, lp);
        } catch (Exception ignored) {
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
