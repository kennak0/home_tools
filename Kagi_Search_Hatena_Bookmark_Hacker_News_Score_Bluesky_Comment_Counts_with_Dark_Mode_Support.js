// ==UserScript==
// @name         Kagi Search Hatena Bookmark, Hacker News Score & Bluesky Comment Counts with Dark Mode Support (Filtered)
// @namespace    http://tampermonkey.net/
// @version      1.11
// @description  Show Hatena Bookmark counts, Hacker News scores and Bluesky comment counts on Kagi search results URLs only, with icon-like style and color adaptation for light/dark backgrounds
// @author       YourName
// @match        https://kagi.com/search*
// @grant        GM_xmlhttpRequest
// @connect      b.hatena.ne.jp
// @connect      hn.algolia.com
// @connect      api.bsky.app
// ==/UserScript==

(function() {
    'use strict';

    console.log('[HatenaBookmark+HN+Bsky] Userscript started');

    const processedUrls = new Set();

    // CSSは元のまま
    const style = document.createElement('style');
    style.textContent = `
        .hatena-bookmark-count, .hn-score-count, .bluesky-comment-count {
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
            transition: background-color 0.3s, color 0.3s;
            text-decoration: none;
            vertical-align: middle;
            line-height: 1.2;
            margin-left: 6px;
        }
        /* はてなブックマーク（青） */
        body:not(.dark-mode) .hatena-bookmark-count {
            background-color: #00a1e9;
            color: white;
            box-shadow: 0 0 4px rgba(0, 161, 233, 0.6);
        }
        body:not(.dark-mode) .hatena-bookmark-count:hover {
            background-color: #007bbf;
            color: #e0f5ff;
            text-decoration: none;
            box-shadow: 0 0 8px rgba(0, 123, 191, 0.8);
        }
        body.dark-mode .hatena-bookmark-count {
            background-color: #007bbf;
            color: #e0f5ff;
            box-shadow: 0 0 4px rgba(0, 123, 191, 0.8);
        }
        body.dark-mode .hatena-bookmark-count:hover {
            background-color: #00a1e9;
            color: white;
            box-shadow: 0 0 8px rgba(0, 161, 233, 0.9);
            text-decoration: none;
        }

        /* Hacker Newsスコア（オレンジ） */
        body:not(.dark-mode) .hn-score-count {
            background-color: #ff6600;
            color: white;
            box-shadow: 0 0 4px rgba(255, 102, 0, 0.6);
        }
        body:not(.dark-mode) .hn-score-count:hover {
            background-color: #cc5200;
            color: #ffd9b3;
            text-decoration: none;
            box-shadow: 0 0 8px rgba(204, 82, 0, 0.8);
        }
        body.dark-mode .hn-score-count {
            background-color: #cc5200;
            color: #ffd9b3;
            box-shadow: 0 0 4px rgba(204, 82, 0, 0.8);
        }
        body.dark-mode .hn-score-count:hover {
            background-color: #ff6600;
            color: white;
            box-shadow: 0 0 8px rgba(255, 102, 0, 0.9);
            text-decoration: none;
        }

        /* Blueskyコメント数（紫） */
        body:not(.dark-mode) .bluesky-comment-count {
            background-color: #6f42c1;
            color: white;
            box-shadow: 0 0 4px rgba(111, 66, 193, 0.6);
        }
        body:not(.dark-mode) .bluesky-comment-count:hover {
            background-color: #5936a2;
            color: #dcd6f7;
            text-decoration: none;
            box-shadow: 0 0 8px rgba(89, 54, 162, 0.8);
        }
        body.dark-mode .bluesky-comment-count {
            background-color: #5936a2;
            color: #dcd6f7;
            box-shadow: 0 0 4px rgba(89, 54, 162, 0.8);
        }
        body.dark-mode .bluesky-comment-count:hover {
            background-color: #6f42c1;
            color: white;
            box-shadow: 0 0 8px rgba(111, 66, 193, 0.9);
            text-decoration: none;
        }
    `;
    document.head.appendChild(style);

    function addBookmarkCount(link) {
        const url = link.href;
        if (processedUrls.has(url)) {
            return;
        }
        processedUrls.add(url);

        // はてなブックマークAPI
        const hatenaApiUrl = 'https://b.hatena.ne.jp/entry/jsonlite/?url=' + encodeURIComponent(url);

        GM_xmlhttpRequest({
            method: 'GET',
            url: hatenaApiUrl,
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const count = data.count || 0;
                        if (count > 0) {
                            showHatenaBadge(link, count, url);
                        }
                    } catch(e) {
                        console.error('[HatenaBookmark] JSON parse error:', e);
                    }
                }
            },
            onerror: function(err) {
                console.error('[HatenaBookmark] GM_xmlhttpRequest error:', err);
            }
        });

        // Hacker Newsスコア取得
        const hnApiUrl = 'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(url) + '&restrictSearchableAttributes=url';

        GM_xmlhttpRequest({
            method: 'GET',
            url: hnApiUrl,
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.hits && data.hits.length > 0) {
                            const points = data.hits[0].points || 0;
                            if (points > 0) {
                                showHnBadge(link, points, data.hits[0].url || url);
                            }
                        }
                    } catch(e) {
                        console.error('[HackerNews] JSON parse error:', e);
                    }
                }
            },
            onerror: function(err) {
                console.error('[HackerNews] GM_xmlhttpRequest error:', err);
            }
        });

        // Blueskyコメント数取得
        const blueskyApiUrl = 'https://api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=' + encodeURIComponent(url);

        GM_xmlhttpRequest({
            method: 'GET',
            url: blueskyApiUrl,
            headers: {
                'Accept': 'application/json'
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const replies = data.thread && data.thread.replies ? data.thread.replies : [];
                        const commentCount = replies.length;
                        if (commentCount > 0) {
                            showBlueskyBadge(link, commentCount, url);
                        }
                    } catch(e) {
                        // 解析エラー等は無視
                    }
                }
            },
            onerror: function(err) {
                // エラーは無視
            }
        });
    }

    // バッジ表示関数は元のまま
    function showHatenaBadge(link, count, targetUrl) {
        if (link.parentNode.querySelector('.hatena-bookmark-count')) {
            return;
        }
        const badge = document.createElement('a');
        badge.textContent = `!B ${count}`;
        badge.href = 'https://b.hatena.ne.jp/entry/' + encodeURIComponent(targetUrl);
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.classList.add('hatena-bookmark-count');
        link.parentNode.insertBefore(badge, link.nextSibling);
    }

    function showHnBadge(link, points, targetUrl) {
        if (link.parentNode.querySelector('.hn-score-count')) {
            return;
        }
        const badge = document.createElement('a');
        badge.textContent = `!HN ${points}`;
        badge.href = targetUrl.startsWith('http') ? targetUrl : 'https://news.ycombinator.com/item?id=' + points;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.classList.add('hn-score-count');

        const hatenaBadge = link.parentNode.querySelector('.hatena-bookmark-count');
        if (hatenaBadge) {
            hatenaBadge.insertAdjacentElement('afterend', badge);
        } else {
            link.parentNode.insertBefore(badge, link.nextSibling);
        }
    }

    function showBlueskyBadge(link, count, targetUrl) {
        if (link.parentNode.querySelector('.bluesky-comment-count')) {
            return;
        }
        const badge = document.createElement('a');
        badge.textContent = `!Bsky ${count}`;
        badge.href = targetUrl;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.classList.add('bluesky-comment-count');

        const hnBadge = link.parentNode.querySelector('.hn-score-count');
        if (hnBadge) {
            hnBadge.insertAdjacentElement('afterend', badge);
        } else {
            const hatenaBadge = link.parentNode.querySelector('.hatena-bookmark-count');
            if (hatenaBadge) {
                hatenaBadge.insertAdjacentElement('afterend', badge);
            } else {
                link.parentNode.insertBefore(badge, link.nextSibling);
            }
        }
    }

    function processLinks() {
        // Kagiの検索結果のリンクのみ対象とする
        // 例: main要素内のaタグ（必要に応じてセレクタを調整してください）
        const searchResultContainer = document.querySelector('main');
        if (!searchResultContainer) return;

        const links = searchResultContainer.querySelectorAll('a[href^="http"]');
        links.forEach(addBookmarkCount);
    }

    processLinks();

    const observer = new MutationObserver(() => {
        processLinks();
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
