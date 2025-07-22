// ==UserScript==
// @name         Feedly Hatena Bookmark Count with Link (Hatena Blue Icon Style)
// @namespace    https://example.com/
// @version      2.6
// @description  Feedlyの記事一覧に対してはてなブックマーク件数を記事タイトルの前に表示し、背景ははてなブルー、文字は白抜きのアイコン風に表示（デバッグログあり、負荷軽減）
// @author       YourName
// @match        https://feedly.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      b.hatena.ne.jp
// ==/UserScript==

(function() {
    'use strict';

    const HATENA_API_BASE = 'https://b.hatena.ne.jp/entry/jsonlite/?url=';
    const HATENA_BOOKMARK_URL = 'https://b.hatena.ne.jp/entry/';

    const processedUrls = new Set();
    
    // グローバルスタイルを追加
    const style = document.createElement('style');
    style.textContent = `
        .hatena-count {
            margin-right: 6px !important;
            font-weight: bold !important;
            background-color: #00a0de !important;
            color: white !important;
            padding: 4px 8px !important;
            border-radius: 12px !important;
            font-size: 12px !important;
            line-height: 16px !important;
            font-family: Arial, sans-serif !important;
            user-select: none !important;
            vertical-align: middle !important;
            display: inline-block !important;
            min-width: 36px !important;
            height: auto !important;
            text-align: center !important;
            box-shadow: 0 0 3px rgba(0,0,0,0.2) !important;
            position: relative !important;
            top: 0 !important;
            z-index: 9999 !important;
            overflow: visible !important;
            opacity: 1 !important;
            visibility: visible !important;
            cursor: pointer !important;
        }
        
        .hatena-count a {
            color: white !important;
            text-decoration: none !important;
            display: inline-block !important;
            font-size: 12px !important;
            line-height: 16px !important;
            font-weight: bold !important;
            height: auto !important;
            width: 100% !important;
            opacity: 1 !important;
            visibility: visible !important;
            z-index: 9999 !important;
            position: relative !important;
            cursor: pointer !important;
            pointer-events: auto !important;
        }
        
        .hatena-count:hover {
            background-color: #0080be !important;
            transform: scale(1.05);
        }
    `;
    document.head.appendChild(style);

    function debugLog(...args) {
        console.log('[FeedlyHatena]', ...args);
    }

    function getArticleLinks() {
        const selectorCandidates = [
            'a.entryTitle',
            'a.title',
            'a.EntryTitleLink',
            'div.EntryContent a[href]',
            // Firefoxで新しいセレクタの可能性
            'a[data-testid="entry-title"]',
            'h2 a[href]',
            'h3 a[href]',
            'article a[href]'
        ];

        debugLog('Searching for article links...');
        
        for (const selector of selectorCandidates) {
            const elements = document.querySelectorAll(selector);
            debugLog(`Selector "${selector}" found ${elements.length} elements`);
            
            const links = Array.from(elements).filter(a => a.href && a.href.startsWith('http'));
            if (links.length > 0) {
                debugLog(`getArticleLinks: Found ${links.length} links with selector "${selector}"`);
                debugLog('First link example:', links[0].href);
                return links;
            }
        }
        
        // デバッグ用：すべてのリンクを探索
        const allLinks = document.querySelectorAll('a[href]');
        debugLog(`Total links on page: ${allLinks.length}`);
        const httpLinks = Array.from(allLinks).filter(a => a.href.startsWith('http'));
        debugLog(`HTTP links: ${httpLinks.length}`);
        if (httpLinks.length > 0) {
            debugLog('Sample links:', httpLinks.slice(0, 3).map(a => ({
                href: a.href,
                className: a.className,
                textContent: a.textContent.substring(0, 50)
            })));
        }
        
        debugLog('getArticleLinks: No article links found');
        return [];
    }

    function fetchAndDisplayCount(linkElement) {
        // URLベースで重複チェック
        if (processedUrls.has(linkElement.href)) {
            debugLog('fetchAndDisplayCount: Already processed URL, skipping:', linkElement.href);
            return;
        }
        processedUrls.add(linkElement.href);

        const url = encodeURIComponent(linkElement.href);
        const apiUrl = HATENA_API_BASE + url;
        const hatenaPageUrl = HATENA_BOOKMARK_URL + url;

        debugLog('fetchAndDisplayCount: Fetching count for URL:', linkElement.href);
        debugLog('API URL:', apiUrl);

        // Firefox互換性のためGM_xmlhttpRequestとGM.xmlHttpRequestの両方をサポート
        const hasGM = typeof GM !== 'undefined';
        const hasGMxmlHttpRequest = hasGM && typeof GM.xmlHttpRequest === 'function';
        const hasGM_xmlhttpRequest = typeof GM_xmlhttpRequest === 'function';
        
        debugLog('API Check - hasGM:', hasGM, 'hasGM.xmlHttpRequest:', hasGMxmlHttpRequest, 'hasGM_xmlhttpRequest:', hasGM_xmlhttpRequest);
        
        const xmlHttpRequest = hasGMxmlHttpRequest ? GM.xmlHttpRequest : (hasGM_xmlhttpRequest ? GM_xmlhttpRequest : null);
        
        if (!xmlHttpRequest) {
            console.error('[ERROR] Neither GM.xmlHttpRequest nor GM_xmlhttpRequest is available');
            showCount(linkElement, 0, hatenaPageUrl);
            return;
        }
        
        debugLog('Using xmlHttpRequest:', hasGMxmlHttpRequest ? 'GM.xmlHttpRequest' : 'GM_xmlhttpRequest');

        xmlHttpRequest({
            method: 'GET',
            url: apiUrl,
            onload: function(response) {
                debugLog(`onload: status=${response.status} for URL: ${linkElement.href}`);
                debugLog('Response headers:', response.responseHeaders);
                debugLog('Response text (first 200 chars):', response.responseText ? response.responseText.substring(0, 200) : 'No response text');
                
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const count = data.count || 0;
                        debugLog(`Parsed data:`, data);
                        debugLog(`Parsed count: ${count} for URL: ${linkElement.href}`);
                        showCount(linkElement, count, hatenaPageUrl);
                    } catch (e) {
                        console.warn(`[WARN] JSON parse error or no data for URL: ${linkElement.href}`, e);
                        console.warn('Response text was:', response.responseText);
                        showCount(linkElement, 0, hatenaPageUrl);
                    }
                } else {
                    console.warn(`[WARN] HTTP status ${response.status} for URL: ${linkElement.href}`);
                    console.warn('Response text:', response.responseText);
                    showCount(linkElement, 0, hatenaPageUrl);
                }
            },
            onerror: function(error) {
                console.error(`[ERROR] xmlHttpRequest error for URL: ${linkElement.href}`, error);
                showCount(linkElement, 0, hatenaPageUrl);
            }
        });
    }

    function showCount(linkElement, count, hatenaPageUrl) {
        debugLog(`showCount called: count=${count}, URL=${linkElement.href}`);
        
        if (count === 0) {
            if (linkElement.previousSibling && linkElement.previousSibling.classList && linkElement.previousSibling.classList.contains('hatena-count')) {
                linkElement.previousSibling.remove();
                debugLog(`Removed existing count display for URL: ${linkElement.href} because count is 0`);
            }
            return;
        }

        // 既存の表示があるかチェック
        if (linkElement.previousSibling && linkElement.previousSibling.classList && linkElement.previousSibling.classList.contains('hatena-count')) {
            const existingLink = linkElement.previousSibling.querySelector('a');
            if (existingLink) {
                existingLink.textContent = `B ${count}`;
                existingLink.href = hatenaPageUrl;
                debugLog(`Updated existing count link for URL: ${linkElement.href}`);
            }
            return;
        }
        
        // linkElementのテキストの前に挿入する別の方法も試す
        if (linkElement.firstChild && linkElement.firstChild.nodeType === Node.TEXT_NODE) {
            debugLog('Trying alternative insertion method with firstChild');
        }

        const span = document.createElement('span');
        span.className = 'hatena-count';
        
        // スタイルを文字列として設定（より確実）
        const spanStyle = `
            margin-right: 6px !important;
            font-weight: bold !important;
            background-color: #00a0de !important;
            color: white !important;
            padding: 4px 8px !important;
            border-radius: 12px !important;
            font-size: 12px !important;
            line-height: 16px !important;
            font-family: Arial, sans-serif !important;
            user-select: none !important;
            vertical-align: middle !important;
            display: inline-block !important;
            min-width: 36px !important;
            height: auto !important;
            text-align: center !important;
            box-shadow: 0 0 3px rgba(0,0,0,0.2) !important;
            position: relative !important;
            top: 0 !important;
            z-index: 9999 !important;
            overflow: visible !important;
            opacity: 1 !important;
            visibility: visible !important;
            cursor: pointer !important;
        `;
        span.setAttribute('style', spanStyle.trim());

        const a = document.createElement('a');
        a.href = hatenaPageUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        
        // aタグのスタイルも文字列として設定
        const aStyle = `
            color: white !important;
            text-decoration: none !important;
            display: inline-block !important;
            font-size: 12px !important;
            line-height: 16px !important;
            font-weight: bold !important;
            height: auto !important;
            width: 100% !important;
            opacity: 1 !important;
            visibility: visible !important;
            z-index: 9999 !important;
            position: relative !important;
            cursor: pointer !important;
            pointer-events: auto !important;
        `;
        a.setAttribute('style', aStyle.trim());
        a.textContent = `B ${count}`;
        
        // クリックイベントを直接追加
        a.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.open(hatenaPageUrl, '_blank');
        });

        span.appendChild(a);
        
        debugLog('DOM insertion debug:');
        debugLog('- linkElement:', linkElement);
        debugLog('- linkElement.parentNode:', linkElement.parentNode);
        debugLog('- linkElement.tagName:', linkElement.tagName);
        debugLog('- linkElement.className:', linkElement.className);
        debugLog('- Parent tagName:', linkElement.parentNode ? linkElement.parentNode.tagName : 'No parent');
        debugLog('- Parent className:', linkElement.parentNode ? linkElement.parentNode.className : 'No parent');
        
        try {
            if (linkElement.parentNode) {
                linkElement.parentNode.insertBefore(span, linkElement);
                debugLog(`Successfully inserted count link before title for URL: ${linkElement.href}`);
                
                // 挿入後の確認
                debugLog('- span.parentNode:', span.parentNode);
                debugLog('- span.nextSibling === linkElement:', span.nextSibling === linkElement);
                debugLog('- span.outerHTML:', span.outerHTML);
                debugLog('- span computed style backgroundColor:', window.getComputedStyle(span).backgroundColor);
            } else {
                console.error('[ERROR] linkElement has no parentNode');
            }
        } catch (e) {
            console.error('[ERROR] Failed to insert count span:', e);
            console.error('- Error details:', e.message);
        }
    }

    function main() {
        debugLog('Running main()');
        const links = getArticleLinks();
        if (links.length === 0) {
            debugLog('No article links found in main()');
            return;
        }
        links.forEach(link => {
            fetchAndDisplayCount(link);
        });
    }

    function waitForFeedlyContent() {
        return new Promise(resolve => {
            if (getArticleLinks().length > 0) {
                debugLog('waitForFeedlyContent: Links already present');
                resolve();
                return;
            }

            const observer = new MutationObserver((mutations, obs) => {
                if (getArticleLinks().length > 0) {
                    debugLog('waitForFeedlyContent: Feedly content detected');
                    obs.disconnect();
                    resolve();
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                debugLog('waitForFeedlyContent: Timeout reached');
                observer.disconnect();
                resolve();
            }, 10000);
        });
    }

    let debounceTimer = null;
    const DEBOUNCE_DELAY = 500;

    function setupObserver() {
        const observer = new MutationObserver(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                debugLog('MutationObserver triggered, running main()');
                main();
            }, DEBOUNCE_DELAY);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // URLが変更された時にprocessedUrlsをクリア
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            processedUrls.clear();
            debugLog('URL changed, cleared processedUrls');
        }
    }).observe(document, {subtree: true, childList: true});

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            debugLog('DOMContentLoaded event');
            waitForFeedlyContent().then(() => {
                main();
                setupObserver();
            });
        });
    } else {
        debugLog('Document already loaded');
        waitForFeedlyContent().then(() => {
            main();
            setupObserver();
        });
    }

    window.addEventListener('load', () => {
        debugLog('window load event');
        waitForFeedlyContent().then(() => {
            main();
            setupObserver();
        });
    });

})();
