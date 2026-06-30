let isRunning = false;
window.stopScraping = false;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start") {
        if (!isRunning) {
            startScraping(150);
        }
        sendResponse({ status: "started" });
    }
});

// Helper: Async delay
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Random delay to mimic human behavior
async function randomDelay(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Human-like scroll in small steps
async function humanScroll(element) {
    let currentScroll = element.scrollTop;
    let targetScroll = element.scrollHeight;
    let distance = targetScroll - currentScroll;
    let steps = Math.floor(Math.random() * 4) + 3;
    let stepAmount = distance / steps;

    for (let i = 0; i < steps; i++) {
        currentScroll += stepAmount;
        element.scrollTo(0, currentScroll);
        await randomDelay(150, 400);
    }
    element.scrollTo(0, element.scrollHeight);
}

// Wait for element to appear in DOM
function waitForElement(selector, timeout = 8000) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) return resolve(true);
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(true);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            resolve(false);
        }, timeout);
    });
}

// Show floating progress banner
function showBanner() {
    if (document.getElementById('scraper-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'scraper-banner';
    Object.assign(banner.style, {
        position: 'fixed', bottom: '20px', right: '20px',
        backgroundColor: '#1a73e8', color: 'white',
        padding: '20px', borderRadius: '8px', zIndex: '999999',
        fontFamily: 'sans-serif', boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        minWidth: '250px'
    });
    banner.innerHTML = `
        <h3 style="margin:0 0 10px 0;font-size:18px;">🔍 Google Maps Scraper</h3>
        <p id="scraper-status" style="margin:0 0 15px 0;font-size:14px;">Starting...</p>
        <button id="scraper-stop" style="padding:8px 12px;font-size:14px;cursor:pointer;background:#ff4757;color:white;border:none;border-radius:4px;">Stop & Export</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('scraper-stop').addEventListener('click', () => {
        window.stopScraping = true;
        document.getElementById('scraper-stop').innerText = "Stopping...";
    });
}

function updateBanner(leads, total) {
    const el = document.getElementById('scraper-status');
    if (el) el.innerText = `Checked: ${total} | Leads (No Website): ${leads}`;
}

function removeBanner() {
    const b = document.getElementById('scraper-banner');
    if (b) b.remove();
}

// ─────────────────────────────────────────────
// FIX: Extract data from the currently open detail panel
// Uses multiple fallback selectors to handle Google Maps UI changes
// ─────────────────────────────────────────────
function extractData() {
    const data = {
        Name: "Not available",
        Phone: "Not available",
        Address: "Not available",
        Website: "No Website",
        Email: "Not available",
        SocialLinks: "None",
        Category: "Not available",
        Rating: "Not available",
        Reviews: "Not available",
        Hours: "Not available"
    };

    // ── NAME ──────────────────────────────────
    // Try multiple heading selectors
    const nameSelectors = ['h1.DUwDvf', 'h1[class*="fontHeadlineLarge"]', 'h1'];
    for (const sel of nameSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim()) {
            data.Name = el.innerText.trim();
            break;
        }
    }

    // ── RATING & REVIEWS ─────────────────────
    // aria-label on the star image contains "4.5 stars 120 reviews"
    const ratingEl = document.querySelector('div[role="img"][aria-label*="star"]');
    if (ratingEl) {
        const label = ratingEl.getAttribute('aria-label') || '';
        const ratingMatch = label.match(/(\d+\.?\d*)\s*star/i);
        const reviewMatch = label.match(/([\d,]+)\s*review/i);
        if (ratingMatch) data.Rating = ratingMatch[1];
        if (reviewMatch) data.Reviews = reviewMatch[1];
    }
    // Fallback: look for the visible rating text near stars
    if (data.Rating === "Not available") {
        const ratingText = document.querySelector('span[aria-hidden="true"].ceNzKf, span.MW4etd');
        if (ratingText) data.Rating = ratingText.innerText.trim();
    }

    // ── CATEGORY ─────────────────────────────
    // Category is usually a button or span near the top of the detail pane
    const categorySelectors = [
        'button[jsaction*="category"]',
        'span.DkEaL',
        'button.DkEaL',
        // generic: first small text button after the name
    ];
    for (const sel of categorySelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim()) {
            data.Category = el.innerText.trim();
            break;
        }
    }

    // ── PHONE ─────────────────────────────────
    // Google uses data-item-id="phone:tel:XXXXX" on the phone row button
    const phoneBtn = document.querySelector('[data-item-id^="phone:tel:"]');
    if (phoneBtn) {
        // The actual number is in a child span
        const span = phoneBtn.querySelector('span.Io6YTe, span[jstcache]') || phoneBtn;
        data.Phone = span.innerText.trim() || phoneBtn.getAttribute('data-item-id').replace('phone:tel:', '');
    }

    // ── ADDRESS ───────────────────────────────
    const addressBtn = document.querySelector('[data-item-id="address"]');
    if (addressBtn) {
        const span = addressBtn.querySelector('span.Io6YTe') || addressBtn;
        data.Address = span.innerText.trim();
    }
    // Fallback: look for an element with aria-label containing "address"
    if (data.Address === "Not available") {
        const allBtns = document.querySelectorAll('button[aria-label]');
        for (const btn of allBtns) {
            const lbl = btn.getAttribute('aria-label') || '';
            if (lbl.toLowerCase().includes('address:') || lbl.toLowerCase().includes('located')) {
                data.Address = lbl.replace(/^address:\s*/i, '').trim();
                break;
            }
        }
    }

    // ── WEBSITE ───────────────────────────────
    const websiteLink = document.querySelector('a[data-item-id="authority"]');
    if (websiteLink && websiteLink.href) {
        data.Website = websiteLink.href;
    }
    // Fallback: look for any outbound link that is NOT a google domain
    if (data.Website === "No Website") {
        const allAnchors = document.querySelectorAll('a[href^="http"]');
        for (const a of allAnchors) {
            if (
                !a.href.includes('google.com') &&
                !a.href.includes('google.co.in') &&
                !a.href.includes('goo.gl') &&
                !a.href.includes('maps.google') &&
                a.closest('[jsaction]') // only inside the detail panel
            ) {
                data.Website = a.href;
                break;
            }
        }
    }

    // ── SOCIAL LINKS ──────────────────────────
    const socialDomains = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'youtube.com'];
    const socials = [];
    document.querySelectorAll('a[href]').forEach(a => {
        if (socialDomains.some(d => a.href.includes(d))) {
            socials.push(a.href);
        }
    });
    if (socials.length > 0) data.SocialLinks = [...new Set(socials)].join(' | ');

    // ── EMAIL ─────────────────────────────────
    // Scan the full text of the detail panel for email addresses
    const panelEl = document.querySelector('div[role="main"]') || document.body;
    const panelText = panelEl.innerText || '';
    const emailMatches = panelText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) {
        const filtered = [...new Set(emailMatches)].filter(e =>
            !e.includes('google') && !e.includes('sentry') && !e.includes('example')
        );
        if (filtered.length > 0) data.Email = filtered.join(', ');
    }

    // ── HOURS ─────────────────────────────────
    const hoursSelectors = [
        '[data-item-id="oh"]',
        'button[aria-label*="hour" i]',
        'button[aria-label*="open" i]',
        'div[aria-label*="hour" i]'
    ];
    for (const sel of hoursSelectors) {
        const el = document.querySelector(sel);
        if (el) {
            const label = el.getAttribute('aria-label');
            const text = el.innerText.trim();
            data.Hours = label || text || "Not available";
            if (data.Hours !== "Not available") break;
        }
    }

    return data;
}

// Export collected data as CSV file download
function exportToCSV(results) {
    if (results.length === 0) {
        alert("✅ Scraping finished!\n\nNo leads found without a website.\n\nTry a different search term like 'Plumbers in Ahmedabad'.");
        return;
    }

    const headers = ["Name", "Phone", "Address", "Website", "Email", "SocialLinks", "Category", "Rating", "Reviews", "Hours"];
    const csvRows = [headers.join(',')];

    for (const row of results) {
        const values = headers.map(h => {
            let val = (row[h] || "").toString().replace(/"/g, '""');
            if (/[",\n]/.test(val)) val = `"${val}"`;
            return val;
        });
        csvRows.push(values.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'google_maps_leads.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert(`✅ Done! Exported ${results.length} leads to google_maps_leads.csv`);
}

// ─────────────────────────────────────────────
// MAIN SCRAPING LOOP
// Strategy: iterate the feed list, click each item, extract, go back, repeat
// ─────────────────────────────────────────────
async function startScraping(maxResults) {
    isRunning = true;
    window.stopScraping = false;
    const results = [];
    const processedUrls = new Set();
    let retries = 0;

    showBanner();

    while (processedUrls.size < maxResults && retries < 8 && !window.stopScraping) {

        // Wait for the results feed to be present
        const feed = document.querySelector('div[role="feed"]');
        if (!feed) {
            await randomDelay(1000, 2000);
            retries++;
            continue;
        }

        // ── FIX: Skip Sponsored/Ad results ──────
        // Get ALL place links in the feed, filtering out sponsored ones
        const allLinks = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
        const filteredLinks = allLinks.filter(link => {
            // Walk up the DOM to see if this link's parent card has "Sponsored" label
            let parent = link.closest('[jsaction]');
            if (parent && parent.innerText && parent.innerText.includes('Sponsored')) return false;
            // Also filter out links that don't have a proper place URL pattern
            return link.href.match(/\/maps\/place\/.+\/@/);
        });

        const unprocessed = filteredLinks.find(link => !processedUrls.has(link.href));

        if (unprocessed) {
            retries = 0;
            processedUrls.add(unprocessed.href);

            // Smoothly scroll to the item (human-like)
            unprocessed.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await randomDelay(600, 1400);

            // Click on the business listing
            unprocessed.click();

            // Wait for detail panel to load (h1 = business name)
            const loaded = await waitForElement('h1', 10000);
            if (loaded) {
                // Random "reading time" before scraping data
                await randomDelay(2500, 5000);

                const data = extractData();

                // STRICT FILTER: Only keep businesses with NO website
                if (!data.Website || data.Website === "No Website") {
                    // Also skip if name is invalid / sponsored
                    if (data.Name && data.Name !== "Not available" && !data.Name.toLowerCase().includes('sponsored')) {
                        results.push(data);
                    }
                }

                updateBanner(results.length, processedUrls.size);
            }

            // Navigate back to the search results list
            await randomDelay(500, 1200);

            // Try clicking the native back button first
            const backBtn = Array.from(document.querySelectorAll('button')).find(b => {
                const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
                return lbl.includes('back') || lbl.includes('search results');
            });

            if (backBtn) {
                backBtn.click();
            } else {
                window.history.back();
            }

            // Wait for feed to reappear
            await waitForElement('div[role="feed"]', 10000);
            await randomDelay(1000, 2500);

        } else {
            // All visible links processed → scroll to load more
            const prevHeight = feed.scrollHeight;
            await humanScroll(feed);
            await randomDelay(2000, 4000);

            if (feed.scrollHeight === prevHeight) {
                // No new items loaded → we've reached the end
                retries++;
            } else {
                retries = 0;
            }
        }
    }

    removeBanner();
    exportToCSV(results);
    isRunning = false;
}
