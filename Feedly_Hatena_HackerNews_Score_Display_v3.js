// ==UserScript==
// @name         Feedly Hatena & Hacker News Score Display (v3)
// @namespace    https://example.com/
// @version      3.0
// @description  Feedlyの記事一覧にはてなブックマーク数とHacker Newsスコアを表示（シンプル版）
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

    const processedUrls = new Map();

    // XMLHttpRequest wrapper for compatibility
    const xmlHttpRequest = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : GM_xmlhttpRequest;

    function getArticleLinks() {
        console.log('[FeedlyScores] Searching for article links...');
        const selectorCandidates = [
            'a.EntryTitleLink',
            'a.entryTitle',
            'a.title',
            'h2 a[href]',
            'h3 a[href]',
            'article a[href]',
            'a[data-testid="entry-title"]',
            'div.EntryContent a[href]'
        ];
        
        for (const selector of selectorCandidates) {
            const elements = document.querySelectorAll(selector);
            console.log(`[FeedlyScores] Selector "${selector}" found ${elements.length} elements`);
            
            const links = Array.from(elements)
                .filter(a => a.href && a.href.startsWith('http'));
            if (links.length > 0) {
                console.log(`[FeedlyScores] Found ${links.length} valid links with selector "${selector}"`);
                console.log(`[FeedlyScores] First link example:`, links[0].href);
                return links;
            }
        }
        
        console.log('[FeedlyScores] No article links found');
        return [];
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
                            const result = {
                                count: data.count || 0,
                                url: HATENA_BOOKMARK_URL + encodeURIComponent(url)
                            };
                            resolve(result);
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

    async function fetchAndDisplayScores(linkElement) {
        const url = linkElement.href;
        console.log(`[FeedlyScores] Fetching scores for: ${url}`);
        
        // キャッシュを一時的に無効化してデバッグ
        // if (processedUrls.has(url)) {
        //     const cached = processedUrls.get(url);
        //     if (cached.element === linkElement) {
        //         console.log(`[FeedlyScores] Already processed: ${url}`);
        //         return;
        //     }
        // }

        try {
            const [hatenaData, hnData] = await Promise.all([
                fetchHatenaCount(url),
                fetchHackerNewsScore(url)
            ]);

            console.log(`[FeedlyScores] Hatena result: count=${hatenaData.count}`);
            console.log(`[FeedlyScores] HN result: score=${hnData.score}, comments=${hnData.comments}`);

            // processedUrls.set(url, { element: linkElement, hatena: hatenaData, hn: hnData });

            // 既存の表示を削除
            const existingBadges = linkElement.querySelectorAll('.score-badge-inline');
            existingBadges.forEach(badge => badge.remove());

            // はてなブックマーク数を表示
            if (hatenaData.count > 0) {
                console.log(`[FeedlyScores] Adding Hatena badge: B ${hatenaData.count}`);
                const hatenaLink = document.createElement('a');
                hatenaLink.href = hatenaData.url;
                hatenaLink.target = '_blank';
                hatenaLink.className = 'score-badge-inline';
                hatenaLink.textContent = ` [B:${hatenaData.count}]`;
                hatenaLink.title = `${hatenaData.count} はてなブックマーク`;
                hatenaLink.style.cssText = `
                    color: #00a0de !important;
                    font-weight: bold !important;
                    font-size: 12px !important;
                    text-decoration: none !important;
                    margin-left: 4px !important;
                `;
                
                hatenaLink.addEventListener('click', function(e) {
                    e.stopPropagation();
                });
                
                try {
                    console.log(`[FeedlyScores] Attempting to append hatena badge to:`, linkElement);
                    console.log(`[FeedlyScores] Link element tagName:`, linkElement.tagName);
                    console.log(`[FeedlyScores] Link element innerHTML:`, linkElement.innerHTML);
                    linkElement.appendChild(hatenaLink);
                    console.log(`[FeedlyScores] Hatena badge added successfully`);
                    console.log(`[FeedlyScores] Updated innerHTML:`, linkElement.innerHTML);
                } catch (appendError) {
                    console.error(`[FeedlyScores] Error appending hatena badge:`, appendError);
                }
            }

            // Hacker Newsスコアを表示
            if (hnData.score > 0 && hnData.url) {
                console.log(`[FeedlyScores] Adding HN badge: HN ${hnData.score}`);
                const hnLink = document.createElement('a');
                hnLink.href = hnData.url;
                hnLink.target = '_blank';
                hnLink.className = 'score-badge-inline';
                hnLink.textContent = ` [HN:${hnData.score}]`;
                hnLink.title = hnData.comments > 0 ? 
                    `${hnData.score} points, ${hnData.comments} comments` : 
                    `${hnData.score} points`;
                hnLink.style.cssText = `
                    color: #ff6600 !important;
                    font-weight: bold !important;
                    font-size: 12px !important;
                    text-decoration: none !important;
                    margin-left: 4px !important;
                `;
                
                hnLink.addEventListener('click', function(e) {
                    e.stopPropagation();
                });
                
                try {
                    linkElement.appendChild(hnLink);
                    console.log(`[FeedlyScores] HN badge added successfully`);
                } catch (appendError) {
                    console.error(`[FeedlyScores] Error appending HN badge:`, appendError);
                }
            }
            
            if (hatenaData.count === 0 && hnData.score === 0) {
                console.log(`[FeedlyScores] No badges to display (both scores are 0)`);
            }
        } catch (error) {
            console.error('[FeedlyScores] Error in fetchAndDisplayScores:', error);
        }
    }

    function processLinks() {
        console.log('[FeedlyScores] processLinks called');
        const links = getArticleLinks();
        console.log(`[FeedlyScores] Processing ${links.length} links`);
        
        if (links.length === 0) {
            console.log('[FeedlyScores] No links found to process');
            return;
        }
        
        links.forEach((link) => {
            fetchAndDisplayScores(link);
        });
    }

    function init() {
        console.log('[FeedlyScores] Initializing...');
        processLinks();

        let debounceTimer = null;
        const observer = new MutationObserver(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processLinks();
            }, 500);
        });

        observer.observe(document.body, { 
            childList: true, 
            subtree: true 
        });

        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                processedUrls.clear();
                console.log('[FeedlyScores] URL changed, cleared cache');
                processLinks();
            }
        }).observe(document, { subtree: true, childList: true });
    }

    // テスト用のシンプルなバッジを追加する関数
    function addTestBadge() {
        console.log('[FeedlyScores] Adding test badge...');
        const links = document.querySelectorAll('a.EntryTitleLink');
        if (links.length > 0) {
            const firstLink = links[0];
            console.log('[FeedlyScores] First link for test:', firstLink);
            console.log('[FeedlyScores] First link parent:', firstLink.parentNode);
            
            const testBadge = document.createElement('span');
            testBadge.textContent = '[TEST]';
            testBadge.style.cssText = `
                color: red !important;
                font-weight: bold !important;
                font-size: 14px !important;
                background: yellow !important;
                padding: 2px 4px !important;
                margin-left: 4px !important;
                display: inline !important;
                visibility: visible !important;
                opacity: 1 !important;
            `;
            
            try {
                // リンクの中に追加
                firstLink.appendChild(testBadge);
                console.log('[FeedlyScores] Test badge added to first link');
                
                // リンクの後にも追加してみる
                const testBadge2 = testBadge.cloneNode(true);
                testBadge2.textContent = '[TEST2]';
                firstLink.parentNode.insertBefore(testBadge2, firstLink.nextSibling);
                console.log('[FeedlyScores] Test badge 2 added after link');
            } catch (err) {
                console.error('[FeedlyScores] Error adding test badge:', err);
            }
        } else {
            console.log('[FeedlyScores] No links found for test badge');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('load', () => {
        setTimeout(init, 1000);
        setTimeout(addTestBadge, 2000); // テストバッジを追加
    });

})();