// ==UserScript==
// @name         Feedly Hatena & Hacker News Score Display (v2)
// @namespace    https://example.com/
// @version      2.2
// @description  Feedlyの記事一覧にはてなブックマーク数とHacker Newsスコアを表示（右クリック対応版）
// @author       YourName
// @match        https://feedly.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_openInTab
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
            z-index: 9999 !important;
            opacity: 1 !important;
            visibility: visible !important;
        }
        
        .score-link {
            display: inline-block !important;
            padding: 3px 8px !important;
            border-radius: 12px !important;
            font-size: 12px !important;
            line-height: 16px !important;
            font-weight: bold !important;
            font-family: Arial, sans-serif !important;
            text-decoration: none !important;
            cursor: pointer !important;
            transition: transform 0.1s ease !important;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
            position: relative !important;
            z-index: 9999 !important;
            opacity: 1 !important;
            visibility: visible !important;
            white-space: nowrap !important;
            color: white !important;
            border: none !important;
            outline: none !important;
        }
        
        .score-link:hover {
            transform: scale(1.05) !important;
        }
        
        .hatena-score {
            background-color: #00a0de !important;
        }
        
        .hatena-score:hover {
            background-color: #0080be !important;
        }
        
        .hn-score {
            background-color: #ff6600 !important;
        }
        
        .hn-score:hover {
            background-color: #e55500 !important;
        }
    `;
    document.head.appendChild(style);

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
        
        for (const selector of selectorCandidates) {
            const elements = document.querySelectorAll(selector);
            const links = Array.from(elements)
                .filter(a => a.href && a.href.startsWith('http'));
            if (links.length > 0) {
                return links;
            }
        }
        
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

    // 右クリックメニューを作成
    function createContextMenu(url, e) {
        e.preventDefault();
        
        // 既存のメニューを削除
        const existingMenu = document.querySelector('.custom-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        // メニューを作成
        const menu = document.createElement('div');
        menu.className = 'custom-context-menu';
        menu.style.cssText = `
            position: fixed !important;
            top: ${e.clientY}px !important;
            left: ${e.clientX}px !important;
            background: white !important;
            border: 1px solid #ccc !important;
            border-radius: 4px !important;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2) !important;
            z-index: 10000 !important;
            padding: 0 !important;
            font-size: 14px !important;
        `;
        
        const menuItems = [
            { text: '新しいタブで開く', action: () => window.open(url, '_blank') },
            { text: 'リンクをコピー', action: () => navigator.clipboard.writeText(url) }
        ];
        
        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.textContent = item.text;
            menuItem.style.cssText = `
                padding: 8px 16px !important;
                cursor: pointer !important;
                color: #333 !important;
                background: white !important;
            `;
            menuItem.onmouseover = () => menuItem.style.background = '#f0f0f0';
            menuItem.onmouseout = () => menuItem.style.background = 'white';
            menuItem.onclick = () => {
                item.action();
                menu.remove();
            };
            menu.appendChild(menuItem);
        });
        
        document.body.appendChild(menu);
        
        // クリックでメニューを閉じる
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 0);
    }

    async function fetchAndDisplayScores(linkElement) {
        const url = linkElement.href;
        
        if (processedUrls.has(url)) {
            const cached = processedUrls.get(url);
            if (cached.element === linkElement) {
                return;
            }
        }

        try {
            const [hatenaData, hnData] = await Promise.all([
                fetchHatenaCount(url),
                fetchHackerNewsScore(url)
            ]);

            processedUrls.set(url, { element: linkElement, hatena: hatenaData, hn: hnData });

            const existingContainer = linkElement.parentNode?.querySelector('.social-scores');
            if (existingContainer) {
                existingContainer.remove();
            }

            const container = document.createElement('span');
            container.className = 'social-scores';

            // はてなブックマーク数を表示
            if (hatenaData.count > 0) {
                const hatenaButton = document.createElement('button');
                hatenaButton.className = 'score-link hatena-score';
                hatenaButton.textContent = `B ${hatenaData.count}`;
                hatenaButton.title = `${hatenaData.count} はてなブックマーク`;
                
                // 左クリック
                hatenaButton.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(hatenaData.url, '_blank');
                });
                
                // 右クリック
                hatenaButton.addEventListener('contextmenu', function(e) {
                    createContextMenu(hatenaData.url, e);
                });
                
                container.appendChild(hatenaButton);
            }

            // Hacker Newsスコアを表示
            if (hnData.score > 0 && hnData.url) {
                const hnButton = document.createElement('button');
                hnButton.className = 'score-link hn-score';
                hnButton.textContent = `Y ${hnData.score}`;
                hnButton.title = hnData.comments > 0 ? 
                    `${hnData.score} points, ${hnData.comments} comments` : 
                    `${hnData.score} points`;
                
                // 左クリック
                hnButton.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(hnData.url, '_blank');
                });
                
                // 右クリック
                hnButton.addEventListener('contextmenu', function(e) {
                    createContextMenu(hnData.url, e);
                });
                
                container.appendChild(hnButton);
            }

            if (container.children.length > 0) {
                if (linkElement.parentNode) {
                    linkElement.parentNode.insertBefore(container, linkElement);
                }
            }
        } catch (error) {
            console.error('Error in fetchAndDisplayScores:', error);
        }
    }

    function processLinks() {
        const links = getArticleLinks();
        
        if (links.length === 0) {
            return;
        }
        
        links.forEach((link) => {
            fetchAndDisplayScores(link);
        });
    }

    function init() {
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
                processLinks();
            }
        }).observe(document, { subtree: true, childList: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('load', () => {
        setTimeout(init, 1000);
    });

})();