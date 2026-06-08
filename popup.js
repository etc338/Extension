document.getElementById('start-btn').addEventListener('click', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes("google.com/maps")) {
        alert("Please navigate to Google Maps and perform a search first!");
        return;
    }

    document.getElementById('status').style.display = 'block';

    chrome.tabs.sendMessage(tab.id, { action: "start" }, (response) => {
        if (chrome.runtime.lastError) {
            // If the content script hasn't been injected yet (e.g. extension was just installed)
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            }, () => {
                chrome.tabs.sendMessage(tab.id, { action: "start" });
            });
        }
    });
});
