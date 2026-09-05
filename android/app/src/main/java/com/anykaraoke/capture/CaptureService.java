package com.anykaraoke.capture;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.AudioManager;
import android.media.PlaybackParams;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

public final class CaptureService extends Service {
    public static final String ACTION_START = "com.anykaraoke.capture.START";
    public static final String ACTION_STOP = "com.anykaraoke.capture.STOP";
    public static final String ACTION_SET_PITCH = "com.anykaraoke.capture.SET_PITCH";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_SEMITONES = "semitones";

    private static final String TAG = "AnyKaraokeCapture";
    private static final String CHANNEL_ID = "pitch_capture";
    private static final int NOTIFICATION_ID = 41;
    private static final int SAMPLE_RATE = 48000;

    private volatile boolean running;
    private volatile int semitones;
    private MediaProjection projection;
    private AudioRecord recorder;
    private AudioTrack output;
    private AudioManager audioManager;
    private boolean musicWasMuted;
    private boolean mutedOriginal;
    private int originalAlarmVolume;
    private boolean adjustedAlarmVolume;
    private Thread audioThread;
    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            running = false;
            stopSelf();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        audioManager = getSystemService(AudioManager.class);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_NOT_STICKY;
        switch (intent.getAction()) {
            case ACTION_START:
                semitones = intent.getIntExtra(EXTRA_SEMITONES, 0);
                startForeground(NOTIFICATION_ID, notification(getString(R.string.capture_preparing)));
                startCapture(intent);
                break;
            case ACTION_SET_PITCH:
                semitones = Math.max(-6, Math.min(6, intent.getIntExtra(EXTRA_SEMITONES, 0)));
                applyPitch();
                updateNotification();
                break;
            case ACTION_STOP:
                stopCapture();
                stopSelf();
                break;
        }
        return START_NOT_STICKY;
    }

    private void startCapture(Intent intent) {
        if (running) return;
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
        Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) {
            stopSelf();
            return;
        }
        projection.registerCallback(projectionCallback, new Handler(Looper.getMainLooper()));

        AudioPlaybackCaptureConfiguration captureConfig =
                new AudioPlaybackCaptureConfiguration.Builder(projection)
                        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                        .build();
        AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build();
        int recordMin = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        int playMin = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferSize = Math.max(16384, Math.max(recordMin, playMin) * 2);

        recorder = new AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize)
                .setAudioPlaybackCaptureConfig(captureConfig)
                .build();
        AudioFormat outputFormat = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .build();
        AudioAttributes outputAttributes = new AudioAttributes.Builder()
                // USAGE_MEDIA is muted below to suppress the original WebView sound.
                // Route the processed copy through a different volume group and keep
                // it outside the playback-capture filter to avoid feedback.
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_NONE)
                .build();
        output = new AudioTrack.Builder()
                .setAudioAttributes(outputAttributes)
                .setAudioFormat(outputFormat)
                .setBufferSizeInBytes(bufferSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        matchProcessedVolumeToMedia();
        applyPitch();

        running = true;
        recorder.startRecording();
        suppressOriginalAudio();
        output.play();
        audioThread = new Thread(() -> copyAudio(bufferSize), "AnyKaraokeAudioPipe");
        audioThread.setPriority(Thread.MAX_PRIORITY);
        audioThread.start();
        updateNotification();
    }

    private void copyAudio(int bufferSize) {
        byte[] buffer = new byte[bufferSize];
        while (running) {
            int read = recorder.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
            if (read > 0) output.write(buffer, 0, read, AudioTrack.WRITE_BLOCKING);
            else if (read < 0) Log.w(TAG, "AudioRecord read error: " + read);
        }
    }

    private synchronized void applyPitch() {
        if (output == null || output.getState() != AudioTrack.STATE_INITIALIZED) return;
        float pitch = (float) Math.pow(2.0, semitones / 12.0);
        try {
            output.setPlaybackParams(new PlaybackParams()
                    .allowDefaults()
                    .setSpeed(1.0f)
                    .setPitch(pitch)
                    .setAudioFallbackMode(PlaybackParams.AUDIO_FALLBACK_MODE_FAIL));
        } catch (IllegalArgumentException error) {
            Log.e(TAG, "Device rejected pitch " + pitch, error);
        }
    }

    private void suppressOriginalAudio() {
        if (audioManager == null || mutedOriginal) return;
        musicWasMuted = audioManager.isStreamMute(AudioManager.STREAM_MUSIC);
        if (!musicWasMuted) {
            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0);
        }
        mutedOriginal = true;
    }

    private void matchProcessedVolumeToMedia() {
        if (audioManager == null || adjustedAlarmVolume) return;
        int mediaVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        int mediaMax = Math.max(1, audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        int alarmMax = Math.max(1, audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        originalAlarmVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
        int matchingAlarmVolume = Math.round((mediaVolume / (float) mediaMax) * alarmMax);
        try {
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, matchingAlarmVolume, 0);
            adjustedAlarmVolume = true;
        } catch (SecurityException error) {
            Log.w(TAG, "Could not match processed volume to media volume", error);
        }
    }

    private void restoreAlarmVolume() {
        if (audioManager == null || !adjustedAlarmVolume) return;
        try {
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, originalAlarmVolume, 0);
        } catch (SecurityException error) {
            Log.w(TAG, "Could not restore alarm volume", error);
        }
        adjustedAlarmVolume = false;
    }

    private void restoreOriginalAudio() {
        if (audioManager == null || !mutedOriginal) return;
        if (!musicWasMuted) {
            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
        }
        mutedOriginal = false;
    }

    private void stopCapture() {
        running = false;
        if (recorder != null) {
            try { recorder.stop(); } catch (IllegalStateException ignored) { }
        }
        if (audioThread != null) {
            audioThread.interrupt();
            try { audioThread.join(500); } catch (InterruptedException ignored) { }
        }
        if (output != null) {
            try { output.stop(); } catch (IllegalStateException ignored) { }
            output.release();
            output = null;
        }
        if (recorder != null) {
            recorder.release();
            recorder = null;
        }
        if (projection != null) {
            projection.unregisterCallback(projectionCallback);
            projection.stop();
            projection = null;
        }
        restoreOriginalAudio();
        restoreAlarmVolume();
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.notification_channel_description));
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setColor(Color.rgb(252, 52, 92))
                .build();
    }

    private void updateNotification() {
        String key = semitones > 0 ? "+" + semitones : String.valueOf(semitones);
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(getString(R.string.processing_status, key)));
    }

    @Override
    public void onDestroy() {
        stopCapture();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopCapture();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
