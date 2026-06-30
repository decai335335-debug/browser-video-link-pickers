(() => {
  "use strict";

  const SCRIPT_VERSION = "0.2.0";

  if (window.__BFLP_VERSION === SCRIPT_VERSION) {
    return;
  }
  window.__BFLP_VERSION = SCRIPT_VERSION;

  const VIDEO_URL_RE = /(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]+)/i;
  const SHORT_VIDEO_RE = /^\/video\/(BV[0-9A-Za-z]+)/i;
  const state = {
    items: [],
    selected: new Set(),
    lastIndex: null,
    toolbar: null,
    count: null,
    toastTimer: null,
    scanTimer: null
  };

  const normalizeVideoUrl = (href) => {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, location.origin);
    } catch {
      return null;
    }

    const match = url.href.match(VIDEO_URL_RE) || url.pathname.match(SHORT_VIDEO_RE);
    if (!match) return null;

    return `https://www.bilibili.com/video/${match[1]}`;
  };

  const getVideoTitle = (anchor) => {
    const text = anchor.textContent.trim();
    if (text) return text;
    const title = anchor.getAttribute("title") || anchor.getAttribute("aria-label");
    return title ? title.trim() : "";
  };

  const findCard = (anchor) => {
    const selectors = [
      ".fav-video-card",
      ".small-item",
      ".bili-video-card",
      ".bili-video-card__wrap",
      ".video-card",
      ".feed-card",
      ".card-box",
      "li",
      "[class*='video-card']",
      "[class*='fav']",
      "[class*='video']",
      "[class*='item']"
    ];

    for (const selector of selectors) {
      const candidate = anchor.closest(selector);
      if (candidate && candidate !== document.body && candidate !== document.documentElement) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width >= 80 && rect.height >= 50) return candidate;
      }
    }

    return anchor;
  };

  const getOrderedAnchors = () => {
    const seen = new Set();
    const anchors = [];

    for (const anchor of document.querySelectorAll("a[href]")) {
      const url = normalizeVideoUrl(anchor.href);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      anchors.push({ anchor, url, title: getVideoTitle(anchor) });
    }

    return anchors;
  };

  const ensureToolbar = () => {
    if (state.toolbar) return;

    const toolbar = document.createElement("div");
    toolbar.className = "bflp-toolbar";
    toolbar.innerHTML = `
      <span class="bflp-count">已选 0 / 0</span>
      <button class="bflp-button bflp-button-primary" type="button" data-action="copy">复制链接</button>
      <button class="bflp-button" type="button" data-action="select-all">全选本页</button>
      <button class="bflp-button" type="button" data-action="clear">清空</button>
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
    state.count = toolbar.querySelector(".bflp-count");
  };

  const showToast = (message) => {
    clearTimeout(state.toastTimer);
    document.querySelector(".bflp-toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "bflp-toast";
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
      console.error("[BFLP] Copy failed", error);
      showToast("复制失败，可能需要点击插件弹窗后再试");
      return { ok: false, copied: 0, error: "复制失败" };
    }
  };

  const toggleIndex = (index) => {
    if (state.selected.has(index)) state.selected.delete(index);
    else state.selected.add(index);
    state.lastIndex = index;
  };

  const getEventPoint = (event) => {
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
    return { x: event.clientX, y: event.clientY };
  };

  const getThumbnailElement = (card) =>
    card.querySelector(".bili-video-card__cover") ||
    card.querySelector(".bili-video-card__image") ||
    card.querySelector(".cover") ||
    card.querySelector(".pic") ||
    card.querySelector(".img") ||
    card.querySelector("[class*='cover']") ||
    card.querySelector("[class*='pic']") ||
    card.querySelector("picture") ||
    card.querySelector("img")?.closest("a, .bili-video-card__cover, .cover, .pic, div") ||
    card.querySelector("a[href*='/video/BV']");

  const isInsideThumbnailArea = (event, card) => {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest(".bflp-check, .bflp-toolbar, .bflp-toast")) return false;
    if (target.closest("button, [role='button'], .bili-video-card__stats, .watch-later, [class*='menu']")) return false;
    if (target.closest(".bili-video-card__info, .title, [class*='title'], [class*='author'], [class*='up']")) return false;

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
    const directCard = target instanceof Element ? target.closest(".bflp-card") : null;
    if (directCard) {
      const index = Number(directCard.dataset.bflpIndex);
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

  if (window.__BFLP_GLOBAL_HANDLER) {
    for (const type of window.__BFLP_GLOBAL_HANDLER.types) {
      document.removeEventListener(type, window.__BFLP_GLOBAL_HANDLER.handle, true);
    }
  }

  window.__BFLP_GLOBAL_HANDLER = {
    types: ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick", "touchstart", "touchend"],
    handle: handleGlobalThumbnailEvent
  };

  for (const type of window.__BFLP_GLOBAL_HANDLER.types) {
    document.addEventListener(type, window.__BFLP_GLOBAL_HANDLER.handle, true);
  }

  const renderSelection = () => {
    state.items.forEach((item, index) => {
      item.card.classList.toggle("bflp-selected", state.selected.has(index));
      const check = item.card.querySelector(":scope > .bflp-check");
      if (check) check.setAttribute("aria-checked", state.selected.has(index) ? "true" : "false");
    });

    if (state.count) {
      state.count.textContent = `已选 ${state.selected.size} / ${state.items.length}`;
    }
  };

  const attachCheck = (item, index) => {
    item.card.classList.add("bflp-card");
    item.card.dataset.bflpIndex = String(index);

    const toggleCurrentCard = (event) => {
      blockNavigation(event);
      const currentIndex = Number(item.card.dataset.bflpIndex);
      if (Number.isNaN(currentIndex)) return;
      toggleIndex(currentIndex);
      renderSelection();
    };

    let check = item.card.querySelector(":scope > .bflp-check");
    if (check?.dataset.bflpButtonVersion !== SCRIPT_VERSION) {
      check?.remove();
      check = document.createElement("button");
      check.type = "button";
      check.className = "bflp-check";
      check.title = "选择或取消当前视频";
      check.dataset.bflpButtonVersion = SCRIPT_VERSION;
      check.setAttribute("aria-label", "选择视频");
      item.card.prepend(check);

      check.addEventListener("pointerdown", blockNavigation, true);
      check.addEventListener("mousedown", blockNavigation, true);
      check.addEventListener("mouseup", blockNavigation, true);
      check.addEventListener("click", toggleCurrentCard, true);
    }
    check.setAttribute("aria-checked", state.selected.has(index) ? "true" : "false");

    const thumbnail = getThumbnailElement(item.card);
    thumbnail?.classList.add("bflp-thumbnail-select");

    const thumbnailLinks = item.card.querySelectorAll("a[href*='/video/BV'], a[href*='bilibili.com/video/BV']");
    thumbnailLinks.forEach((link) => {
      if (link.dataset.bflpThumbnailReady === SCRIPT_VERSION) return;
      if (link.closest(".bili-video-card__info, .title, [class*='title']")) return;
      const hasImage = Boolean(link.querySelector("img, picture, [class*='cover'], [class*='pic']"));
      if (!hasImage) return;

      link.dataset.bflpThumbnailReady = SCRIPT_VERSION;
      link.classList.add("bflp-thumbnail-select");
      link.title = "点击封面选择或取消当前视频；点击标题打开视频";
      link.addEventListener("click", toggleCurrentCard, true);
    });
  };

  const scan = () => {
    ensureToolbar();

    const selectedUrls = new Set(
      [...state.selected].map((index) => state.items[index]?.url).filter(Boolean)
    );

    state.items = getOrderedAnchors().map((item) => ({
      ...item,
      card: findCard(item.anchor)
    }));

    state.selected.clear();
    state.items.forEach((item, index) => {
      attachCheck(item, index);
      if (selectedUrls.has(item.url)) state.selected.add(index);
    });

    renderSelection();
  };

  const scheduleScan = () => {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scan, 250);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BFLP_COPY_SELECTED") {
      copySelectedLinks().then(sendResponse);
      return true;
    }
    if (message?.type === "BFLP_SCAN") {
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
