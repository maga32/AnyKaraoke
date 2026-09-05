package com.anykaraoke.capture;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.media.AudioManager;
import android.media.projection.MediaProjectionManager;
import android.media.projection.MediaProjectionConfig;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int REQUEST_CAPTURE = 1001;
    private static final String APP_URL = "https://AnyKaraoke.pages.dev/";

    private MediaProjectionManager projectionManager;
    private WebView webView;
    private int semitones = 0;
    private boolean capturing = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideStatusBar();
        projectionManager = getSystemService(MediaProjectionManager.class);
        buildUi();
        showCaptureExplanation();
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, String url) {
                        openExternalBrowser(url);
                        popupView.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        webView.addJavascriptInterface(new PitchControlBridge(), "PitchControl");
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        webView.loadUrl(APP_URL);
    }

    private void openExternalBrowser(String url) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (RuntimeException error) {
            Toast.makeText(this, R.string.browser_missing, Toast.LENGTH_SHORT).show();
        }
    }

    private void showCaptureExplanation() {
        new AlertDialog.Builder(this)
                .setMessage(R.string.capture_explanation)
                .setPositiveButton(R.string.confirm, (dialog, which) -> requestCapturePermission())
                .setOnCancelListener(dialog -> finish())
                .show()
                .getButton(AlertDialog.BUTTON_POSITIVE)
                .requestFocus();
    }

    private void requestCapturePermission() {
        Intent captureIntent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            captureIntent = projectionManager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay());
        } else {
            captureIntent = projectionManager.createScreenCaptureIntent();
        }
        startActivityForResult(captureIntent, REQUEST_CAPTURE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE) return;
        if (resultCode != RESULT_OK || data == null) {
            Toast.makeText(this, R.string.capture_permission_required, Toast.LENGTH_SHORT).show();
            return;
        }
        Intent service = new Intent(this, CaptureService.class)
                .setAction(CaptureService.ACTION_START)
                .putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
                .putExtra(CaptureService.EXTRA_RESULT_DATA, data)
                .putExtra(CaptureService.EXTRA_SEMITONES, semitones);
        startForegroundService(service);
        capturing = true;
        // The processed audio uses a separate stream so the original media
        // stream can remain muted. Route the hardware volume keys to it.
        setVolumeControlStream(AudioManager.STREAM_ALARM);
    }

    private void applyStoredPitch() {
        if (capturing) {
            startService(new Intent(this, CaptureService.class)
                    .setAction(CaptureService.ACTION_SET_PITCH)
                    .putExtra(CaptureService.EXTRA_SEMITONES, semitones));
        }
    }

    private final class PitchControlBridge {
        @JavascriptInterface
        public void setPitch(int value) {
            runOnUiThread(() -> {
                semitones = Math.max(-6, Math.min(6, value));
                applyStoredPitch();
            });
        }
    }

    private void hideStatusBar() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void stopCaptureIfRunning() {
        if (!capturing) return;
        stopService(new Intent(this, CaptureService.class).setAction(CaptureService.ACTION_STOP));
        capturing = false;
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideStatusBar();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (capturing) {
            startService(new Intent(this, CaptureService.class)
                    .setAction(CaptureService.ACTION_SET_PITCH)
                    .putExtra(CaptureService.EXTRA_SEMITONES, 0));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideStatusBar();
        applyStoredPitch();
    }

    @Override
    protected void onDestroy() {
        stopCaptureIfRunning();
        setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE);
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
