(() => {
  "use strict";

  const SCRIPT_VERSION = "0.1.3";

  if (window.__YTLP_VERSION === SCRIPT_VERSION) {
    return;
  }
  window.__YTLP_VERSION = SCRIPT_VERSION;

  const state = {
    items: [],
    selected: new Set(),
    lastIndex: null,
    toolbar: null,
    count: null,
    scanTimer: null,
    toastTimer: null
  };

  const normalizeVideoUrl = (href) => {
    if (!href) return null;

    let url;
    try {
      url = new URL(href, location.origin);
    } catch {
      return null;
    }

    if (!/(\.|^)youtube\.com$/i.test(url.hostname)) return null;
    if (url.pathname !== "/watch") return null;

    const videoId = url.searchParams.get("v");
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;

    return `https://www.youtube.com/watch?v=${videoId}`;
  };

  const findCard = (anchor) => {
    const selectors = [
      "ytd-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-rich-item-renderer",
      "ytd-playlist-video-renderer",
      "ytd-compact-video-renderer",
      "ytm-video-with-context-renderer",
      "ytm-compact-video-renderer",
      "#dismissible",
      "li",
      "[class*='video']",
      "[class*='item']"
    ];

    for (const selector of selectors) {
      const candidate = anchor.closest(selector);
      if (!candidate || candidate === document.body || candidate === document.documentElement) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 70) return candidate;
    }

    return anchor;
  };

  const getVideoTitle = (anchor) => {
    const title =
      anchor.getAttribute("title") ||
      anchor.getAttribute("aria-label") ||
      anchor.textContent;
    return title ? title.trim() : "";
  };

  const getOrderedVideoLinks = () => {
    const seen = new Set();
    const items = [];

    const anchors = document.querySelectorAll(
      "a#video-title[href], a#thumbnail[href], a.yt-simple-endpoint[href], a[href*='/watch?v=']"
    );

    for (const anchor of anchors) {
      const url = normalizeVideoUrl(anchor.href);
      if (!url || seen.has(url)) continue;

      const card = findCard(anchor);
      if (card.closest(".ytlp-toolbar, .ytlp-toast")) continue;

      seen.add(url);
      items.push({
        anchor,
        card,
        url,
        title: getVideoTitle(anchor)
      });
    }

    return items;
  };

  const ensureToolbar = () => {
    if (state.toolbar) return;

    const toolbar = document.createElement("div");
    toolbar.className = "ytlp-toolbar";
    toolbar.innerHTML = `
      <span class="ytlp-count">已选 0 / 0</span>
      <button class="ytlp-button ytlp-button-primary" type="button" data-action="copy">复制链接</button>
      <button class="ytlp-button" type="button" data-action="select-all">全选本页</button>
      <button class="ytlp-button" type="button" data-action="clear">清空</button>
    `;

    toolbar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      if (button.dataset.action === "copy") copySelectedLinks();
      if (button.dataset.action === "select-all") {
        state.items.forEach((_, index) => state.selected.add(index));
        state.lastIndex = state.items.length ? state.items.length - 1 : null;
        renderSelection();
      }
      if (button.dataset.action === "clear") {
        state.selected.clear();
        state.lastIndex = null;
        renderSelection();
      }
    });

    document.documentElement.appendChild(toolbar);
    state.toolbar = toolbar;
    state.count = toolbar.querySelector(".ytlp-count");
  };

  const showToast = (message) => {
    clearTimeout(state.toastTimer);
    document.querySelector(".ytlp-toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "ytlp-toast";
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    state.toastTimer = setTimeout(() => toast.remove(), 2200);
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };

  const copySelectedLinks = async () => {
    const indexes = [...state.selected].sort((a, b) => a - b);
    const links = indexes.map((index) => state.items[index]?.url).filter(Boolean);

    if (!links.length) {
      showToast("还没有选择视频");
      return { ok: false, copied: 0, error: "还没有选择视频" };
    }

    try {
      await copyText(links.join("\n"));
      showToast(`已复制 ${links.length} 个链接`);
      return { ok: true, copied: links.length };
    } catch (error) {
      console.error("[YTLP] Copy failed", error);
      showToast("复制失败，可能需要点击插件弹窗后再试");
      return { ok: false, copied: 0, error: "复制失败" };
    }
  };

  const toggleIndex = (index) => {
    if (state.selected.has(index)) {
      state.selected.delete(index);
    } else {
      state.selected.add(index);
    }
    state.lastIndex = index;
  };

  const getEventPoint = (event) => {
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
    return { x: event.clientX, y: event.clientY };
  };

  const getThumbnailElement = (card) =>
    card.querySelector("ytd-thumbnail") ||
    card.querySelector("a#thumbnail") ||
    card.querySelector("#thumbnail") ||
    card.querySelector("yt-thumbnail-view-model") ||
    card.querySelector(".yt-thumbnail-view-model");

  const isInsideThumbnailArea = (event, card) => {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest(".ytlp-check, .ytlp-toolbar, .ytlp-toast")) return false;
    if (target.closest("a#video-title, #video-title-link, h3, ytd-channel-name, #channel-name")) return false;
    if (target.closest("button, yt-icon-button, ytd-menu-renderer, #button, #menu")) return false;

    const thumbnail = getThumbnailElement(card);

    if (!thumbnail) return false;

    const rect = thumbnail.getBoundingClientRect();
    const point = getEventPoint(event);
    return (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    );
  };

  const findThumbnailItemFromEvent = (event) => {
    const target = event.target;
    const directCard = target instanceof Element ? target.closest(".ytlp-card") : null;
    if (directCard) {
      const index = Number(directCard.dataset.ytlpIndex);
      if (!Number.isNaN(index) && state.items[index] && isInsideThumbnailArea(event, directCard)) {
        return { item: state.items[index], index };
      }
    }

    for (let index = 0; index < state.items.length; index += 1) {
      const item = state.items[index];
      if (isInsideThumbnailArea(event, item.card)) return { item, index };
    }

    return null;
  };

  const blockNavigation = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const handleGlobalThumbnailEvent = (event) => {
    const match = findThumbnailItemFromEvent(event);
    if (!match) return;

    blockNavigation(event);

    if (event.type === "click") {
      toggleIndex(match.index);
      renderSelection();
    }
  };

  if (window.__YTLP_GLOBAL_HANDLER) {
    for (const type of window.__YTLP_GLOBAL_HANDLER.types) {
      document.removeEventListener(type, window.__YTLP_GLOBAL_HANDLER.handle, true);
    }
  }

  window.__YTLP_GLOBAL_HANDLER = {
    types: ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick", "touchstart", "touchend"],
    handle: handleGlobalThumbnailEvent
  };

  for (const type of window.__YTLP_GLOBAL_HANDLER.types) {
    document.addEventListener(type, window.__YTLP_GLOBAL_HANDLER.handle, true);
  }

  const renderSelection = () => {
    state.items.forEach((item, index) => {
      item.card.classList.toggle("ytlp-selected", state.selected.has(index));
      const check = item.card.querySelector(":scope > .ytlp-check");
      if (check) check.setAttribute("aria-checked", state.selected.has(index) ? "true" : "false");
    });

    if (state.count) {
      state.count.textContent = `已选 ${state.selected.size} / ${state.items.length}`;
    }
  };

  const attachCheck = (item, index) => {
    item.card.classList.add("ytlp-card");
    item.card.dataset.ytlpIndex = String(index);

    const toggleCurrentCard = (event) => {
      blockNavigation(event);
      const currentIndex = Number(item.card.dataset.ytlpIndex);
      if (Number.isNaN(currentIndex)) return;
      toggleIndex(currentIndex);
      renderSelection();
    };

    const toggleThumbnailClick = (event) => {
      if (!isInsideThumbnailArea(event, item.card)) return;
      toggleCurrentCard(event);
    };

    let check = item.card.querySelector(":scope > .ytlp-check");
    if (check?.dataset.ytlpButtonVersion !== SCRIPT_VERSION) {
      check?.remove();
      check = document.createElement("button");
      check.type = "button";
      check.className = "ytlp-check";
      check.title = "选择或取消当前视频";
      check.dataset.ytlpButtonVersion = SCRIPT_VERSION;
      check.setAttribute("aria-label", "选择视频");
      item.card.prepend(check);

      check.addEventListener("pointerdown", blockNavigation, true);
      check.addEventListener("mousedown", blockNavigation, true);
      check.addEventListener("mouseup", blockNavigation, true);
      check.addEventListener("click", toggleCurrentCard, true);
    }
    check.setAttribute("aria-checked", state.selected.has(index) ? "true" : "false");

    if (item.card.dataset.ytlpCardClickVersion !== SCRIPT_VERSION) {
      item.card.dataset.ytlpCardClickVersion = SCRIPT_VERSION;
      item.card.addEventListener("click", toggleThumbnailClick, true);
      item.card.addEventListener("auxclick", toggleThumbnailClick, true);
    }

    const thumbnailContainer = getThumbnailElement(item.card);
    thumbnailContainer?.classList.add("ytlp-thumbnail-select");

    const thumbnailLinks = item.card.querySelectorAll("a#thumbnail[href], ytd-thumbnail a[href]");
    thumbnailLinks.forEach((thumbnailLink) => {
      if (thumbnailLink.dataset.ytlpThumbnailReady === SCRIPT_VERSION) return;

      thumbnailLink.dataset.ytlpThumbnailReady = SCRIPT_VERSION;
      thumbnailLink.classList.add("ytlp-thumbnail-select");
      thumbnailLink.title = "点击封面选择或取消当前视频；点击标题打开视频";
      thumbnailLink.addEventListener("click", toggleCurrentCard, true);
    });

    const imageLinks = item.card.querySelectorAll("a[href*='/watch?v=']");
    imageLinks.forEach((link) => {
      const isTitle = link.matches("a#video-title, #video-title-link, a[aria-label][id='video-title']");
      const hasImage = Boolean(link.querySelector("img, yt-image, ytd-thumbnail"));
      if (isTitle || !hasImage || link.dataset.ytlpThumbnailReady === SCRIPT_VERSION) return;

      link.dataset.ytlpThumbnailReady = SCRIPT_VERSION;
      link.classList.add("ytlp-thumbnail-select");
      link.title = "点击封面选择或取消当前视频；点击标题打开视频";
      link.addEventListener("click", toggleCurrentCard, true);
    });
  };

  const scan = () => {
    ensureToolbar();

    const selectedUrls = new Set(
      [...state.selected].map((index) => state.items[index]?.url).filter(Boolean)
    );

    state.items = getOrderedVideoLinks();
    state.selected.clear();

    state.items.forEach((item, index) => {
      attachCheck(item, index);
      if (selectedUrls.has(item.url)) state.selected.add(index);
    });

    renderSelection();
  };

  const scheduleScan = () => {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scan, 300);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "YTLP_COPY_SELECTED") {
      copySelectedLinks().then(sendResponse);
      return true;
    }

    if (message?.type === "YTLP_SCAN") {
      scan();
      sendResponse({ ok: true, count: state.items.length, selected: state.selected.size });
    }

    return false;
  });

  scan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
