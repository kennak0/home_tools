// ==UserScript==
// @name         Feedly Hatena & Hacker News Score Display (v5 - CSS Injection)
// @namespace    https://example.com/
// @version      5.0
// @description  Feedlyの記事一覧にはてなブックマーク数とHacker Newsスコアを表示（CSS擬似要素版）
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
    const HN_SEARCH_API = 'https://hn.algolia.com/api/v1/search?query=';

    const processedUrls = new Map();
    let styleElement = null;

    // XMLHttpRequest wrapper
    const xmlHttpRequest = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : GM_xmlhttpRequest;

    // Base styles for SnapLinks compatible badges - Ultra aggressive styling
    const baseStyles = `
        /* SnapLinks compatible badge styles - Ultra aggressive styling to override Feedly */
        .snaplinks-badge,
        a.snaplinks-badge,
        a[data-snaplinks-url],
        a[data-snaplinks-url].snaplinks-badge,
        p .snaplinks-badge,
        div .snaplinks-badge,
        * .snaplinks-badge {
            display: inline-block !important;
            margin-right: 4px !important;
            padding: 2px 6px !important;
            border-radius: 10px !important;
            font-size: 12px !important;
            font-weight: bold !important;
            text-decoration: none !important;
            color: white !important;
            opacity: 1 !important;
            visibility: visible !important;
            line-height: 1.2 !important;
            vertical-align: middle !important;
            cursor: pointer !important;
            transition: opacity 0.2s ease !important;
            position: relative !important;
            z-index: 99999 !important;
            width: auto !important;
            height: auto !important;
            min-width: 30px !important;
            min-height: 18px !important;
            max-width: none !important;
            max-height: none !important;
            box-sizing: border-box !important;
            float: none !important;
            clear: none !important;
            overflow: visible !important;
            transform: none !important;
            clip: auto !important;
            clip-path: none !important;
        }
        
        .snaplinks-badge:hover,
        a.snaplinks-badge:hover,
        a[data-snaplinks-url]:hover {
            opacity: 0.8 !important;
        }
        
        .snaplinks-badge.hatena,
        a.snaplinks-badge.hatena {
            background-color: #00a0de !important;
        }
        
        .snaplinks-badge.hn,
        a.snaplinks-badge.hn {
            background-color: #ff6600 !important;
        }
        
        /* Super high specificity selectors */
        html body * .snaplinks-badge,
        html body * a[data-snaplinks-url] {
            display: inline-block !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: relative !important;
            z-index: 99999 !important;
        }
        
        /* Target common Feedly containers */
        .EntryList .snaplinks-badge,
        .entry .snaplinks-badge,
        article .snaplinks-badge,
        p .snaplinks-badge,
        div .snaplinks-badge {
            display: inline-block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        
        /* Super aggressive targeting for Hatena badges */
        .snaplinks-badge.hatena a,
        span.snaplinks-badge.hatena a,
        .snaplinks-badge.hatena > a,
        span.snaplinks-badge.hatena > a {
            display: inline-block !important;
            visibility: visible !important;
            opacity: 1 !important;
            color: black !important;
        }
    `;

    function initStyles() {
        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(baseStyles);
        } else {
            styleElement = document.createElement('style');
            styleElement.textContent = baseStyles;
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
                            resolve(data.count || 0);
                        } catch (e) {
                            resolve(0);
                        }
                    } else {
                        resolve(0);
                    }
                },
                onerror: () => resolve(0)
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
                                    objectID: hit.objectID
                                });
                            } else {
                                resolve({ score: 0 });
                            }
                        } catch (e) {
                            resolve({ score: 0 });
                        }
                    } else {
                        resolve({ score: 0 });
                    }
                },
                onerror: () => resolve({ score: 0 })
            });
        });
    }

    async function processLink(linkElement) {
        const url = linkElement.href;
        
        // Skip if already processed
        if (linkElement.getAttribute('data-score-loaded') === 'true') {
            console.log(`[FeedlyScores] Already processed: ${url}`);
            return;
        }
        
        // Skip if currently processing
        if (processedUrls.has(url) && processedUrls.get(url).processing) {
            console.log(`[FeedlyScores] Currently processing: ${url}`);
            return;
        }
        
        console.log(`[FeedlyScores] Starting to process: ${url}`);
        
        // Mark as processing
        processedUrls.set(url, { processing: true });
        
        try {
            // Fetch scores in parallel
            const [hatenaCount, hnData] = await Promise.all([
                fetchHatenaCount(url),
                fetchHackerNewsScore(url)
            ]);
            const hnScore = hnData.score || 0;
            
            // Remove existing badges first
            const existingBadges = linkElement.parentElement?.querySelectorAll('.snaplinks-badge');
            existingBadges?.forEach(badge => badge.remove());
            
            // Store URLs for click handling and add visible badges
            // SOLUTION: Create both badges in a single container to avoid insertion order issues
            const badgesToCreate = [];
            
            // Prepare HN badge data
            if (hnScore > 0 && hnData.objectID) {
                linkElement.setAttribute('data-hn-score', hnScore);
                const hnUrl = `https://news.ycombinator.com/item?id=${hnData.objectID}`;
                linkElement.setAttribute('data-hn-url', hnUrl);
                
                badgesToCreate.push({
                    url: hnUrl,
                    text: `HN:${hnScore}`,
                    badgeClass: 'hn'
                });
            }
            
            // Prepare Hatena badge data
            const HATENA_BOOKMARK_URL = 'https://b.hatena.ne.jp/entry/';
            if (hatenaCount > 0) {
                linkElement.setAttribute('data-hatena-count', hatenaCount);
                linkElement.setAttribute('data-hatena-url', HATENA_BOOKMARK_URL + encodeURIComponent(url));
                
                badgesToCreate.push({
                    url: HATENA_BOOKMARK_URL + encodeURIComponent(url),
                    text: `B:${hatenaCount}`,
                    badgeClass: 'hatena'
                });
            }
            
            // Create all badges in a single container insertion
            if (badgesToCreate.length > 0) {
                addMultipleBadges(linkElement, badgesToCreate);
            }
            
            // Mark as processed
            linkElement.setAttribute('data-score-loaded', 'true');
            
            // Log the results
            const scoreParts = [];
            if (hatenaCount > 0) scoreParts.push(`B:${hatenaCount}`);
            if (hnScore > 0) scoreParts.push(`HN:${hnScore}`);
            
            if (scoreParts.length > 0) {
                console.log(`[FeedlyScores] Added scores for ${url}: ${scoreParts.join(' ')}`);
            }
            
            // Cache the result
            processedUrls.set(url, {
                processing: false,
                hatenaCount,
                hnScore
            });
            
        } catch (error) {
            console.error('[FeedlyScores] Error processing link:', error);
            processedUrls.set(url, { processing: false });
        }
    }

    function processAllLinks() {
        const links = document.querySelectorAll('a.EntryTitleLink, a.entryTitle, a[data-testid="entry-title"], h2 a[href], h3 a[href]');
        const validLinks = Array.from(links).filter(link => link.href && link.href.startsWith('http'));
        
        console.log(`[FeedlyScores] Found ${validLinks.length} links to process`);
        
        validLinks.forEach(link => processLink(link));
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
            
            // Timeout after 10 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, 10000);
        });
    }

    // Force visible styles on badges - Ultra aggressive approach
    function forceVisibleStyles(badge, badgeClass) {
        const color = badgeClass === 'hatena' ? '#00a0de' : '#ff6600';
        
        // Method 1: Direct style properties
        badge.style.setProperty('display', 'inline-block', 'important');
        badge.style.setProperty('visibility', 'visible', 'important');
        badge.style.setProperty('opacity', '1', 'important');
        badge.style.setProperty('position', 'relative', 'important');
        badge.style.setProperty('z-index', '99999', 'important');
        badge.style.setProperty('background-color', color, 'important');
        badge.style.setProperty('color', 'white', 'important');
        badge.style.setProperty('padding', '2px 6px', 'important');
        badge.style.setProperty('border-radius', '10px', 'important');
        badge.style.setProperty('font-size', '12px', 'important');
        badge.style.setProperty('font-weight', 'bold', 'important');
        badge.style.setProperty('text-decoration', 'none', 'important');
        badge.style.setProperty('margin-right', '4px', 'important');
        badge.style.setProperty('min-width', '30px', 'important');
        badge.style.setProperty('min-height', '18px', 'important');
        badge.style.setProperty('box-sizing', 'border-box', 'important');
        badge.style.setProperty('width', 'auto', 'important');
        badge.style.setProperty('height', 'auto', 'important');
        badge.style.setProperty('max-width', 'none', 'important');
        badge.style.setProperty('max-height', 'none', 'important');
        badge.style.setProperty('transform', 'none', 'important');
        badge.style.setProperty('clip', 'auto', 'important');
        badge.style.setProperty('clip-path', 'none', 'important');
        
        // Method 2: Fallback cssText
        badge.style.cssText += `
            display: inline-block !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: relative !important;
            z-index: 99999 !important;
            background-color: ${color} !important;
            color: white !important;
            padding: 2px 6px !important;
            border-radius: 10px !important;
            font-size: 12px !important;
            font-weight: bold !important;
            text-decoration: none !important;
            margin-right: 4px !important;
            min-width: 30px !important;
            min-height: 18px !important;
            box-sizing: border-box !important;
            width: auto !important;
            height: auto !important;
            max-width: none !important;
            max-height: none !important;
            transform: none !important;
            clip: auto !important;
            clip-path: none !important;
        `;
    }

    // Monitor badge for style changes and restore visibility (ultra aggressive)
    function monitorBadge(badge, badgeClass) {
        if (badge._observer) return; // Already monitoring
        
        // Ultra aggressive monitoring with immediate response
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const computedStyle = window.getComputedStyle(badge);
                    if (computedStyle.display === 'none') {
                        console.log(`[FeedlyScores] Detected display:none, forcing visible: ${badge.textContent}`);
                        forceVisibleStyles(badge, badgeClass);
                    }
                }
            });
        });
        
        observer.observe(badge, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
        
        badge._observer = observer;
        
        // Aggressive interval check
        const intervalId = setInterval(() => {
            if (!document.contains(badge)) {
                clearInterval(intervalId);
                observer.disconnect();
                return;
            }
            
            const computedStyle = window.getComputedStyle(badge);
            if (computedStyle.display === 'none') {
                console.log(`[FeedlyScores] Interval check: display:none detected, forcing visible: ${badge.textContent}`);
                forceVisibleStyles(badge, badgeClass);
            }
        }, 1000); // Check every second
        
        // Also try to override any parent container hiding
        const parentElement = badge.parentElement;
        if (parentElement) {
            const parentObserver = new MutationObserver(() => {
                const parentStyle = window.getComputedStyle(parentElement);
                if (parentStyle.display === 'none') {
                    console.log(`[FeedlyScores] Parent is hidden, trying to show badge: ${badge.textContent}`);
                    forceVisibleStyles(badge, badgeClass);
                }
            });
            
            parentObserver.observe(parentElement, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }
    }

    // Add multiple badges in a single container to avoid insertion order issues
    function addMultipleBadges(parentElement, badgeDataArray) {
        // Create main container for all badges
        const mainContainer = document.createElement('span');
        mainContainer.className = 'snaplinks-badge-container';
        mainContainer.style.cssText = `
            display: inline-block !important;
            margin-right: 6px !important;
            opacity: 1 !important;
            visibility: visible !important;
            position: relative !important;
            z-index: 9999 !important;
        `;
        
        // Create each badge inside the container
        badgeDataArray.forEach((badgeData, index) => {
            const { url, text, badgeClass } = badgeData;
            
            // Create span container for each badge
            const span = document.createElement('span');
            span.className = `snaplinks-badge ${badgeClass}`;
            span.setAttribute('data-snaplinks-url', url);
            
            // Create the link inside span
            const badgeLink = document.createElement('a');
            badgeLink.href = url;
            badgeLink.target = '_blank';
            badgeLink.rel = 'noopener noreferrer';
            
            // SOLUTION: Different approaches for Hatena vs HN badges
            if (badgeClass === 'hatena') {
                // For Hatena: Create visible text in span and also in a element for SnapLinks
                span.textContent = text; // span shows the text
                badgeLink.textContent = text; // a element also has text for SnapLinks recognition
                
                // Make the a element an overlay that SnapLinks can detect
                badgeLink.style.setProperty('position', 'absolute', 'important');
                badgeLink.style.setProperty('top', '0', 'important');
                badgeLink.style.setProperty('left', '0', 'important');
                badgeLink.style.setProperty('right', '0', 'important');
                badgeLink.style.setProperty('bottom', '0', 'important');
                badgeLink.style.setProperty('z-index', '99999', 'important');
                badgeLink.style.setProperty('color', 'transparent', 'important'); // Make text invisible
                badgeLink.style.setProperty('background', 'transparent', 'important');
                badgeLink.style.setProperty('border', 'none', 'important');
                badgeLink.style.setProperty('font-size', '12px', 'important'); // Keep normal font size
                badgeLink.style.setProperty('line-height', '16px', 'important');
                badgeLink.style.setProperty('text-decoration', 'none', 'important');
                
                // Additional SnapLinks-specific attributes
                badgeLink.setAttribute('title', text);
                badgeLink.setAttribute('data-snaplinks', 'true');
                badgeLink.setAttribute('role', 'link');
            } else {
                badgeLink.textContent = text; // For HN badges, only in a element
            }
            
            // Apply styles
            const color = badgeClass === 'hatena' ? '#00a0de' : '#ff6600';
            
            // Different styles for Hatena vs HN badges
            const spanStyle = badgeClass === 'hatena'
                ? `
                    display: inline-block !important;
                    margin-right: ${index < badgeDataArray.length - 1 ? '4px' : '0px'} !important;
                    padding: 4px 8px !important;
                    border-radius: 12px !important;
                    font-size: 12px !important;
                    font-weight: bold !important;
                    font-family: Arial, sans-serif !important;
                    text-decoration: none !important;
                    color: white !important;
                    background-color: ${color} !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    line-height: 16px !important;
                    vertical-align: middle !important;
                    cursor: pointer !important;
                    position: relative !important;
                    z-index: 9998 !important;
                    min-width: 36px !important;
                    box-sizing: border-box !important;
                    text-align: center !important;
                    user-select: none !important;
                    box-shadow: 0 0 3px rgba(0,0,0,0.2) !important;
                `
                : `
                    display: inline-block !important;
                    margin-right: ${index < badgeDataArray.length - 1 ? '4px' : '0px'} !important;
                    padding: 4px 8px !important;
                    border-radius: 12px !important;
                    font-size: 12px !important;
                    font-weight: bold !important;
                    font-family: Arial, sans-serif !important;
                    text-decoration: none !important;
                    color: white !important;
                    background-color: ${color} !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    line-height: 16px !important;
                    vertical-align: middle !important;
                    cursor: pointer !important;
                    position: relative !important;
                    z-index: 9999 !important;
                    min-width: 36px !important;
                    box-sizing: border-box !important;
                    text-align: center !important;
                    user-select: none !important;
                    box-shadow: 0 0 3px rgba(0,0,0,0.2) !important;
                `;
            
            const aStyle = `
                all: unset !important;
                color: white !important;
                text-decoration: none !important;
                display: inline-block !important;
                font-size: 12px !important;
                line-height: 16px !important;
                font-weight: bold !important;
                font-family: Arial, sans-serif !important;
                height: auto !important;
                width: 100% !important;
                opacity: 1 !important;
                visibility: visible !important;
                z-index: 9999 !important;
                position: relative !important;
                cursor: pointer !important;
                pointer-events: auto !important;
                text-align: center !important;
                vertical-align: middle !important;
                background: transparent !important;
                border: none !important;
                text-indent: 0 !important;
                text-transform: none !important;
                letter-spacing: normal !important;
                word-spacing: normal !important;
                white-space: nowrap !important;
                text-shadow: none !important;
                -webkit-text-fill-color: white !important;
                -webkit-text-stroke: none !important;
            `;
            
            // Apply styles
            span.setAttribute('style', spanStyle.trim());
            badgeLink.setAttribute('style', aStyle.trim());
            
            // Ultra aggressive style enforcement
            badgeLink.style.setProperty('display', 'inline-block', 'important');
            badgeLink.style.setProperty('visibility', 'visible', 'important');
            badgeLink.style.setProperty('opacity', '1', 'important');
            badgeLink.style.setProperty('color', 'white', 'important');
            
            // Event handler
            badgeLink.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                window.open(url, '_blank');
            });
            
            // For Hatena badges, also make the span clickable and SnapLinks-compatible
            if (badgeClass === 'hatena') {
                span.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(url, '_blank');
                });
                // Additional attributes for SnapLinks compatibility on span element
                span.setAttribute('href', url);
                span.setAttribute('target', '_blank');
            }
            
            // Assemble - different structure for Hatena vs HN badges
            if (badgeClass === 'hatena') {
                // For Hatena: Create a wrapper containing both span and a independently
                const hatenaWrapper = document.createElement('div');
                hatenaWrapper.style.cssText = `
                    display: inline-block !important;
                    position: relative !important;
                    margin-right: ${index < badgeDataArray.length - 1 ? '4px' : '0px'} !important;
                `;
                
                // Add both elements to wrapper
                hatenaWrapper.appendChild(span);
                hatenaWrapper.appendChild(badgeLink);
                mainContainer.appendChild(hatenaWrapper);
                
                console.log(`[FeedlyScores] Created Hatena badge with wrapper: ${text}`);
            } else {
                // For HN: Normal structure
                span.appendChild(badgeLink);
                mainContainer.appendChild(span);
            }
            
            console.log(`[FeedlyScores] Created badge in container: ${text}`);
        });
        
        // Insert the entire container at once
        if (parentElement.parentNode) {
            try {
                parentElement.parentNode.insertBefore(mainContainer, parentElement);
                console.log(`[FeedlyScores] Successfully inserted badge container with ${badgeDataArray.length} badges`);
                
                // Verify all badges after insertion
                setTimeout(() => {
                    badgeDataArray.forEach((badgeData) => {
                        const { url, text, badgeClass } = badgeData;
                        const badgeInDOM = mainContainer.querySelector(`span[data-snaplinks-url="${url}"]`);
                        if (badgeInDOM) {
                            const aElement = badgeInDOM.querySelector('a');
                            if (aElement) {
                                const aStyle = window.getComputedStyle(aElement);
                                const spanStyle = window.getComputedStyle(badgeInDOM);
                                
                                console.log(`[FeedlyScores] Container badge ${text}:`);
                                console.log(`  Span: display=${spanStyle.display}, bg=${spanStyle.backgroundColor}, height=${spanStyle.height}`);
                                console.log(`  A: display=${aStyle.display}, color=${aStyle.color}, fontSize=${aStyle.fontSize}`);
                                console.log(`  A: width=${aStyle.width}, height=${aStyle.height}, overflow=${aStyle.overflow}`);
                                console.log(`  A: textContent="${aElement.textContent}", innerHTML="${aElement.innerHTML}"`);
                                
                                // Check if text is actually there
                                if (!aElement.textContent || aElement.textContent.trim() === '') {
                                    console.log(`[FeedlyScores] WARNING: No text content in ${text} badge!`);
                                    aElement.textContent = text;
                                }
                                
                                // Get bounding rect
                                const rect = aElement.getBoundingClientRect();
                                console.log(`  A rect: ${rect.width}x${rect.height} at ${rect.left},${rect.top}`);
                                
                                // If it's Hatena badge and seems invisible, try different approaches
                                if (badgeClass === 'hatena') {
                                    // Force text to be black temporarily to see if it's a color issue
                                    console.log(`[FeedlyScores] Testing Hatena badge with black text...`);
                                    aElement.style.setProperty('color', 'black', 'important');
                                    aElement.style.setProperty('background-color', 'yellow', 'important');
                                    aElement.style.setProperty('padding', '4px', 'important');
                                    aElement.style.setProperty('font-size', '14px', 'important');
                                    aElement.style.setProperty('line-height', 'normal', 'important');
                                    aElement.style.setProperty('overflow', 'visible', 'important');
                                    aElement.style.setProperty('white-space', 'nowrap', 'important');
                                    aElement.style.setProperty('text-overflow', 'clip', 'important');
                                    
                                    // Re-check after forcing styles
                                    setTimeout(() => {
                                        const newStyle = window.getComputedStyle(aElement);
                                        console.log(`[FeedlyScores] After forcing Hatena styles: color=${newStyle.color}, bg=${newStyle.backgroundColor}`);
                                    }, 50);
                                }
                                
                                if (aStyle.display === 'none') {
                                    console.log(`[FeedlyScores] CONTAINER APPROACH: Still fighting display:none on ${text}`);
                                    aElement.style.setProperty('display', 'inline-block', 'important');
                                    aElement.style.setProperty('visibility', 'visible', 'important');
                                    aElement.style.setProperty('opacity', '1', 'important');
                                }
                            }
                        }
                    });
                }, 100);
                
                return mainContainer;
            } catch (e) {
                console.log(`[FeedlyScores] Failed to insert badge container: ${e.message}`);
                return null;
            }
        }
        
        return null;
    }

    // Add visible badge links for SnapLinks compatibility - Firefox compatible approach
    function addSnapLinksCompatibleBadge(parentElement, url, text, badgeClass) {
        // Check if already added
        const existingBadge = parentElement.parentElement?.querySelector(`span[data-snaplinks-url="${url}"]`);
        if (existingBadge) {
            return existingBadge;
        }
        
        // Create span container (like the working script)
        const span = document.createElement('span');
        span.className = `snaplinks-badge ${badgeClass}`;
        span.setAttribute('data-snaplinks-url', url);
        
        // Create the link inside span
        const badgeLink = document.createElement('a');
        badgeLink.href = url;
        badgeLink.target = '_blank';
        badgeLink.rel = 'noopener noreferrer';
        badgeLink.textContent = text;
        
        // TEST: Apply EXACTLY the same styles to both badges to isolate issue
        const color = '#ff6600'; // TEST: Use same color as HN for both badges
        
        const spanStyle = `
            display: inline-block !important;
            margin-right: 6px !important;
            padding: 4px 8px !important;
            border-radius: 12px !important;
            font-size: 12px !important;
            font-weight: bold !important;
            font-family: Arial, sans-serif !important;
            text-decoration: none !important;
            color: white !important;
            background-color: ${color} !important;
            opacity: 1 !important;
            visibility: visible !important;
            line-height: 16px !important;
            vertical-align: middle !important;
            cursor: pointer !important;
            position: relative !important;
            z-index: 9999 !important;
            min-width: 36px !important;
            min-height: auto !important;
            box-sizing: border-box !important;
            width: auto !important;
            height: auto !important;
            max-width: none !important;
            max-height: none !important;
            transform: none !important;
            clip: auto !important;
            clip-path: none !important;
            text-align: center !important;
            user-select: none !important;
            box-shadow: 0 0 3px rgba(0,0,0,0.2) !important;
        `;
        
        const aStyle = `
            color: white !important;
            text-decoration: none !important;
            display: inline-block !important;
            font-size: 12px !important;
            line-height: 16px !important;
            font-weight: bold !important;
            font-family: Arial, sans-serif !important;
            height: auto !important;
            width: 100% !important;
            opacity: 1 !important;
            visibility: visible !important;
            z-index: 9999 !important;
            position: relative !important;
            cursor: pointer !important;
            pointer-events: auto !important;
            text-align: center !important;
            vertical-align: middle !important;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            text-shadow: none !important;
            letter-spacing: normal !important;
            word-spacing: normal !important;
            white-space: nowrap !important;
        `;
        
        // Use setAttribute method (Firefox compatible)
        span.setAttribute('style', spanStyle.trim());
        badgeLink.setAttribute('style', aStyle.trim());
        
        // ULTRA AGGRESSIVE: Force a element to be visible using all possible methods
        badgeLink.style.setProperty('display', 'inline-block', 'important');
        badgeLink.style.setProperty('visibility', 'visible', 'important');
        badgeLink.style.setProperty('opacity', '1', 'important');
        badgeLink.style.setProperty('color', 'white', 'important');
        badgeLink.style.setProperty('font-size', '12px', 'important');
        badgeLink.style.setProperty('font-weight', 'bold', 'important');
        badgeLink.style.setProperty('text-decoration', 'none', 'important');
        badgeLink.style.setProperty('line-height', '16px', 'important');
        badgeLink.style.setProperty('height', 'auto', 'important');
        badgeLink.style.setProperty('width', '100%', 'important');
        badgeLink.style.setProperty('z-index', '99999', 'important');
        badgeLink.style.setProperty('position', 'relative', 'important');
        
        // Additional CSS override using cssText
        badgeLink.style.cssText += `
            display: inline-block !important;
            visibility: visible !important;
            opacity: 1 !important;
            color: white !important;
            font-size: 12px !important;
            font-weight: bold !important;
            text-decoration: none !important;
            line-height: 16px !important;
            height: auto !important;
            width: 100% !important;
            z-index: 99999 !important;
            position: relative !important;
        `;
        
        // Prevent click from bubbling to parent link
        badgeLink.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.open(url, '_blank');
        });
        
        // Assemble the structure
        span.appendChild(badgeLink);
        
        // Insert using the working script's method: insertBefore at parent level
        let inserted = false;
        
        if (parentElement.parentNode) {
            try {
                parentElement.parentNode.insertBefore(span, parentElement);
                inserted = true;
                console.log(`[FeedlyScores] Successfully inserted badge before title link: ${text}`);
            } catch (e) {
                console.log(`[FeedlyScores] Failed to insert badge: ${e.message}`);
            }
        }
        
        if (!inserted) {
            console.log(`[FeedlyScores] Failed to insert badge: no parent node`);
            return null;
        }
        
        // Verify the badge is in the DOM and continuously force visibility
        setTimeout(() => {
            const badgeInDOM = document.querySelector(`span[data-snaplinks-url="${url}"]`);
            if (badgeInDOM) {
                console.log(`[FeedlyScores] Badge verified in DOM: ${text}`);
                
                // Check computed styles
                const computedStyle = window.getComputedStyle(badgeInDOM);
                console.log(`[FeedlyScores] Badge computed styles - display: ${computedStyle.display}, visibility: ${computedStyle.visibility}, opacity: ${computedStyle.opacity}`);
                
                const rect = badgeInDOM.getBoundingClientRect();
                console.log(`[FeedlyScores] Badge dimensions: ${rect.width}x${rect.height}, position: ${rect.left},${rect.top}`);
                
                // Check a element inside span
                const aElement = badgeInDOM.querySelector('a');
                if (aElement) {
                    console.log(`[FeedlyScores] A element text: "${aElement.textContent}"`);
                    
                    const aStyle = window.getComputedStyle(aElement);
                    console.log(`[FeedlyScores] A element computed styles - color: ${aStyle.color}, font-size: ${aStyle.fontSize}, display: ${aStyle.display}`);
                    
                    // If display is none, force it to be visible
                    if (aStyle.display === 'none') {
                        console.log(`[FeedlyScores] FORCING A ELEMENT TO BE VISIBLE: ${text}`);
                        
                        // Method 1: Direct style manipulation
                        aElement.style.setProperty('display', 'inline-block', 'important');
                        aElement.style.setProperty('visibility', 'visible', 'important');
                        aElement.style.setProperty('opacity', '1', 'important');
                        
                        // Method 2: Override with cssText
                        aElement.style.cssText += `
                            display: inline-block !important;
                            visibility: visible !important;
                            opacity: 1 !important;
                            color: white !important;
                            font-size: 12px !important;
                            font-weight: bold !important;
                        `;
                        
                        // Method 3: Create a continuous observer to fight back
                        const observer = new MutationObserver(() => {
                            const newStyle = window.getComputedStyle(aElement);
                            if (newStyle.display === 'none') {
                                console.log(`[FeedlyScores] Fighting back display:none on: ${text}`);
                                aElement.style.setProperty('display', 'inline-block', 'important');
                                aElement.style.setProperty('visibility', 'visible', 'important');
                                aElement.style.setProperty('opacity', '1', 'important');
                            }
                        });
                        
                        observer.observe(aElement, {
                            attributes: true,
                            attributeFilter: ['style', 'class']
                        });
                        
                        // Also check periodically
                        const intervalId = setInterval(() => {
                            if (!document.contains(aElement)) {
                                clearInterval(intervalId);
                                observer.disconnect();
                                return;
                            }
                            const currentStyle = window.getComputedStyle(aElement);
                            if (currentStyle.display === 'none') {
                                console.log(`[FeedlyScores] Periodic check: forcing visibility on: ${text}`);
                                aElement.style.setProperty('display', 'inline-block', 'important');
                                aElement.style.setProperty('visibility', 'visible', 'important');
                                aElement.style.setProperty('opacity', '1', 'important');
                            }
                        }, 500);
                    }
                    
                    // INVESTIGATION: Why does display:none only affect Hatena badges?
                    console.log(`[FeedlyScores] INVESTIGATION for ${text}:`);
                    console.log(`[FeedlyScores] - Element tag: ${aElement.tagName}`);
                    console.log(`[FeedlyScores] - Element class: "${aElement.className}"`);
                    console.log(`[FeedlyScores] - Element id: "${aElement.id}"`);
                    console.log(`[FeedlyScores] - Element href: "${aElement.href}"`);
                    console.log(`[FeedlyScores] - Element textContent: "${aElement.textContent}"`);
                    console.log(`[FeedlyScores] - Parent class: "${aElement.parentElement?.className}"`);
                    console.log(`[FeedlyScores] - Parent tag: "${aElement.parentElement?.tagName}"`);
                    
                    // Get all CSS rules that might apply
                    const allRules = [];
                    for (let i = 0; i < document.styleSheets.length; i++) {
                        try {
                            const sheet = document.styleSheets[i];
                            const rules = sheet.cssRules || sheet.rules;
                            for (let j = 0; j < rules.length; j++) {
                                const rule = rules[j];
                                if (rule.selectorText && rule.style && rule.style.display === 'none') {
                                    // Check if this rule might apply to our element
                                    try {
                                        if (aElement.matches(rule.selectorText)) {
                                            allRules.push({
                                                selector: rule.selectorText,
                                                display: rule.style.display,
                                                href: sheet.href || 'inline'
                                            });
                                        }
                                    } catch (e) {
                                        // Invalid selector, skip
                                    }
                                }
                            }
                        } catch (e) {
                            // Cross-origin stylesheet, skip
                        }
                    }
                    
                    if (allRules.length > 0) {
                        console.log(`[FeedlyScores] CSS rules applying display:none to ${text}:`, allRules);
                    } else {
                        console.log(`[FeedlyScores] No explicit display:none rules found for ${text}`);
                    }
                    
                    // Also check if the element matches specific patterns
                    const patterns = [
                        'a[href*="hatena"]',
                        'a[href*="b.hatena"]',
                        'a[href*="bookmark"]',
                        'a[href*="entry"]',
                        'a[textContent*="B:"]',
                        'a[textContent*="B "]',
                        '.hatena',
                        '.snaplinks-badge.hatena'
                    ];
                    
                    patterns.forEach(pattern => {
                        try {
                            if (aElement.matches(pattern)) {
                                console.log(`[FeedlyScores] Element matches pattern: ${pattern}`);
                            }
                        } catch (e) {
                            // Invalid pattern
                        }
                    });
                    
                    // Full computed styles
                    console.log(`[FeedlyScores] Full computed styles for ${text}:`, {
                        display: aStyle.display,
                        visibility: aStyle.visibility,
                        opacity: aStyle.opacity,
                        color: aStyle.color,
                        fontSize: aStyle.fontSize,
                        fontWeight: aStyle.fontWeight,
                        backgroundColor: aStyle.backgroundColor,
                        textDecoration: aStyle.textDecoration,
                        transform: aStyle.transform,
                        zIndex: aStyle.zIndex,
                        position: aStyle.position,
                        clip: aStyle.clip,
                        clipPath: aStyle.clipPath
                    });
                }
            }
        }, 100);
        
        return span;
    }
    

    async function init() {
        console.log('[FeedlyScores] v5 Initializing...');
        
        // Initialize styles
        initStyles();
        
        // Wait for content
        await waitForContent();
        
        // Initial processing
        processAllLinks();
        
        // Monitor for changes (optimized)
        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            // Only process if there are relevant changes
            const hasRelevantChanges = mutations.some(mutation => 
                mutation.type === 'childList' && 
                mutation.addedNodes.length > 0 &&
                Array.from(mutation.addedNodes).some(node => 
                    node.nodeType === 1 && 
                    (node.tagName === 'ARTICLE' || node.querySelector && node.querySelector('a.EntryTitleLink, a.entryTitle'))
                )
            );
            
            if (!hasRelevantChanges) return;
            
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processAllLinks, 2000); // Increased from 1000ms to 2000ms
        });
        
        // Observe specific container if possible
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
        
        // Monitor URL changes (reduced frequency)
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                console.log('[FeedlyScores] URL changed, reprocessing...');
                setTimeout(processAllLinks, 2000);
            }
        }, 5000); // Increased from 2000ms to 5000ms
    }

    // Start when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();