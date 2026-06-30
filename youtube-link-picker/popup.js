const status = document.querySelector("#status");

const isYouTubeUrl = (url) => /^https:\/\/(www|m)\.youtube\.com\//i.test(url || "");

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab;
};

const injectIntoTab = async (tabId) => {
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
  if (!isYouTubeUrl(tab.url)) {
    throw new Error("Open a YouTube page first");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await injectIntoTab(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return chrome.tabs.sendMessage(tab.id, message);
  }
};

const setStatus = (message) => {
  status.textContent = message;
};

document.querySelector("#copy").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab({ type: "YTLP_COPY_SELECTED" });
    if (result?.ok) {
      setStatus(`Copied ${result.copied} links`);
      return;
    }
    setStatus(result?.error || "Copy failed");
  } catch {
    setStatus("Open a YouTube results/list page, then reload or click rescan.");
  }
});

document.querySelector("#scan").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab({ type: "YTLP_SCAN" });
    setStatus(`Found ${result.count} videos, selected ${result.selected}`);
  } catch {
    setStatus("Open a YouTube results/list page, then reload or click rescan.");
  }
});
