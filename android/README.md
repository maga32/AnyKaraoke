# AnyKaraoke Android 오디오 캡처 검증 앱

Java와 Gradle로 작성한 Android 10(API 29) 이상용 검증 앱이다.

- WebView가 `https://AnyKaraoke.pages.dev/`를 연다.
- 앱을 실행하면 안내창이 바로 나온다. 확인한 뒤 Android 화면 캡처 및 오디오 캡처를 승인한다. Android 14 이상에서는 전체 화면 캡처만 요청한다.
- 별도의 알림 권한을 요청하지 않으며, 하단 네이티브 제어 패널은 표시하지 않는다.
- 앱은 `USAGE_MEDIA` 재생음을 `AudioPlaybackCapture`로 받고 `AudioTrack`의 `PlaybackParams`로 속도 1.0을 유지한 채 피치를 바꿔 출력한다.
- 캡처 중에는 원본 `STREAM_MUSIC`을 음소거하고 처리음은 별도 출력 usage로 재생한다. 처리를 중지하면 앱이 변경한 음소거를 원래 상태로 복구한다.
- 처리 시작 시 기존 미디어 음량 비율을 처리음 경로에 복사한다. 처리 중 하드웨어 음량 버튼은 처리음 음량을 조절하며, 종료하면 임시 사용한 알람 음량과 음량 버튼 대상을 모두 원래대로 복구한다.
- 웹의 키 조절이 `PitchControl.setPitch()`을 통해 앱의 -6~+6 반음 처리에 반영된다. 새 곡은 원키로 초기화된다.
- 상태표시줄은 숨겨진다. 앱을 백그라운드로 내리면 캡처를 유지하면서 원키로 바뀌고, 복귀하면 웹의 마지막 키가 다시 적용된다. 앱을 종료하면 피치 처리를 중지한다.

이 앱의 목적은 기기별로 다음을 직접 확인하는 것이다.

1. WebView의 YouTube 오디오가 캡처되는가.
2. 기기의 `AudioTrack`이 독립적인 피치 변경을 지원하는가.
3. 원음과 처리음이 중복 출력되는가.
4. 영상과 처리음 사이 지연이 어느 정도인가.

## 빌드

JDK 17과 Android SDK 35를 사용한다.

```bash
./gradlew assembleDebug
```

## 설치

```bash
adb install -r dist/AnyKaraoke-audio-capture-debug.apk
```

화면 캡처 승인 창에서는 반드시 오디오 공유를 허용한다. 테스트 중 문제가 생기면 `adb logcat -s AnyKaraokeCapture`로 캡처 오류를 확인한다.
