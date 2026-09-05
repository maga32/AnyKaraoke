const params = new URLSearchParams(location.search);
const room = params.get("room");
const startButton = document.querySelector("#start");
const status = document.querySelector("#status");
const unsupportedHelp = document.querySelector("#unsupported-help");
const validRoom = typeof room === "string" && /^[A-Za-z0-9-]{16,64}$/.test(room);
const channel = validRoom ? new BroadcastChannel(`anykaraoke-pitch-${room}`) : null;
let session = null;
let semitones = 0;

function setStatus(message, state = "") {
  status.textContent = message;
  status.dataset.state = state;
}

function applyPitch() {
  session?.shifter.port.postMessage({ semitones });
}

function stopSession() {
  if (!session) return;
  const current = session;
  session = null;
  current.stream.getTracks().forEach(track => track.stop());
  current.source.disconnect();
  current.shifter.disconnect();
  current.context.close();
  startButton.disabled = false;
  startButton.textContent = t("restartAudioShare");
}

async function startSession() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(t("unsupportedAudio"));
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: { suppressLocalAudioPlayback: true, restrictOwnAudio: false },
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    systemAudio: "exclude"
  });
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error(t("audioNotShared"));
  }

  const context = new AudioContext({ latencyHint: "interactive" });
  await context.audioWorklet.addModule("/assets/pitch-worklet.js");
  const source = context.createMediaStreamSource(new MediaStream([audioTrack]));
  const shifter = new AudioWorkletNode(context, "karaoke-pitch-shifter");
  source.connect(shifter).connect(context.destination);
  await context.resume();
  session = { stream, context, source, shifter };
  applyPitch();

  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    stopSession();
    setStatus(t("audioStopped"), "error");
  }, { once:true });
  startButton.textContent = t("processingButton");
  setStatus(t("processing", { key: `${semitones > 0 ? "+" : ""}${semitones}` }), "active");
}

channel?.addEventListener("message", event => {
  if (event.data?.type !== "pitch" || !Number.isFinite(event.data.semitones)) return;
  semitones = Math.max(-6, Math.min(6, event.data.semitones));
  applyPitch();
  if (session) setStatus(t("processing", { key: `${semitones > 0 ? "+" : ""}${semitones}` }), "active");
});
channel?.postMessage({ type:"ready" });

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  unsupportedHelp.hidden = true;
  setStatus(t("waitingApproval"));
  try {
    await startSession();
  } catch (error) {
    stopSession();
    startButton.disabled = false;
    const unsupported = error?.name === "NotSupportedError" || error?.message === t("unsupportedAudio") || /^not supported\.?$/i.test(error?.message || "");
    const message = unsupported ? t("unsupportedAudio") : (error?.message || t("pitchStartFailed"));
    setStatus(message, "error");
    unsupportedHelp.hidden = !unsupported;
  }
});

window.addEventListener("beforeunload", () => {
  stopSession();
  channel?.close();
});

if (!validRoom) {
  startButton.disabled = true;
  setStatus(t("invalidConnection"), "error");
}
import { applyTranslations, t } from "/assets/i18n.js";

applyTranslations();
