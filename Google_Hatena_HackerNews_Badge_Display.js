// ==UserScript==
// @name         Google Hatena & Hacker News Badge Display
// @namespace    https://example.com/
// @version      1.0
// @description  Google検索結果にはてなブックマーク数とHacker Newsスコアを表示
// @author       YourName
// @match        https://www.google.com/search*
// @match        https://www.google.co.jp/search*
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
    const processingQueue = new Set();

    // XMLHttpRequest wrapper
    const xmlHttpRequest = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : GM_xmlhttpRequest;

    // Styles for badges
    const styles = `
        .google-score-container {
            display: inline-flex !important;
            gap: 4px !important;
            margin-left: 8px !important;
            vertical-align: middle !important;
        }
        
        .google-score-badge {
            display: inline-block !important;
            padding: 2px 6px !important;
            border-radius: 10px !important;
            font-size: 11px !important;
            font-weight: bold !important;
            text-decoration: none !important;
            line-height: 1.2 !important;
            transition: opacity 0.2s !important;
            color: white !important;
        }
        
        .google-score-badge:hover {
            opacity: 0.8 !important;
        }
        
        .google-score-badge.hatena {
            background-color: #00a0de !important;
        }
        
        .google-score-badge.hn {
            background-color: #ff6600 !important;
        }
    `;

    function initStyles() {
        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(styles);
        } else {
            const style = document.createElement('style');
            style.textContent = styles;
            document.head.appendChild(style);
        }
    }

    function getHatenaBookmarkCount(url) {
        return new Promise((resolve) => {
            xmlHttpRequest({
                method: 'GET',
                url: HATENA_API_BASE + encodeURIComponent(url),
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const count = data && data.count ? data.count : 0;
                        processedUrls.set(url, { hatena: count });
                        resolve(count);
                    } catch (e) {
                        console.error('Error parsing Hatena response:', e);
                        resolve(0);
                    }
                },
                onerror: function() {
                    console.error('Error fetching Hatena bookmark count');
                    resolve(0);
                }
            });
        });
    }

    function getHackerNewsScore(url, linkElement) {
        return new Promise((resolve) => {
            const title = linkElement.querySelector('h3')?.textContent || '';
            
            // まずURLで検索
            const urlQuery = encodeURIComponent(url);
            console.log('Searching HN for URL:', url);
            
            xmlHttpRequest({
                method: 'GET',
                url: HN_SEARCH_API + urlQuery + '&restrictSearchableAttributes=url',
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        console.log('HN URL search response:', data);
                        
                        if (data.hits && data.hits.length > 0) {
                            // URLで最も一致するものを探す
                            let hit = data.hits.find(h => {
                                const storyUrl = h.url || '';
                                return storyUrl === url || 
                                       storyUrl.replace(/\/$/, '') === url.replace(/\/$/, '') ||
                                       storyUrl.replace(/^https?:\/\//, '') === url.replace(/^https?:\/\//, '');
                            });
                            
                            if (hit) {
                                const score = hit.points || 0;
                                const hnId = hit.objectID;
                                console.log('Found HN story by URL with score:', score, 'ID:', hnId);
                                const existingData = processedUrls.get(url) || {};
                                processedUrls.set(url, { ...existingData, hn: score, hnId: hnId });
                                resolve({ score, hnId });
                                return;
                            }
                        }
                        
                        // URLで見つからない場合はタイトルで検索
                        if (title) {
                            console.log('Searching HN by title:', title);
                            const titleQuery = encodeURIComponent(title);
                            xmlHttpRequest({
                                method: 'GET',
                                url: HN_SEARCH_API + titleQuery + '&restrictSearchableAttributes=title',
                                onload: function(titleResponse) {
                                    try {
                                        const titleData = JSON.parse(titleResponse.responseText);
                                        console.log('HN title search response:', titleData);
                                        
                                        if (titleData.hits && titleData.hits.length > 0) {
                                            // タイトルが類似しているものを探す
                                            const hit = titleData.hits.find(h => {
                                                const storyTitle = h.title || '';
                                                return storyTitle.toLowerCase().includes(title.toLowerCase().substring(0, 20)) ||
                                                       title.toLowerCase().includes(storyTitle.toLowerCase().substring(0, 20));
                                            }) || titleData.hits[0];
                                            
                                            const score = hit.points || 0;
                                            const hnId = hit.objectID;
                                            console.log('Found HN story by title with score:', score, 'ID:', hnId);
                                            const existingData = processedUrls.get(url) || {};
                                            processedUrls.set(url, { ...existingData, hn: score, hnId: hnId });
                                            resolve({ score, hnId });
                                        } else {
                                            console.log('No HN stories found for title');
                                            resolve({ score: 0, hnId: null });
                                        }
                                    } catch (e) {
                                        console.error('Error parsing HN title response:', e);
                                        resolve({ score: 0, hnId: null });
                                    }
                                },
                                onerror: function() {
                                    console.error('Error fetching HN score by title');
                                    resolve({ score: 0, hnId: null });
                                }
                            });
                        } else {
                            console.log('No title available for HN search');
                            resolve({ score: 0, hnId: null });
                        }
                    } catch (e) {
                        console.error('Error parsing HN response:', e);
                        resolve({ score: 0, hnId: null });
                    }
                },
                onerror: function() {
                    console.error('Error fetching HN score');
                    resolve({ score: 0, hnId: null });
                }
            });
        });
    }

    function createBadge(type, count, url, hnId) {
        const badge = document.createElement('a');
        badge.className = `google-score-badge ${type}`;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        
        if (type === 'hatena') {
            badge.textContent = `B:${count}`;
            badge.href = HATENA_BOOKMARK_URL + url;
            badge.title = `はてなブックマーク: ${count}`;
        } else if (type === 'hn') {
            badge.textContent = `HN:${count}`;
            if (hnId) {
                badge.href = `https://news.ycombinator.com/item?id=${hnId}`;
            } else {
                badge.href = `https://hn.algolia.com/?query=${encodeURIComponent(url)}&type=story`;
            }
            badge.title = `Hacker News Score: ${count}`;
        }
        
        return badge;
    }

    function insertBadges(container, url, scores) {
        const badgeContainer = document.createElement('span');
        badgeContainer.className = 'google-score-container';
        
        console.log('Inserting badges for URL:', url, 'Scores:', scores);
        
        if (scores.hatena > 0) {
            console.log('Adding Hatena badge:', scores.hatena);
            badgeContainer.appendChild(createBadge('hatena', scores.hatena, url));
        }
        
        if (scores.hn > 0) {  // HNは1以上の場合のみ表示
            console.log('Adding HN badge:', scores.hn, 'ID:', scores.hnId);
            badgeContainer.appendChild(createBadge('hn', scores.hn, url, scores.hnId));
        }
        
        if (badgeContainer.children.length > 0) {
            container.appendChild(badgeContainer);
            console.log('Badges inserted successfully');
        } else {
            console.log('No badges to insert');
        }
    }

    async function processSearchResult(result) {
        // メインのリンクを取得
        const linkElement = result.querySelector('a[href]:not([role="button"]):not([class*="fl"])');
        if (!linkElement) return;
        
        const url = linkElement.href;
        if (!url || url.startsWith('https://www.google.') || processingQueue.has(url)) return;
        
        processingQueue.add(url);
        
        // URLに近い場所でバッジを挿入する適切な場所を探す
        const titleElement = linkElement.querySelector('h3');
        if (!titleElement) {
            processingQueue.delete(url);
            return;
        }
        
        // すでにバッジが追加されているかチェック
        if (titleElement.parentElement.querySelector('.google-score-container')) {
            processingQueue.delete(url);
            return;
        }
        
        try {
            console.log('Processing URL:', url);
            const [hatenaCount, hnResult] = await Promise.all([
                getHatenaBookmarkCount(url),
                getHackerNewsScore(url, linkElement)
            ]);
            
            console.log('API results - Hatena:', hatenaCount, 'HN:', hnResult);
            const scores = { 
                hatena: hatenaCount, 
                hn: hnResult.score, 
                hnId: hnResult.hnId 
            };
            insertBadges(titleElement.parentElement, url, scores);
        } catch (error) {
            console.error('Error processing URL:', url, error);
        } finally {
            processingQueue.delete(url);
        }
    }

    function processAllResults() {
        // Google検索結果のセレクタ（複数のパターンに対応）
        const results = document.querySelectorAll('div[data-sokoban-container], div.g, div[data-hveid]');
        results.forEach(result => {
            processSearchResult(result);
        });
    }

    function observeSearchResults() {
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    shouldProcess = true;
                }
            });
            
            if (shouldProcess) {
                processAllResults();
            }
        });
        
        const searchContainer = document.querySelector('#search, #rso, #center_col');
        if (searchContainer) {
            observer.observe(searchContainer, {
                childList: true,
                subtree: true
            });
        }
    }

    // Initialize
    function init() {
        initStyles();
        processAllResults();
        observeSearchResults();
        
        // ページ遷移や動的読み込みに対応
        window.addEventListener('load', processAllResults);
        
        // Google検索のインスタント検索に対応
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                setTimeout(processAllResults, 500);
            }
        }).observe(document, { subtree: true, childList: true });
    }

    // Start the script
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();