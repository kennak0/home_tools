// ==UserScript==
// @name         Feedly Hatena & Hacker News Score Display (v4)
// @namespace    https://example.com/
// @version      4.0
// @description  Feedlyの記事一覧にはてなブックマーク数とHacker Newsスコアを表示（メタデータ領域版）
// @author       YourName
// @match        https://feedly.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      b.hatena.ne.jp
// @connect      hn.algolia.com
// ==/UserScript==

(function() {
    'use strict';

    // API endpoints
    const HATENA_API_BASE = 'https://b.hatena.ne.jp/entry/jsonlite/?url=';
    const HATENA_BOOKMARK_URL = 'https://b.hatena.ne.jp/entry/';
    const HN_SEARCH_API = 'https://hn.algolia.com/api/v1/search?query=';

    const processedArticles = new Set();

    // XMLHttpRequest wrapper for compatibility
    const xmlHttpRequest = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : GM_xmlhttpRequest;

    // グローバルスタイルを追加
    const style = document.createElement('style');
    style.textContent = `
        .custom-score-badge {
            display: inline-block !important;
            padding: 2px 6px !important;
            margin: 0 4px !important;
            border-radius: 10px !important;
            font-size: 11px !important;
            font-weight: bold !important;
            text-decoration: none !important;
            line-height: 1.4 !important;
            vertical-align: middle !important;
        }
        
        .hatena-badge {
            background-color: #00a0de !important;
            color: white !important;
        }
        
        .hatena-badge:hover {
            background-color: #0080be !important;
        }
        
        .hn-badge {
            background-color: #ff6600 !important;
            color: white !important;
        }
        
        .hn-badge:hover {
            background-color: #e55500 !important;
        }
    `;
    document.head.appendChild(style);

    function getArticles() {
        // 記事コンテナを探す
        const selectors = [
            'article',
            'div.entry',
            'div[data-testid="entry"]',
            'div.EntryListItem',
            'div[class*="EntryItem"]',
            'div[class*="entry-container"]'
        ];
        
        for (const selector of selectors) {
            const articles = document.querySelectorAll(selector);
            if (articles.length > 0) {
                console.log(`[FeedlyScores] Found ${articles.length} articles with selector: ${selector}`);
                return Array.from(articles);
            }
        }
        
        console.log('[FeedlyScores] No article containers found');
        return [];
    }

    function getArticleUrl(article) {
        // 記事内のリンクを探す
        const linkSelectors = [
            'a.EntryTitleLink',
            'a.entryTitle',
            'a[data-testid="entry-title"]',
            'h2 a[href]',
            'h3 a[href]',
            'a.title'
        ];
        
        for (const selector of linkSelectors) {
            const link = article.querySelector(selector);
            if (link && link.href && link.href.startsWith('http')) {
                return { url: link.href, element: link };
            }
        }
        
        return null;
    }

    function getMetadataContainer(article) {
        // メタデータ領域を探す
        const metaSelectors = [
            'div.EntryMetadata',
            'div[class*="metadata"]',
            'div[class*="entry-meta"]',
            'div.metadata',
            'span.metadata',
            'div[class*="EntryEngagement"]',
            'div[class*="engagement"]'
        ];
        
        for (const selector of metaSelectors) {
            const meta = article.querySelector(selector);
            if (meta) {
                console.log(`[FeedlyScores] Found metadata container with selector: ${selector}`);
                return meta;
            }
        }
        
        // メタデータ領域が見つからない場合は、タイトルの親要素を使用
        const titleLink = article.querySelector('a.EntryTitleLink, a.entryTitle, a[data-testid="entry-title"]');
        if (titleLink && titleLink.parentElement) {
            console.log('[FeedlyScores] Using title parent as metadata container');
            return titleLink.parentElement;
        }
        
        return null;
    }

    function fetchHatenaCount(url) {
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
                onerror: function() {
                    resolve({ count: 0, url: HATENA_BOOKMARK_URL + encodeURIComponent(url) });
                }
            });
        });
    }

    function fetchHackerNewsScore(url) {
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
                onerror: function() {
                    resolve({ score: 0, comments: 0, url: null });
                }
            });
        });
    }

    async function processArticle(article) {
        // 記事IDを生成（重複処理を避けるため）
        const articleId = article.innerHTML.substring(0, 100);
        if (processedArticles.has(articleId)) {
            return;
        }
        processedArticles.add(articleId);
        
        const linkInfo = getArticleUrl(article);
        if (!linkInfo) {
            console.log('[FeedlyScores] No URL found for article');
            return;
        }
        
        const { url } = linkInfo;
        console.log(`[FeedlyScores] Processing article URL: ${url}`);
        
        // メタデータコンテナを探す
        const metaContainer = getMetadataContainer(article);
        if (!metaContainer) {
            console.log('[FeedlyScores] No metadata container found');
            return;
        }
        
        try {
            // APIを並列で呼び出し
            const [hatenaData, hnData] = await Promise.all([
                fetchHatenaCount(url),
                fetchHackerNewsScore(url)
            ]);
            
            console.log(`[FeedlyScores] Results - Hatena: ${hatenaData.count}, HN: ${hnData.score}`);
            
            // 既存のバッジを削除
            const existingBadges = metaContainer.querySelectorAll('.custom-score-badge');
            existingBadges.forEach(badge => badge.remove());
            
            // バッジコンテナを作成
            const badgeContainer = document.createElement('span');
            badgeContainer.style.cssText = 'display: inline-block; margin-left: 8px;';
            
            // はてなブックマークバッジ
            if (hatenaData.count > 0) {
                const hatenaLink = document.createElement('a');
                hatenaLink.href = hatenaData.url;
                hatenaLink.target = '_blank';
                hatenaLink.className = 'custom-score-badge hatena-badge';
                hatenaLink.textContent = `B ${hatenaData.count}`;
                hatenaLink.title = `${hatenaData.count} はてなブックマーク`;
                hatenaLink.onclick = (e) => e.stopPropagation();
                badgeContainer.appendChild(hatenaLink);
            }
            
            // Hacker Newsバッジ
            if (hnData.score > 0 && hnData.url) {
                const hnLink = document.createElement('a');
                hnLink.href = hnData.url;
                hnLink.target = '_blank';
                hnLink.className = 'custom-score-badge hn-badge';
                hnLink.textContent = `HN ${hnData.score}`;
                hnLink.title = hnData.comments > 0 ? 
                    `${hnData.score} points, ${hnData.comments} comments` : 
                    `${hnData.score} points`;
                hnLink.onclick = (e) => e.stopPropagation();
                badgeContainer.appendChild(hnLink);
            }
            
            // バッジを挿入
            if (badgeContainer.children.length > 0) {
                metaContainer.appendChild(badgeContainer);
                console.log('[FeedlyScores] Badges added successfully');
            }
            
        } catch (error) {
            console.error('[FeedlyScores] Error processing article:', error);
        }
    }

    function processAllArticles() {
        const articles = getArticles();
        console.log(`[FeedlyScores] Processing ${articles.length} articles`);
        
        articles.forEach(article => {
            processArticle(article);
        });
    }

    let isProcessing = false;
    let lastProcessTime = 0;
    const MIN_PROCESS_INTERVAL = 3000; // 最小処理間隔（ミリ秒）

    function waitForArticles() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const articles = getArticles();
                if (articles.length > 0) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);
            
            // タイムアウト（10秒）
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, 10000);
        });
    }

    async function processAllArticlesWithCheck() {
        // 処理中または最小間隔内の場合はスキップ
        const now = Date.now();
        if (isProcessing || (now - lastProcessTime) < MIN_PROCESS_INTERVAL) {
            return;
        }
        
        isProcessing = true;
        lastProcessTime = now;
        
        try {
            const articles = getArticles();
            if (articles.length > 0) {
                console.log(`[FeedlyScores] Processing ${articles.length} articles`);
                for (const article of articles) {
                    await processArticle(article);
                }
            }
        } finally {
            isProcessing = false;
        }
    }

    async function init() {
        console.log('[FeedlyScores] Initializing v4...');
        
        // 記事が表示されるのを待つ
        await waitForArticles();
        
        // 初回処理
        processAllArticlesWithCheck();
        
        // DOM変更を監視（ただし、特定の要素のみ）
        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            // 記事関連の変更のみを処理
            const hasRelevantChanges = mutations.some(mutation => {
                const target = mutation.target;
                return target.classList && (
                    target.classList.contains('EntryList') ||
                    target.classList.contains('entry') ||
                    target.id === 'feedlyFrame' ||
                    target.tagName === 'ARTICLE'
                );
            });
            
            if (hasRelevantChanges) {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    processAllArticlesWithCheck();
                }, 1500);
            }
        });
        
        // より限定的な監視対象
        const feedlyContainer = document.querySelector('#feedlyFrame, #root, .container, main');
        if (feedlyContainer) {
            observer.observe(feedlyContainer, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });
        } else {
            // フォールバック
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });
        }
        
        // URLの変更を監視（ページ遷移時）
        let lastUrl = location.href;
        setInterval(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                processedArticles.clear();
                setTimeout(processAllArticlesWithCheck, 1000);
            }
        }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();