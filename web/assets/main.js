import { createRoomId, isValidRoom, createDweetChannel, getLatestList, isValidSong, setConnectionLabel } from "/assets/common.js";
import { applyTranslations, t } from "/assets/i18n.js";

applyTranslations();

const elements = {
  stage: document.querySelector("#stage"),
  currentTitle: document.querySelector("#current-title"),
  nextTitle: document.querySelector("#next-title"),
  queueList: document.querySelector("#queue-list"),
  queueEmpty: document.querySelector("#queue-empty"),
  queueCount: document.querySelector("#queue-count"),
  keyValue: document.querySelector("#key-value"),
  queuePanel: document.querySelector("#queue-panel"),
  emptyPlayer: document.querySelector("#empty-player"),
  playerNotice: document.querySelector("#player-notice"),
  connection: document.querySelector("#connection"),
  fullscreen: document.querySelector("#fullscreen-button"),
  emptyQr: document.querySelector("#empty-qr"),
  panelQr: document.querySelector("#panel-qr"),
  emptyUrl: document.querySelector("#empty-remote-url"),
  panelUrl: document.querySelector("#panel-remote-url")
};

const pitchDialog = document.querySelector("#pitch-dialog");
const pitchEnable = document.querySelector("#pitch-enable");
const pitchSkip = document.querySelector("#pitch-skip");
const hasNativePitchControl = typeof window.PitchControl !== "undefined";

const params = new URLSearchParams(location.search);
let room = params.get("room");
const shouldRestore = isValidRoom(room);
if (!isValidRoom(room)) {
  room = createRoomId();
  params.set("room", room);
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

const webPitchChannel = hasNativePitchControl ? null : new BroadcastChannel(`anykaraoke-pitch-${room}`);
if (!hasNativePitchControl) {
  window.PitchControl = {
    setPitch(value) {
      webPitchChannel.postMessage({ type: "pitch", semitones: value });
    }
  };
  webPitchChannel.addEventListener("message", event => {
    if (event.data?.type === "ready") {
      webPitchChannel.postMessage({ type: "pitch", semitones: key });
    }
  });
  pitchDialog.showModal();
  pitchSkip.addEventListener("click", () => pitchDialog.close());
  pitchEnable.addEventListener("click", () => {
    const processorUrl = new URL("/pitch/", location.origin);
    processorUrl.searchParams.set("room", room);
    const popup = window.open(processorUrl, `anykaraoke-pitch-${room}`, "popup,width=520,height=420");
    if (!popup) {
      showNotice(t("popupBlocked"), true);
      return;
    }
    pitchDialog.close();
    webPitchChannel.postMessage({ type: "pitch", semitones: key });
  });
}

const remoteUrl = new URL("/remote/", location.origin);
remoteUrl.searchParams.set("room", room);
for (const anchor of [elements.emptyUrl, elements.panelUrl]) {
  anchor.href = remoteUrl.href;
  anchor.textContent = remoteUrl.href;
}

let songs = [];
let key = 0;
let listOpen = false;
let player = null;
let playerReady = false;
let pendingLoad = null;
let channel;
let connectionState = "connecting";
let keyFlashTimer;
let tempo = 1;

function drawQr(target) {
  if (!window.QRCode) return;
  target.replaceChildren();
  new window.QRCode(target, { text: remoteUrl.href, width: 148, height: 148, colorDark: "#08070b", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
}
drawQr(elements.emptyQr);
drawQr(elements.panelQr);

function makeMarqueeText(text) {
  const wrap = document.createElement("div");
  wrap.className = "marquee-wrap";
  const span = document.createElement("span");
  span.textContent = text;
  wrap.append(span);
  requestAnimationFrame(() => {
    if (span.scrollWidth > wrap.clientWidth) wrap.classList.add("is-overflowing");
  });
  return wrap;
}

function render() {
  const current = songs[0];
  elements.currentTitle.textContent = current?.title || t("noSongs");
  elements.nextTitle.textContent = songs[1]?.title || t("noNext");
  elements.keyValue.textContent = key > 0 ? `+${key}` : String(key);
  elements.queueCount.textContent = t("songsCount", { count: Math.max(0, songs.length - 1) });
  elements.queueList.replaceChildren();

  songs.slice(1).forEach((song, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    number.className = "queue-number";
    number.textContent = String(index + 1).padStart(2, "0");
    item.append(number, makeMarqueeText(song.title));
    elements.queueList.append(item);
  });
  elements.queueEmpty.hidden = songs.length > 1;
  elements.emptyPlayer.hidden = Boolean(current);
  requestAnimationFrame(updateTopMarquees);
}

function updateTopMarquees() {
  document.querySelectorAll(".title-viewport").forEach(viewport => {
    const title = viewport.firstElementChild;
    const shift = Math.max(0, title.scrollWidth - viewport.clientWidth);
    viewport.classList.toggle("is-overflowing", shift > 2);
    viewport.style.setProperty("--marquee-shift", `${shift}px`);
  });
}

function setListOpen(open) {
  listOpen = open;
  elements.stage.classList.toggle("list-open", open);
  elements.queuePanel.setAttribute("aria-hidden", String(!open));
}

async function broadcastList() {
  try {
    await channel.send({ source: "main", type: "list", payload: songs });
  } catch (error) {
    showNotice(error.message, true);
  }
}

function showNotice(message, persist = false) {
  elements.playerNotice.textContent = message;
  elements.playerNotice.hidden = false;
  if (!persist) setTimeout(() => { elements.playerNotice.hidden = true; }, 3500);
}

function flashKey() {
  clearTimeout(keyFlashTimer);
  elements.connection.dataset.state = "connected";
  elements.connection.textContent = t("keyStatus", { key: key > 0 ? `+${key}` : key });
  keyFlashTimer = setTimeout(() => {
    keyFlashTimer = null;
    setConnectionLabel(elements.connection, connectionState);
  }, 1600);
}

function flashTempo() {
  clearTimeout(keyFlashTimer);
  elements.connection.dataset.state = "connected";
  elements.connection.textContent = t("tempoStatus", { tempo: `${tempo}×` });
  keyFlashTimer = setTimeout(() => {
    keyFlashTimer = null;
    setConnectionLabel(elements.connection, connectionState);
  }, 1600);
}

function changeTempo(action) {
  if (!playerReady || !player) return;
  const rates = player.getAvailablePlaybackRates();
  if (!Array.isArray(rates) || !rates.length) return;
  const current = player.getPlaybackRate();
  let target = 1;
  if (action === "tempo_down") target = [...rates].reverse().find(rate => rate < current) ?? rates[0];
  if (action === "tempo_up") target = rates.find(rate => rate > current) ?? rates[rates.length - 1];
  if (target === current) {
    tempo = current;
    flashTempo();
  } else {
    player.setPlaybackRate(target);
  }
}

function setKey(nextKey, { flash = true } = {}) {
  key = Math.max(-6, Math.min(6, nextKey));
  render();
  if (flash) flashKey();
  window.PitchControl?.setPitch(key);
}

window.PitchControl?.setPitch(key);

function loadCurrent(autoplay) {
  const current = songs[0];
  tempo = 1;
  pendingLoad = current ? { id: current.id, autoplay } : null;
  if (!playerReady) return;
  if (!current) {
    player?.stopVideo();
    return;
  }
  elements.emptyPlayer.hidden = true;
  if (autoplay) player.loadVideoById(current.id);
  else player.cueVideoById(current.id);
  pendingLoad = null;
}

async function advance({ autoplay }) {
  setKey(0, { flash: false });
  if (songs.length) songs.shift();
  render();
  loadCurrent(autoplay);
  await broadcastList();
}

function validCommand(payload) {
  const simple = new Set(["play", "pause", "cancel_current", "key_up", "key_down", "key_reset", "tempo_down", "tempo_reset", "tempo_up", "open_list", "close_list"]);
  if (simple.has(payload.action)) return true;
  if (payload.action === "seek_forward") return payload.seconds === 5 || payload.seconds === undefined;
  if (["enqueue", "enqueue_priority"].includes(payload.action)) return isValidSong(payload.item);
  if (payload.action === "cancel_queued") return typeof payload.id === "string";
  return false;
}

async function handleCommand(payload) {
  if (!validCommand(payload)) return;
  switch (payload.action) {
    case "play": playerReady && player?.playVideo(); break;
    case "pause": playerReady && player?.pauseVideo(); break;
    case "seek_forward":
      if (playerReady) player.seekTo(player.getCurrentTime() + 5, true);
      break;
    case "cancel_current": await advance({ autoplay: false }); break;
    case "key_up": setKey(key + 1); break;
    case "key_down": setKey(key - 1); break;
    case "key_reset": setKey(0); break;
    case "tempo_down":
    case "tempo_reset":
    case "tempo_up": changeTempo(payload.action); break;
    case "open_list": setListOpen(true); break;
    case "close_list": setListOpen(false); break;
    case "enqueue": {
      const wasEmpty = songs.length === 0;
      songs.push({ id: payload.item.id, url: payload.item.url, title: payload.item.title.trim() });
      if (wasEmpty) setKey(0, { flash: false });
      render();
      if (wasEmpty) loadCurrent(true);
      await broadcastList();
      break;
    }
    case "enqueue_priority": {
      const wasEmpty = songs.length === 0;
      const item = { id: payload.item.id, url: payload.item.url, title: payload.item.title.trim() };
      if (wasEmpty) songs.push(item); else songs.splice(1, 0, item);
      if (wasEmpty) setKey(0, { flash: false });
      render();
      if (wasEmpty) loadCurrent(true);
      await broadcastList();
      break;
    }
    case "cancel_queued": {
      const index = songs.findIndex((song, songIndex) => songIndex > 0 && song.id === payload.id);
      if (index !== -1) {
        songs.splice(index, 1);
        render();
        await broadcastList();
      }
      break;
    }
  }
}

channel = createDweetChannel(room, {
  onStatus: status => {
    connectionState = status;
    if (!keyFlashTimer) setConnectionLabel(elements.connection, status);
  },
  onMessage: message => {
    if (message.source !== "remote") return;
    if (message.type === "request_list") broadcastList();
    if (message.type === "command") handleCommand(message.payload);
  }
});

if (shouldRestore) {
  getLatestList(room).then(restored => {
    if (!restored || songs.length) return;
    songs = restored;
    render();
    loadCurrent(false);
    broadcastList();
  }).catch(() => showNotice(t("restoreFailed")));
}

elements.fullscreen.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    showNotice(t("fullscreenFailed"));
  }
});

window.onYouTubeIframeAPIReady = () => {
  player = new window.YT.Player("youtube-player", {
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 1,
      controls: 0,
      rel: 0,
      playsinline: 1,
      modestbranding: 1,
      origin: location.origin
    },
    events: {
      onReady: () => {
        playerReady = true;
        if (pendingLoad) loadCurrent(pendingLoad.autoplay);
      },
      onStateChange: event => {
        if (event.data !== window.YT.PlayerState.UNSTARTED) elements.playerNotice.hidden = true;
        if (event.data === window.YT.PlayerState.ENDED) advance({ autoplay: true });
      },
      onPlaybackRateChange: event => {
        tempo = event.data;
        flashTempo();
      },
      onError: event => {
        const messages = {
          2: t("invalidVideo"),
          5: t("html5Unavailable"),
          100: t("unavailableVideo"),
          101: t("embedDenied"), 150: t("embedDenied"), 153: t("unidentifiedRequest")
        };
        console.warn(`YouTube player error: ${event.data}`);
        showNotice(`${messages[event.data] || t("cannotPlay")} ${t("cancelFromRemote")}`, true);
      }
    }
  });
};

const youtubeApi = document.createElement("script");
youtubeApi.src = "https://www.youtube.com/iframe_api";
youtubeApi.onerror = () => showNotice(t("youtubeLoadFailed"), true);
document.head.append(youtubeApi);

window.addEventListener("beforeunload", () => channel.close());
window.addEventListener("resize", updateTopMarquees);
render();
