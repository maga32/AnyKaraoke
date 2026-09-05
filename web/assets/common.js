const DWEET_ORIGIN = "https://dweet.cc";
const ROOM_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function createRoomId(characterLength = 24) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  while (result.length < characterLength) {
    const bytes = crypto.getRandomValues(new Uint8Array(characterLength));
    for (const byte of bytes) {
      if (byte < 248) result += alphabet[byte % alphabet.length];
      if (result.length === characterLength) break;
    }
  }
  return result;
}

export function isValidRoom(room) {
  return typeof room === "string" && ROOM_PATTERN.test(room);
}

export function parseYouTubeUrl(value) {
  let url;
  try {
    let normalized = String(value).trim();
    if (/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(normalized)) normalized = `https://${normalized}`;
    url = new URL(normalized);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  let id = "";
  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) id = parts[1] || "";
    }
  }

  if (!VIDEO_ID_PATTERN.test(id)) return null;
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

export function isValidSong(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (!VIDEO_ID_PATTERN.test(item.id)) return false;
  if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 160) return false;
  const parsed = parseYouTubeUrl(item.url);
  return Boolean(parsed && parsed.id === item.id);
}

export function validateMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const { source, type, payload } = message;
  if (source === "main" && type === "list" && Array.isArray(payload) && payload.length <= 200 && payload.every(isValidSong)) {
    return { source, type, payload: payload.map(song => ({ id: song.id, url: song.url, title: song.title.trim() })) };
  }
  if (source === "remote" && type === "request_list" && payload && typeof payload === "object") {
    return { source, type, payload: {} };
  }
  if (source === "remote" && type === "command" && payload && typeof payload === "object" && typeof payload.action === "string") {
    return { source, type, payload };
  }
  return null;
}

export function extractDweetMessage(rawEventData) {
  try {
    const outer = JSON.parse(rawEventData);
    const content = outer?.content ?? outer?.with?.content ?? outer;
    const candidate = typeof content?.data === "string" ? JSON.parse(content.data) : content?.data ?? content;
    return validateMessage(candidate);
  } catch {
    return null;
  }
}

export function createDweetChannel(room, { onMessage, onStatus } = {}) {
  if (!isValidRoom(room)) throw new Error(t("invalidRoom"));
  const encodedRoom = encodeURIComponent(room);
  const events = new EventSource(`${DWEET_ORIGIN}/listen/for/dweets/from/${encodedRoom}`);

  events.onopen = () => onStatus?.("connected");
  events.onerror = () => onStatus?.("disconnected");
  events.onmessage = event => {
    const message = extractDweetMessage(event.data);
    if (message) onMessage?.(message);
  };

  async function send(message) {
    const valid = validateMessage(message);
    if (!valid) throw new Error(t("invalidMessage"));
    const url = new URL(`${DWEET_ORIGIN}/dweet/for/${encodedRoom}`);
    url.searchParams.set("data", JSON.stringify(valid));
    if (valid.source === "main" && valid.type === "list") {
      url.searchParams.set("list", JSON.stringify(valid.payload));
    }
    const response = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
    if (!response.ok) throw new Error(t("sendFailed", { status: response.status }));
    return response.json();
  }

  return { send, close: () => events.close() };
}

export async function getLatestList(room) {
  if (!isValidRoom(room)) throw new Error(t("invalidRoom"));
  const response = await fetch(`${DWEET_ORIGIN}/get/latest/key/for/${encodeURIComponent(room)}/list`, {
    method: "GET", mode: "cors", cache: "no-store"
  });
  if (!response.ok) return null;
  let value = await response.json();
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const message = validateMessage({ source: "main", type: "list", payload: value });
  return message?.payload ?? null;
}

export function setConnectionLabel(element, state) {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = t(state === "connected" ? "connected" : state === "disconnected" ? "reconnecting" : "connecting");
}
import { t } from "/assets/i18n.js";
