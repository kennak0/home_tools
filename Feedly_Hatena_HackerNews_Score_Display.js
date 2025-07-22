// ==UserScript==
// @name         Feedly Hatena & Hacker News Score Display
// @namespace    https://example.com/
// @version      2.1
// @description  Feedlyの記事一覧にはてなブックマーク数とHacker Newsスコアを表示（最適化版）
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

    // グローバルスタイルを追加
    const style = document.createElement('style');
    style.textContent = `
        .social-scores {
            display: inline-flex !important;
            gap: 4px !important;
            margin-right: 8px !important;
            vertical-align: middle !important;
            position: relative !important;
            opacity: 1 !important;
            visibility: visible !important;
            font-size: inherit !important;
            line-height: inherit !important;
            color: inherit !important;
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            margin-left: 0 !important;
            width: auto !important;
            height: 22px !important;
            min-width: 40px !important;
            min-height: 22px !important;
            max-width: 200px !important;
            max-height: 22px !important;
            overflow: visible !important;
            flex-shrink: 0 !important;
        }
        
        .score-badge, .social-scores a {
            display: inline-flex !important;
            align-items: center !important;
            padding: 3px 8px !important;
            border-radius: 12px !important;
            font-size: 12px !important;
            line-height: 16px !important;
            font-weight: bold !important;
            font-family: Arial, sans-serif !important;
            text-decoration: none !important;
            cursor: pointer !important;
            transition: transform 0.1s ease !important;
            position: relative !important;
            opacity: 1 !important;
            visibility: visible !important;
            min-height: 20px !important;
            white-space: nowrap !important;
            overflow: visible !important;
            width: auto !important;
            height: auto !important;
            min-width: auto !important;
            max-width: none !important;
            max-height: none !important;
            margin: 0 !important;
            vertical-align: baseline !important;
        }
        
        .score-badge:hover, .social-scores a:hover {
            transform: scale(1.05) !important;
        }
        
        .hatena-score, .social-scores a.hatena-score {
            background-color: #00a0de !important;
            color: white !important;
        }
        
        .hatena-score:hover, .social-scores a.hatena-score:hover {
            background-color: #0080be !important;
        }
        
        .hn-score, .social-scores a.hn-score {
            background-color: #ff6600 !important;
            color: white !important;
        }
        
        .hn-score:hover, .social-scores a.hn-score:hover {
            background-color: #e55500 !important;
        }
        
        .score-icon {
            margin-right: 3px !important;
            font-size: 11px !important;
            font-weight: bold !important;
        }
        
        /* Feedlyの特定のCSSを上書き */
        .fx.fx > .social-scores,
        .EntryMetadata .social-scores,
        .EntryTitle .social-scores {
            display: inline-flex !important;
            opacity: 1 !important;
            visibility: visible !important;
        }
        
        /* a要素のスタイル */
        .social-scores a {
            display: inline-block !important;
            text-decoration: none !important;
            cursor: pointer !important;
            opacity: 1 !important;
            visibility: visible !important;
            font-size: inherit !important;
            line-height: inherit !important;
            color: inherit !important;
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: auto !important;
            height: auto !important;
        }
        
        /* スクロールコンテナのオーバーフロー制御 */
        .list-entries,
        .entriesContainer,
        .StreamPage,
        [class*="ScrollContainer"],
        [class*="scrollable"] {
            overflow: hidden !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
        }
    `;
    document.head.appendChild(style);

    function debugLog(...args) {
        console.log('[FeedlyScores]', ...args);
    }

    // XMLHttpRequest wrapper for compatibility
    const xmlHttpRequest = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : GM_xmlhttpRequest;

    function getArticleLinks() {
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

        debugLog('Searching for article links...');
        
        for (const selector of selectorCandidates) {
            const elements = document.querySelectorAll(selector);
            debugLog(`Selector "${selector}" found ${elements.length} elements`);
            
            const links = Array.from(elements)
                .filter(a => a.href && a.href.startsWith('http'));
            if (links.length > 0) {
                debugLog(`Found ${links.length} valid links with selector "${selector}"`);
                debugLog('First link example:', links[0].href);
                return links;
            }
        }
        
        // デバッグ用：すべてのリンクを探索
        // const allLinks = document.querySelectorAll('a[href]');
        // debugLog(`Total links on page: ${allLinks.length}`);
        // const httpLinks = Array.from(allLinks).filter(a => a.href.startsWith('http'));
        // debugLog(`HTTP links: ${httpLinks.length}`);
        // if (httpLinks.length > 0) {
        //     debugLog('Sample links:', httpLinks.slice(0, 3).map(a => ({
        //         href: a.href,
        //         className: a.className,
        //         textContent: a.textContent.substring(0, 50)
        //     })));
        // }
        
        debugLog('No article links found');
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
            // URLをクエリとして検索
            const searchUrl = HN_SEARCH_API + encodeURIComponent(url);
            
            xmlHttpRequest({
                method: 'GET',
                url: searchUrl,
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            // 最も関連性の高い結果を取得
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
        
        // 既に処理済みかチェック
        if (processedUrls.has(url)) {
            const cached = processedUrls.get(url);
            if (cached.element === linkElement) {
                // debugLog(`Already processed: ${url}`);
                return;
            }
        }

        debugLog(`Fetching scores for: ${url}`);

        try {
            // 両方のAPIを並列で呼び出し
            const [hatenaData, hnData] = await Promise.all([
                fetchHatenaCount(url),
                fetchHackerNewsScore(url)
            ]);

            debugLog(`Hatena result: count=${hatenaData.count}`);
            debugLog(`HN result: score=${hnData.score}, comments=${hnData.comments}`);

            processedUrls.set(url, { element: linkElement, hatena: hatenaData, hn: hnData });

            // 既存の表示を削除
            const existingContainer = linkElement.parentNode?.querySelector('.social-scores');
            if (existingContainer) {
                existingContainer.remove();
                debugLog('Removed existing container');
            }

            // スコアコンテナを作成
            const container = document.createElement('span');
            container.className = 'social-scores';
            
            // インラインスタイルも追加して確実に表示
            container.style.cssText = `
                display: inline-flex !important;
                gap: 4px !important;
                margin-right: 8px !important;
                vertical-align: middle !important;
                position: relative !important;
                opacity: 1 !important;
                visibility: visible !important;
                width: auto !important;
                height: 22px !important;
                min-width: 40px !important;
                min-height: 22px !important;
                flex-shrink: 0 !important;
            `;
            
            debugLog('Created container element');

            // はてなブックマーク数を表示
            if (hatenaData.count > 0) {
                const hatenaLink = document.createElement('a');
                hatenaLink.href = hatenaData.url;
                hatenaLink.target = '_blank';
                hatenaLink.className = 'hatena-score-link';
                hatenaLink.style.cssText = `
                    display: inline-flex !important;
                    text-decoration: none !important;
                    cursor: pointer !important;
                    align-items: center !important;
                    height: 22px !important;
                `;
                hatenaLink.title = `${hatenaData.count} はてなブックマーク`;
                
                const hatenaSpan = document.createElement('span');
                hatenaSpan.className = 'hatena-score score-badge';
                hatenaSpan.style.cssText = `
                    display: inline-block !important;
                    padding: 3px 8px !important;
                    border-radius: 12px !important;
                    font-size: 12px !important;
                    font-weight: bold !important;
                    font-family: Arial, sans-serif !important;
                    background-color: #00a0de !important;
                    color: white !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    line-height: 16px !important;
                    height: 22px !important;
                    min-width: 40px !important;
                    min-height: 22px !important;
                    margin: 0 !important;
                    vertical-align: baseline !important;
                    box-sizing: border-box !important;
                    text-align: center !important;
                `;
                hatenaSpan.textContent = `B ${hatenaData.count}`;
                
                // クリック時の伝播を停止
                hatenaLink.addEventListener('click', function(e) {
                    e.stopPropagation();
                });
                
                hatenaLink.appendChild(hatenaSpan);
                container.appendChild(hatenaLink);
                debugLog(`Added Hatena badge: B ${hatenaData.count}`);
            }

            // Hacker Newsスコアを表示
            if (hnData.score > 0 && hnData.url) {
                const hnLink = document.createElement('a');
                hnLink.href = hnData.url;
                hnLink.target = '_blank';
                hnLink.className = 'hn-score-link';
                hnLink.style.cssText = `
                    display: inline-flex !important;
                    text-decoration: none !important;
                    cursor: pointer !important;
                    align-items: center !important;
                    height: 22px !important;
                `;
                hnLink.title = hnData.comments > 0 ? 
                    `${hnData.score} points, ${hnData.comments} comments` : 
                    `${hnData.score} points`;
                
                const hnSpan = document.createElement('span');
                hnSpan.className = 'hn-score score-badge';
                hnSpan.style.cssText = `
                    display: inline-block !important;
                    padding: 3px 8px !important;
                    border-radius: 12px !important;
                    font-size: 12px !important;
                    font-weight: bold !important;
                    font-family: Arial, sans-serif !important;
                    background-color: #ff6600 !important;
                    color: white !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    line-height: 16px !important;
                    height: 22px !important;
                    min-width: 40px !important;
                    min-height: 22px !important;
                    margin: 0 !important;
                    vertical-align: baseline !important;
                    box-sizing: border-box !important;
                    text-align: center !important;
                `;
                hnSpan.textContent = `Y ${hnData.score}`;
                
                // クリック時の伝播を停止
                hnLink.addEventListener('click', function(e) {
                    e.stopPropagation();
                });
                
                hnLink.appendChild(hnSpan);
                container.appendChild(hnLink);
                debugLog(`Added HN badge: Y ${hnData.score}`);
            }


            // コンテナに要素がある場合のみ挿入
            if (container.children.length > 0) {
                debugLog(`Inserting ${container.children.length} badge(s)`);
                
                if (linkElement.parentNode) {
                    // リンク要素の中に直接追加してみる
                    linkElement.appendChild(container);
                    debugLog('Successfully appended badges to link element');
                } else {
                    debugLog('ERROR: No parent node for link element');
                }
            } else {
                debugLog('No badges to display (both scores are 0)');
            }
        } catch (error) {
            debugLog('Error in fetchAndDisplayScores:', error);
        }
    }

    function processLinks() {
        debugLog('processLinks called');
        const links = getArticleLinks();
        debugLog(`Processing ${links.length} links`);
        
        if (links.length === 0) {
            debugLog('No links found to process');
            return;
        }
        
        links.forEach((link) => {
            fetchAndDisplayScores(link);
        });
    }

    // 初期処理とMutationObserverの設定
    function init() {
        debugLog('Initializing...');
        
        // 初回実行
        processLinks();

        // DOM変更を監視
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

        // URL変更を監視
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                processedUrls.clear();
                debugLog('URL changed, cleared cache');
                processLinks();
            }
        }).observe(document, { subtree: true, childList: true });
    }

    // ページ読み込み後に実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 念のためwindow.loadでも実行
    window.addEventListener('load', () => {
        setTimeout(init, 1000);
    });

})();