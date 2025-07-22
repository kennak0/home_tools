// ==UserScript==
// @name         Feedly Hatena & Hacker News Score Display (v6 - Clickable Links)
// @namespace    https://example.com/
// @version      6.0
// @description  Feedlyの記事一覧にはてなブックマーク数とHacker Newsスコアを表示（クリック可能リンク版）
// @author       YourName
// @match        https://feedly.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// @connect      b.hatena.ne.jp
// @connect      hn.algolia.com
// ==/UserScript==

(function() {
    'use strict';

    // API endpoints
    const HATENA_API_BASE = 'https://b.hatena.ne.jp/entry/jsonlite/?url=';
    const HATENA_BOOKMARK_URL = 'https://b.hatena.ne.jp/entry/';
    const HN_SEARCH_API = 'https://hn.algolia.com/api/v1/search?query=';

    const processedUrls = new Map();
    let processingQueue = new Set();

    // XMLHttpRequest wrapper
    const xmlHttpRequest = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : GM_xmlhttpRequest;

    // Styles for score badges
    const styles = `
        .feedly-score-container {
            display: inline-flex !important;
            gap: 4px !important;
            margin-right: 8px !important;
            vertical-align: middle !important;
        }
        
        .feedly-score-badge {
            display: inline-block !important;
            padding: 2px 6px !important;
            border-radius: 10px !important;
            font-size: 11px !important;
            font-weight: bold !important;
            text-decoration: none !important;
            line-height: 1.2 !important;
            transition: opacity 0.2s !important;
        }
        
        .feedly-score-badge:hover {
            opacity: 0.8 !important;
        }
        
        .hatena-badge {
            color: white !important;
            background-color: #00a0de !important;
        }
        
        .hn-badge {
            color: white !important;
            background-color: #ff6600 !important;
        }
        
        /* Ensure badges stay visible */
        .feedly-score-container * {
            visibility: visible !important;
            opacity: 1 !important;
        }
    `;

    function initStyles() {
        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(styles);
        } else {
            const styleElement = document.createElement('style');
            styleElement.textContent = styles;
            document.head.appendChild(styleElement);
        }
    }

    function fetchHatenaData(url) {
        return new Promise((resolve) => {
            const apiUrl = HATENA_API_BASE + encodeURIComponent(url);
            
            xmlHttpRequest({
                method: 'GET',
                url: apiUrl,
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve({
                                count: data.count || 0,
                                url: HATENA_BOOKMARK_URL + encodeURIComponent(url)
                            });
                        } catch (e) {
                            resolve({ count: 0, url: HATENA_BOOKMARK_URL + encodeURIComponent(url) });
                        }
                    } else {
                        resolve({ count: 0, url: HATENA_BOOKMARK_URL + encodeURIComponent(url) });
                    }
                },
                onerror: () => resolve({ count: 0, url: HATENA_BOOKMARK_URL + encodeURIComponent(url) })
            });
        });
    }

    function fetchHackerNewsData(url) {
        return new Promise((resolve) => {
            const searchUrl = HN_SEARCH_API + encodeURIComponent(url);
            
            xmlHttpRequest({
                method: 'GET',
                url: searchUrl,
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.hits && data.hits.length > 0) {
                                const hit = data.hits[0];
                                resolve({
                                    score: hit.points || 0,
                                    comments: hit.num_comments || 0,
                                    url: `https://news.ycombinator.com/item?id=${hit.objectID}`
                                });
                            } else {
                                resolve({ score: 0, comments: 0, url: null });
                            }
                        } catch (e) {
                            resolve({ score: 0, comments: 0, url: null });
                        }
                    } else {
                        resolve({ score: 0, comments: 0, url: null });
                    }
                },
                onerror: () => resolve({ score: 0, comments: 0, url: null })
            });
        });
    }

    function createBadgeContainer() {
        const container = document.createElement('span');
        container.className = 'feedly-score-container';
        return container;
    }

    function createHatenaBadge(data) {
        const badge = document.createElement('a');
        badge.href = data.url;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.className = 'feedly-score-badge hatena-badge';
        badge.textContent = `B ${data.count}`;
        badge.title = `${data.count} はてなブックマーク`;
        badge.onclick = (e) => e.stopPropagation();
        return badge;
    }

    function createHNBadge(data) {
        const badge = document.createElement('a');
        badge.href = data.url;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.className = 'feedly-score-badge hn-badge';
        badge.textContent = `HN ${data.score}`;
        badge.title = data.comments > 0 ? 
            `${data.score} points, ${data.comments} comments` : 
            `${data.score} points`;
        badge.onclick = (e) => e.stopPropagation();
        return badge;
    }

    async function processLink(linkElement) {
        const url = linkElement.href;
        
        // Skip if already processed
        if (linkElement.hasAttribute('data-scores-added')) {
            return;
        }
        
        // Skip if currently processing
        if (processingQueue.has(url)) {
            return;
        }
        
        // Mark as processing
        processingQueue.add(url);
        linkElement.setAttribute('data-scores-added', 'processing');
        
        try {
            // Check cache first
            if (processedUrls.has(url)) {
                const cached = processedUrls.get(url);
                addBadgesToLink(linkElement, cached.hatenaData, cached.hnData);
                return;
            }
            
            // Fetch data
            const [hatenaData, hnData] = await Promise.all([
                fetchHatenaData(url),
                fetchHackerNewsData(url)
            ]);
            
            // Cache the results
            processedUrls.set(url, { hatenaData, hnData });
            
            // Add badges
            addBadgesToLink(linkElement, hatenaData, hnData);
            
            console.log(`[FeedlyScores] Processed ${url} - Hatena: ${hatenaData.count}, HN: ${hnData.score}`);
            
        } catch (error) {
            console.error('[FeedlyScores] Error processing link:', error);
            linkElement.removeAttribute('data-scores-added');
        } finally {
            processingQueue.delete(url);
        }
    }

    function addBadgesToLink(linkElement, hatenaData, hnData) {
        // Remove any existing badges
        const existingContainer = linkElement.parentElement?.querySelector('.feedly-score-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        
        // Create container
        const container = createBadgeContainer();
        
        // Add badges
        if (hatenaData.count > 0) {
            container.appendChild(createHatenaBadge(hatenaData));
        }
        
        if (hnData.score > 0 && hnData.url) {
            container.appendChild(createHNBadge(hnData));
        }
        
        // Insert before the link
        if (container.children.length > 0 && linkElement.parentElement) {
            linkElement.parentElement.insertBefore(container, linkElement);
            linkElement.setAttribute('data-scores-added', 'true');
        } else {
            linkElement.removeAttribute('data-scores-added');
        }
    }

    function processAllLinks() {
        const selectors = [
            'a.EntryTitleLink',
            'a.entryTitle',
            'a[data-testid="entry-title"]',
            'h2 a[href]',
            'h3 a[href]'
        ];
        
        const links = [];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(link => {
                if (link.href && link.href.startsWith('http') && !link.hasAttribute('data-scores-added')) {
                    links.push(link);
                }
            });
        });
        
        console.log(`[FeedlyScores] Found ${links.length} unprocessed links`);
        
        // Process in batches to avoid overwhelming the API
        links.slice(0, 10).forEach(link => processLink(link));
        
        if (links.length > 10) {
            setTimeout(() => {
                processAllLinks();
            }, 2000);
        }
    }

    function waitForContent() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const links = document.querySelectorAll('a.EntryTitleLink, a.entryTitle');
                if (links.length > 0) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);
            
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, 10000);
        });
    }

    async function init() {
        console.log('[FeedlyScores] v6 Initializing...');
        
        // Initialize styles
        initStyles();
        
        // Wait for content
        await waitForContent();
        
        // Initial processing
        processAllLinks();
        
        // Monitor for changes
        let debounceTimer = null;
        const observer = new MutationObserver(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processAllLinks, 1500);
        });
        
        // Observe specific container
        const container = document.querySelector('#feedlyFrame, #root, .container, main');
        if (container) {
            observer.observe(container, {
                childList: true,
                subtree: true
            });
        } else {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
        
        // Monitor URL changes
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                console.log('[FeedlyScores] URL changed, reprocessing...');
                setTimeout(processAllLinks, 1000);
            }
        }, 2000);
    }

    // Start when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();