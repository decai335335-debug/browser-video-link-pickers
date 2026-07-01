const status = document.querySelector("#status");

const isBilibiliUrl = (url) => /^https:\/\/([^.]+\.)?bilibili\.com\//i.test(url || "");
const isBilibiliVideoPage = (url) => {
  try {
    return new URL(url).pathname.startsWith("/video/");
  } catch {
    return false;
  }
};

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab;
};

const injectIntoTab = async (tabId) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.__BFLP_ALLOW_PLAYBACK = true;
      window.__BFLP_VERSION = "";
    }
  });

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
};

const sendToActiveTab = async (message) => {
  const tab = await getActiveTab();
  if (!isBilibiliUrl(tab.url)) {
    throw new Error("Open a Bilibili page first");
  }
  const isManualPlaybackInject = isBilibiliVideoPage(tab.url);

  if (isManualPlaybackInject && message.type === "BFLP_SCAN") {
    await injectIntoTab(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = await chrome.tabs.sendMessage(tab.id, message);
    return { ...result, playbackManual: true };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await injectIntoTab(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = await chrome.tabs.sendMessage(tab.id, message);
    if (isManualPlaybackInject && message.type === "BFLP_SCAN") {
      return { ...result, playbackManual: true };
    }
    return result;
  }
};

const setStatus = (message) => {
  status.textContent = message;
};

document.querySelector("#copy").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab({ type: "BFLP_COPY_SELECTED" });
    if (result?.ok) {
      setStatus(`已复制 ${result.copied} 个链接`);
      return;
    }
    setStatus(result?.error || "复制失败");
  } catch {
    setStatus("请打开 B 站视频列表/收藏夹页面，然后刷新或重新识别。");
  }
});

document.querySelector("#scan").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab({ type: "BFLP_SCAN" });
    const suffix = result.playbackManual ? "（播放页手动模式）" : "";
    setStatus(`识别到 ${result.count} 个视频，已选 ${result.selected} 个${suffix}`);
  } catch {
    setStatus("请打开 B 站视频列表/收藏夹页面，然后刷新或重新识别。");
  }
});
