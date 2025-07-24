// ==UserScript==
// @name         Kagi Hatena & Hacker News Badge Display
// @namespace    https://example.com/
// @version      1.0
// @description  Kagiの検索結果にはてなブックマーク数とHacker Newsスコアを表示
// @author       YourName
// @match        https://kagi.com/search*
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

    // シンプルなCSS（Kagiの制限を回避するため別クラス名を使用）
    const styles = `
        .kagi-hatena-badge, .hn-score-count {
            display: inline-block;
            min-width: 28px;
            padding: 2px 6px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 0.85em;
            font-family: Arial, sans-serif;
            text-align: center;
            cursor: pointer;
            user-select: none;
            text-decoration: none;
            vertical-align: middle;
            line-height: 1.2;
            margin-left: 6px;
        }
        .kagi-hatena-badge {
            background-color: #00a1e9;
            color: white;
            box-shadow: 0 0 4px rgba(0, 161, 233, 0.6);
        }
        .kagi-hatena-badge:hover {
            background-color: #007bbf;
            color: #e0f5ff;
            text-decoration: none;
            box-shadow: 0 0 8px rgba(0, 123, 191, 0.8);
        }
        .hn-score-count {
            background-color: #ff6600;
            color: white;
            box-shadow: 0 0 4px rgba(255, 102, 0, 0.6);
        }
        .hn-score-count:hover {
            background-color: #cc5200;
            color: #ffd9b3;
            text-decoration: none;
            box-shadow: 0 0 8px rgba(204, 82, 0, 0.8);
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
                            const count = data.count || 0;
                            resolve(count);
                        } catch (e) {
                            console.error('[KagiScores] Error parsing Hatena response:', e);
                            resolve(0);
                        }
                    } else {
                        resolve(0);
                    }
                },
                onerror: (error) => {
                    console.error('[KagiScores] Hatena API request error:', error);
                    resolve(0);
                }
            });
        });
    }

    function fetchHackerNewsScore(url) {
        return new Promise((resolve) => {
            // HN検索APIは完全なURLではなくドメインで検索するほうが良い結果を得られる
            const domain = new URL(url).hostname.replace('www.', '');
            const searchUrl = HN_SEARCH_API + encodeURIComponent(domain);
            
            
            xmlHttpRequest({
                method: 'GET',
                url: searchUrl,
                onload: function(response) {
                    
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            
                            if (data.hits && data.hits.length > 0) {
                                // URLが一致するものを探す
                                let bestMatch = null;
                                for (const hit of data.hits) {
                                    // 完全一致またはドメインが一致する記事を探す
                                    if (hit.url === url || 
                                        (hit.url && new URL(hit.url).hostname === new URL(url).hostname)) {
                                        if (!bestMatch || hit.points > bestMatch.points) {
                                            bestMatch = hit;
                                        }
                                    }
                                }
                                
                                if (bestMatch) {
                                    resolve({
                                        score: bestMatch.points || 0,
                                        objectID: bestMatch.objectID
                                    });
                                } else {
                                    // 完全一致がない場合は最初のヒットを使用
                                    const hit = data.hits[0];
                                    resolve({
                                        score: hit.points || 0,
                                        objectID: hit.objectID
                                    });
                                }
                            } else {
                                resolve({ score: 0 });
                            }
                        } catch (e) {
                            console.error('[KagiScores] Error parsing HN response:', e);
                            resolve({ score: 0 });
                        }
                    } else {
                        resolve({ score: 0 });
                    }
                },
                onerror: (error) => {
                    console.error('[KagiScores] HN API request error:', error);
                    resolve({ score: 0 });
                }
            });
        });
    }

    function extractUrl(element) {
        // Kagiの検索結果のURL取得
        // 通常の検索結果: <a>タグ内のhref
        const linkElement = element.tagName === 'A' ? element : element.querySelector('a');
        if (linkElement && linkElement.href) {
            return linkElement.href;
        }
        
        // URLテキストから抽出（Kagiは時々URL表示する）
        const urlText = element.querySelector('.url, .cite');
        if (urlText && urlText.textContent) {
            const match = urlText.textContent.match(/https?:\/\/[^\s]+/);
            if (match) {
                return match[0];
            }
        }
        
        return null;
    }

    function createHatenaBadge(hatenaCount, url) {
        if (hatenaCount <= 0) return null;
        
        const badge = document.createElement('a');
        badge.textContent = `!B ${hatenaCount}`;
        // Kagiの広告ブロックを回避するため、hrefを設定しない
        badge.addEventListener('click', (e) => {
            e.preventDefault();
            window.open(HATENA_BOOKMARK_URL + encodeURIComponent(url), '_blank', 'noopener,noreferrer');
        });
        badge.style.cursor = 'pointer';
        badge.classList.add('hn-score-count');  // HNバッジと同じクラスを使用
        
        // はてなブルーに色を変更
        badge.style.backgroundColor = '#00a1e9';
        badge.style.boxShadow = '0 0 4px rgba(0, 161, 233, 0.6)';
        
        return badge;
    }
    
    function createHNBadge(hnData) {
        if (!(hnData.score > 0 && hnData.objectID)) return null;
        
        const badge = document.createElement('a');
        badge.textContent = `!HN ${hnData.score}`;
        badge.href = `https://news.ycombinator.com/item?id=${hnData.objectID}`;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.classList.add('hn-score-count');
        
        return badge;
    }

    async function processSearchResult(resultElement) {
        // タイトル要素を探す（Kagiの実際のクラス名に基づいて）
        const titleElement = resultElement.querySelector(
            'a.__sri_title_link, ' +         // Kagiの実際のタイトルクラス
            'a[class*="sri_title_link"], ' + // sri_title_linkを含むクラス
            '.sri-title a, ' +               // sri-titleクラス内のリンク
            '._0_TITLE a'                    // _0_TITLEクラス内のリンク
        );
        
        if (!titleElement) {
            // タイトルが見つからない場合はスキップ（説明文の要素など）
            return;
        }
        
        const url = extractUrl(titleElement);
        if (!url || !url.startsWith('http')) {
            return;
        }
        
        // 既に処理済みか確認（URLベースでチェック）
        if (processedUrls.has(url) && processedUrls.get(url).processed) {
            return;
        }
        
        // 処理中か確認
        if (processingQueue.has(url)) {
            return;
        }
        
        // キャッシュがあるか確認
        if (processedUrls.has(url)) {
            const cached = processedUrls.get(url);
            if (cached.hatenaCount > 0 || cached.hnScore > 0) {
                const container = createBadgeContainer(cached.hatenaCount, cached.hnData, url);
                titleElement.appendChild(container);
            }
            return;
        }
        
        processingQueue.add(url);
        
        try {
            // APIリクエストを並列実行
            const [hatenaCount, hnData] = await Promise.all([
                fetchHatenaCount(url),
                fetchHackerNewsScore(url)
            ]);
            
            // キャッシュに保存（処理済みフラグを追加）
            processedUrls.set(url, {
                hatenaCount,
                hnData,
                hnScore: hnData.score || 0,
                processed: true
            });
            
            // 修正版：新しいクラス名ではてなバッジを表示
            if (hatenaCount > 0) {
                const hatenaBadge = createHatenaBadge(hatenaCount, url);
                if (hatenaBadge && titleElement.parentNode) {
                    titleElement.parentNode.insertBefore(hatenaBadge, titleElement.nextSibling);
                    console.log(`[KagiScores] Added Hatena badge for ${url}: B:${hatenaCount}`);
                }
            }
            
            if (hnData.score > 0) {
                const hnBadge = createHNBadge(hnData);
                if (hnBadge && titleElement.parentNode) {
                    // はてなバッジがある場合はその後に、なければタイトルの後に  
                    const existingBadges = titleElement.parentNode.querySelectorAll('.hn-score-count');
                    if (existingBadges.length > 0) {
                        const lastBadge = existingBadges[existingBadges.length - 1];
                        lastBadge.insertAdjacentElement('afterend', hnBadge);
                    } else {
                        titleElement.parentNode.insertBefore(hnBadge, titleElement.nextSibling);
                    }
                    console.log(`[KagiScores] Added HN badge for ${url}: HN:${hnData.score}`);
                }
            }
            
        } catch (error) {
            console.error('[KagiScores] Error processing URL:', url, error);
        } finally {
            processingQueue.delete(url);
        }
    }

    function processAllResults() {
        // タイトルリンクを直接探す（重複を避けるため）
        const titleLinks = document.querySelectorAll('a.__sri_title_link, a[class*="sri_title_link"]');
        
        
        const processedInThisRun = new Set();
        
        titleLinks.forEach(titleLink => {
            const url = titleLink.href;
            
            // このセッションで既に処理済みか確認
            if (processedInThisRun.has(url)) {
                return;
            }
            
            // 既にバッジがあるか確認（同じクラスを使用するため数で判定）
            const existingBadges = titleLink.parentElement?.querySelectorAll('.hn-score-count');
            
            if (existingBadges && existingBadges.length >= 2) {
                // 両方のバッジが既にある場合は、キャッシュにマークして重複処理を避ける
                processedUrls.set(url, { processed: true, hasExistingBadge: true });
                processedInThisRun.add(url);
                return;
            }
            
            // 広告やスポンサーリンクをスキップ
            if (titleLink.closest('.ad') || 
                titleLink.closest('.sponsored') ||
                titleLink.closest('[class*="sponsored"]')) {
                return;
            }
            
            processedInThisRun.add(url);
            
            // リンクの親要素を検索結果として処理
            const resultElement = titleLink.closest('._0_SRI') || titleLink.closest('[class*="_SRI"]');
            if (resultElement) {
                processSearchResult(resultElement);
            }
        });
    }

    function waitForResults() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const results = document.querySelectorAll('.result, [data-testid="result"], .search-result');
                if (results.length > 0) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);
            
            // 10秒でタイムアウト
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, 10000);
        });
    }

    async function init() {
        console.log('[KagiScores] Initializing...');
        
        // スタイルを適用
        initStyles();
        
        // 結果を待つ
        await waitForResults();
        
        // 初回処理
        processAllResults();
        
        // DOM変更を監視
        const observer = new MutationObserver((mutations) => {
            let hasNewResults = false;
            
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (
                            node.classList?.contains('result') ||
                            node.querySelector?.('.result') ||
                            node.querySelector?.('a[href*="http"]')
                        )) {
                            hasNewResults = true;
                            break;
                        }
                    }
                }
            }
            
            if (hasNewResults) {
                setTimeout(processAllResults, 500);
            }
        });
        
        // 監視開始
        const container = document.querySelector('main, #root, .results, body');
        if (container) {
            observer.observe(container, {
                childList: true,
                subtree: true
            });
        }
        
        // URL変更を監視（Kagiは動的にコンテンツを更新する可能性）
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                console.log('[KagiScores] URL changed, reprocessing...');
                setTimeout(processAllResults, 1000);
            }
        }, 1000);
    }

    // 開始
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();