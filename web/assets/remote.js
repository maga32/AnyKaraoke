import { isValidRoom, parseYouTubeUrl, createDweetChannel, setConnectionLabel } from "/assets/common.js";
import { applyTranslations, t } from "/assets/i18n.js";

applyTranslations();

const elements = {
  error: document.querySelector("#room-error"), controls: document.querySelector("#controls"), connection: document.querySelector("#connection"),
  queueList: document.querySelector("#queue-list"), queueEmpty: document.querySelector("#queue-empty"),
  queueCount: document.querySelector("#queue-count"), form: document.querySelector("#reserve-form"), url: document.querySelector("#youtube-url"),
  titleField: document.querySelector("#title-field"), title: document.querySelector("#song-title"), message: document.querySelector("#form-message"),
  preview: document.querySelector("#preview"),
  actions: document.querySelector("#reserve-actions"), lookup: document.querySelector("#lookup-button"), normal: document.querySelector("#normal-reserve"),
  priority: document.querySelector("#priority-reserve"), favoriteAdd: document.querySelector("#favorite-add"),
  favoritesToggle: document.querySelector("#favorites-toggle"), favoritesContent: document.querySelector("#favorites-content"),
  favoritesList: document.querySelector("#favorites-list"), favoritesEmpty: document.querySelector("#favorites-empty"), toast: document.querySelector("#toast")
};

const FAVORITES_KEY = "anykaraoke-favorites";
const room = new URLSearchParams(location.search).get("room");
let songs = [];
let favorites = loadFavorites();
let selectedVideo = null;
let channel = null;
let toastTimer;
let previewPlayer = null;
let previewPlayerReady = null;
let pendingPreview = null;

function loadFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter(item => {
      const parsed = parseYouTubeUrl(item?.url);
      return parsed && parsed.id === item.id && typeof item.title === "string" && item.title.trim();
    }).map(item => ({ id:item.id, url:item.url, title:item.title.trim().slice(0, 160) }));
  } catch {
    return [];
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    return true;
  } catch {
    toast(t("favoriteSaveFailed"), true);
    return false;
  }
}

function moveFavoriteToTop(item) {
  favorites = [item, ...favorites.filter(favorite => favorite.id !== item.id)];
  const saved = saveFavorites();
  renderFavorites();
  return saved;
}

function setFavoritesOpen(open) {
  elements.favoritesToggle.setAttribute("aria-expanded", String(open));
  elements.favoritesContent.hidden = !open;
}

function renderFavorites() {
  elements.favoritesList.replaceChildren();
  favorites.forEach(favorite => {
    const row = document.createElement("li");
    const title = document.createElement("button");
    title.type = "button";
    title.className = "favorite-title";
    const titleText = document.createElement("span");
    titleText.textContent = favorite.title;
    title.append(titleText);
    title.addEventListener("click", () => {
      moveFavoriteToTop(favorite);
      setFavoritesOpen(false);
      elements.url.value = favorite.url;
      elements.title.value = favorite.title;
      lookupVideo();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "favorite-delete";
    remove.textContent = t("deleteFavorite");
    remove.setAttribute("aria-label", t("deleteFavoriteLabel", { title:favorite.title }));
    remove.addEventListener("click", () => {
      favorites = favorites.filter(item => item.id !== favorite.id);
      if (saveFavorites()) renderFavorites();
    });
    row.append(title, remove);
    elements.favoritesList.append(row);
    requestAnimationFrame(() => {
      const overflowing = titleText.scrollWidth > title.clientWidth;
      title.classList.toggle("is-overflowing", overflowing);
      title.style.setProperty("--favorite-width", `${title.clientWidth}px`);
    });
  });
  elements.favoritesEmpty.hidden = favorites.length > 0;
}

const youtubeApiReady = new Promise((resolve, reject) => {
  if (window.YT?.Player) {
    resolve();
    return;
  }
  window.onYouTubeIframeAPIReady = resolve;
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.onerror = () => reject(new Error(t("checkerLoadFailed")));
  document.head.append(script);
});

async function getPreviewPlayer() {
  await youtubeApiReady;
  if (previewPlayerReady) return previewPlayerReady;
  previewPlayerReady = new Promise(resolve => {
    previewPlayer = new window.YT.Player("preview-player", {
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 0, controls: 0, rel: 0, playsinline: 1, origin: location.origin },
      events: {
        onReady: event => resolve(event.target),
        onStateChange: event => {
          if (event.data === window.YT.PlayerState.CUED) pendingPreview?.resolve();
        },
        onError: event => pendingPreview?.reject(event.data)
      }
    });
  });
  return previewPlayerReady;
}

async function checkEmbeddable(videoId) {
  elements.preview.hidden = false;
  const player = await getPreviewPlayer();
  if (pendingPreview) pendingPreview.reject("cancelled");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingPreview?.videoId === videoId) pendingPreview = null;
      reject("timeout");
    }, 10000);
    pendingPreview = {
      videoId,
      resolve: () => { clearTimeout(timer); pendingPreview = null; resolve(); },
      reject: code => { clearTimeout(timer); pendingPreview = null; reject(code); }
    };
    player.cueVideoById(videoId);
  });
}

function toast(text, error = false) {
  elements.toast.textContent = text;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

async function send(type, payload) {
  try {
    await channel.send({ source: "remote", type, payload });
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

function renderList() {
  const queued = songs.slice(1);
  elements.queueCount.textContent = t("songsCount", { count: queued.length });
  elements.queueList.replaceChildren();
  queued.forEach((song, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    number.className = "queue-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("span");
    title.className = "queue-title";
    title.textContent = song.title;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel-button";
    cancel.textContent = t("cancel");
    cancel.setAttribute("aria-label", t("cancelReservation", { title: song.title }));
    cancel.addEventListener("click", async () => {
      cancel.disabled = true;
      await send("command", { action: "cancel_queued", id: song.id });
      setTimeout(() => { cancel.disabled = false; }, 700);
    });
    item.append(number, title, cancel);
    elements.queueList.append(item);
  });
  elements.queueEmpty.hidden = queued.length > 0;
}

async function lookupVideo() {
  const parsed = parseYouTubeUrl(elements.url.value);
  selectedVideo = null;
  elements.actions.hidden = true;
  elements.titleField.hidden = true;
  elements.preview.hidden = true;
  if (!parsed) {
    elements.message.textContent = t("enterYoutube");
    elements.message.dataset.state = "error";
    return;
  }

  elements.lookup.disabled = true;
  elements.lookup.textContent = t("checking");
  elements.message.textContent = t("checkingVideo");
  elements.message.dataset.state = "loading";
  let title = "";
  let playable = false;
  try {
    await checkEmbeddable(parsed.id);
    playable = true;
    try {
      const endpoint = new URL("https://www.youtube.com/oembed");
      endpoint.searchParams.set("url", parsed.url);
      endpoint.searchParams.set("format", "json");
      const response = await fetch(endpoint, { mode: "cors" });
      if (!response.ok) throw new Error("metadata");
      const metadata = await response.json();
      title = typeof metadata.title === "string" ? metadata.title.trim().slice(0, 160) : "";
    } catch {
      elements.titleField.hidden = false;
      elements.message.textContent = t("titleManual");
      elements.message.dataset.state = "error";
    }
  } catch (error) {
    const code = Number(error);
    if (code === 101 || code === 150) {
      elements.message.textContent = t("cannotReserveEmbed");
      elements.message.dataset.state = "error";
      elements.preview.hidden = true;
      return;
    }
    if (code === 100) {
      elements.message.textContent = t("cannotReserveUnavailable");
      elements.message.dataset.state = "error";
      elements.preview.hidden = true;
      return;
    }
    if (code === 2 || code === 5 || code === 153) {
      elements.message.textContent = t("cannotReservePlayer");
      elements.message.dataset.state = "error";
      elements.preview.hidden = true;
      return;
    }
    elements.titleField.hidden = false;
    elements.message.textContent = error === "timeout" ? t("checkTimeout") : t("titleManual");
    elements.message.dataset.state = "error";
  } finally {
    elements.lookup.disabled = false;
    elements.lookup.textContent = t("check");
  }

  if (playable && title) {
    elements.title.value = title;
    elements.titleField.hidden = false;
    elements.message.textContent = t("videoChecked");
    elements.message.dataset.state = "success";
  }
  if (playable) {
    elements.preview.hidden = true;
    selectedVideo = parsed;
    elements.actions.hidden = false;
  }
}

async function reserve(priority) {
  const parsed = parseYouTubeUrl(elements.url.value);
  const title = elements.title.value.trim();
  if (!selectedVideo || !parsed || parsed.id !== selectedVideo.id) {
    elements.message.textContent = t("linkChanged");
    elements.message.dataset.state = "error";
    elements.actions.hidden = true;
    return;
  }
  if (!title) {
    elements.titleField.hidden = false;
    elements.title.focus();
    elements.message.textContent = t("titleRequired");
    elements.message.dataset.state = "error";
    return;
  }
  const item = { id: parsed.id, url: parsed.url, title: title.slice(0, 160) };
  elements.normal.disabled = true;
  elements.priority.disabled = true;
  const ok = await send("command", { action: priority ? "enqueue_priority" : "enqueue", item });
  elements.normal.disabled = false;
  elements.priority.disabled = false;
  if (ok) {
    toast(t(priority ? "prioritySent" : "reserveSent"));
    elements.form.reset();
    elements.titleField.hidden = true;
    elements.actions.hidden = true;
    elements.preview.hidden = true;
    elements.message.textContent = "";
    selectedVideo = null;
  }
}

function addFavorite() {
  const parsed = parseYouTubeUrl(elements.url.value);
  const title = elements.title.value.trim();
  if (!selectedVideo || !parsed || parsed.id !== selectedVideo.id) {
    elements.message.textContent = t("linkChanged");
    elements.message.dataset.state = "error";
    elements.actions.hidden = true;
    return;
  }
  if (!title) {
    elements.titleField.hidden = false;
    elements.title.focus();
    elements.message.textContent = t("titleRequired");
    elements.message.dataset.state = "error";
    return;
  }
  if (moveFavoriteToTop({ id:parsed.id, url:parsed.url, title:title.slice(0, 160) })) toast(t("favoriteAdded"));
}

if (!isValidRoom(room)) {
  elements.error.hidden = false;
  elements.controls.hidden = true;
  setConnectionLabel(elements.connection, "disconnected");
} else {
  channel = createDweetChannel(room, {
    onStatus: status => {
      setConnectionLabel(elements.connection, status);
      if (status === "connected") send("request_list", {});
    },
    onMessage: message => {
      if (message.source === "main" && message.type === "list") {
        songs = message.payload;
        renderList();
      }
    }
  });
}

document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    const action = button.dataset.action;
    let payload = { action };
    if (action === "seek_forward") payload = { action, seconds: 5 };
    if (action === "quality_mode") payload = { action, mode: button.dataset.qualityMode };
    const ok = await send("command", payload);
    if (ok) toast(t("commandSent", { command: button.textContent.trim() }));
    setTimeout(() => { button.disabled = false; }, 350);
  });
});

elements.form.addEventListener("submit", event => { event.preventDefault(); lookupVideo(); });
elements.url.addEventListener("input", () => {
  selectedVideo = null;
  elements.actions.hidden = true;
  elements.preview.hidden = true;
  elements.message.textContent = "";
});
elements.normal.addEventListener("click", () => reserve(false));
elements.priority.addEventListener("click", () => reserve(true));
elements.favoriteAdd.addEventListener("click", addFavorite);
elements.favoritesToggle.addEventListener("click", () => setFavoritesOpen(elements.favoritesContent.hidden));
window.addEventListener("beforeunload", () => channel?.close());
renderList();
renderFavorites();
