// ==UserScript==
// @name         X — Region badge (lazy, one-by-one) from /about
// @namespace    ehsan.tamper.x.about.regionbadge
// @version      2.3
// @description  shows only the “Account based in” region as circle beside profile image.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// ==/UserScript==

(function () {
  'use strict';

  /* -------------------- config -------------------- */
  const PLACE_BESIDE_AVATAR = true;
  const LOAD_TIMEOUT        = 15000;
  const POLL_INTERVAL       = 150;
  const VIEWPORT_ROOTMARGIN = '300px 0px';
  const QUEUE_DELAY_MS      = 300;
  const BAD_TOP_ROUTES = new Set(['home','explore','notifications','messages','settings','compose','i','search']);


  const FLAGS = {
    'iran':'🇮🇷','west asia':'🇮🇷','canada': '🇨🇦','germany':'🇩🇪','united states':'🇺🇸','usa':'🇺🇸',
    'uk':'🇬🇧','united kingdom':'🇬🇧','france':'🇫🇷','italy':'🇮🇹','spain':'🇪🇸',
    'netherlands':'🇳🇱','australia':'🇦🇺','india':'🇮🇳','japan':'🇯🇵','south korea':'🇰🇷',
    'china':'🇨🇳','mexico':'🇲🇽','brazil':'🇧🇷','turkey':'🇹🇷','poland':'🇵🇱',
    'russia':'🇷🇺','sweden':'🇸🇪','norway':'🇳🇴','denmark':'🇩🇰','switzerland':'🇨🇭',
    'austria':'🇦🇹','belgium':'🇧🇪','portugal':'🇵🇹','argentina':'🇦🇷','armenia':'🇦🇲','azerbaijan':'🇦🇿','afghanistan':'🇦🇫',
  'albania':'🇦🇱','algeria':'🇩🇿','angola':'🇦🇴','bangladesh':'🇧🇩','belarus':'🇧🇾',
  'bolivia':'🇧🇴','bosnia':'🇧🇦','bulgaria':'🇧🇬','cambodia':'🇰🇭','cameroon':'🇨🇲',
  'chile':'🇨🇱','colombia':'🇨🇴','costa rica':'🇨🇷','croatia':'🇭🇷','cuba':'🇨🇺',
  'czech republic':'🇨🇿','dominican republic':'🇩🇴','ecuador':'🇪🇨','egypt':'🇪🇬',
  'estonia':'🇪🇪','ethiopia':'🇪🇹','finland':'🇫🇮','georgia':'🇬🇪','greece':'🇬🇷',
  'hong kong':'🇭🇰','hungary':'🇭🇺','iceland':'🇮🇸','indonesia':'🇮🇩','iraq':'🇮🇶',
  'ireland':'🇮🇪','israel':'🇮🇱','jordan':'🇯🇴','kazakhstan':'🇰🇿','kenya':'🇰🇪',
  'kuwait':'🇰🇼','kyrgyzstan':'🇰🇬','lebanon':'🇱🇧','libya':'🇱🇾','lithuania':'🇱🇹',
  'luxembourg':'🇱🇺','latvia':'🇱🇻','malaysia':'🇲🇾','morocco':'🇲🇦','mongolia':'🇲🇳',
  'nepal':'🇳🇵','new zealand':'🇳🇿','nigeria':'🇳🇬','north korea':'🇰🇵','oman':'🇴🇲',
  'pakistan':'🇵🇰','paraguay':'🇵🇾','peru':'🇵🇪','philippines':'🇵🇭','qatar':'🇶🇦',
  'romania':'🇷🇴','saudi arabia':'🇸🇦','serbia':'🇷🇸','singapore':'🇸🇬','slovakia':'🇸🇰',
  'slovenia':'🇸🇮','south africa':'🇿🇦','sri lanka':'🇱🇰','syria':'🇸🇾','taiwan':'🇹🇼',
  'tajikistan':'🇹🇯','tanzania':'🇹🇿','thailand':'🇹🇭','tunisia':'🇹🇳','turkmenistan':'🇹🇲',
  'ukraine':'🇺🇦','united arab emirates':'🇦🇪','uruguay':'🇺🇾','uzbekistan':'🇺🇿',
  'venezuela':'🇻🇪','vietnam':'🇻🇳','yemen':'🇾🇪','zambia':'🇿🇲','zimbabwe':'🇿🇼'
  };

  /* ---------------- session state ----------------- */
  const mem     = new Map();
  const enqSet  = new Set();
  const opened  = new Set();
  const queue   = [];
  let processingUser = null;
  const seenArticles = new WeakSet();

  const BROADCAST_KEY = 'tm_about_region_broadcast_v1';

  /* ---------------- path helpers ------------------ */
  const parts = () => location.pathname.replace(/\/+$/,'').split('/').filter(Boolean);
  const isAbout = () => parts().length === 2 && parts()[1].toLowerCase() === 'about';
  const currentUserFromPath = () => {
    const p = parts();
    if (!p.length) return null;
    if (BAD_TOP_ROUTES.has(p[0].toLowerCase())) return null;
    return p[0];
  };

  /* --------------- DOM utilities ------------------ */
  function usernameFromHeaderBox(box) {
    const a = box.querySelector('a[href^="/"]:not([href*="/status/"])');
    if (!a) return null;
    try {
      const seg = new URL(a.href, location.origin).pathname.split('/').filter(Boolean)[0];
      if (!seg || BAD_TOP_ROUTES.has(seg.toLowerCase())) return null;
      return seg;
    } catch { return null; }
  }

  function tweetArticleFromNameBox(box) {
    return box.closest('article[data-testid="tweet"], article[role="article"], article');
  }

  // Find the avatar container's parent to insert badge beside it
  function findAvatarParentContainer(article) {
    // Look for the avatar container
    const avatarContainer = article.querySelector('[data-testid="Tweet-User-Avatar"], [data-testid="UserAvatar-Container"]');
    if (avatarContainer && avatarContainer.parentNode) return avatarContainer.parentNode;

    // Fallback: find any container with profile image and get its parent
    const imgContainers = article.querySelectorAll('img[src*="profile_images"], [src*="twimg.com"]');
    for (const img of imgContainers) {
      const container = img.closest('div[style*="width"], div[style*="height"]');
      if (container && container.parentNode) return container.parentNode;
    }

    return null;
  }

  // Find the specific avatar container
  function findAvatarContainer(article) {
    const avatarContainer = article.querySelector('[data-testid="Tweet-User-Avatar"], [data-testid="UserAvatar-Container"]');
    if (avatarContainer) return avatarContainer;

    // Fallback
    const imgContainers = article.querySelectorAll('img[src*="profile_images"], [src*="twimg.com"]');
    for (const img of imgContainers) {
      const container = img.closest('div[style*="width"], div[style*="height"]');
      if (container) return container;
    }

    return null;
  }

  // Ensure badge host as circle beside avatar
  function ensureBadgeHostBesideAvatar(articleEl, user) {
    const id = `tm-region-badge-${user.toLowerCase()}`;
    let host = articleEl.querySelector(`#${CSS.escape(id)}`);

    if (!host) {
      const avatarParent = findAvatarParentContainer(articleEl);
      const avatarContainer = findAvatarContainer(articleEl);

      if (!avatarParent || !avatarContainer) return null;

      host = document.createElement('div');
      host.id = id;
      host.className = 'tm-region-badge-host';

      // Insert the badge before the avatar container within the same parent
      avatarParent.insertBefore(host, avatarContainer);
    }
    return host;
  }

  function regionToEmoji(region) {
    const key = (region || '').trim().toLowerCase();
    return FLAGS[key] || '📍'; // Default to pin emoji if no flag found
  }

  function renderRegionBadge(article, headerBox, user, region) {
    if (!PLACE_BESIDE_AVATAR) return;

    const host = ensureBadgeHostBesideAvatar(article, user);
    if (!host) return;

    host.innerHTML = '';
    if (!region) return;

    const badge = document.createElement('div');
    badge.className = 'tm-region-circle-badge';

    // Get emoji for the region
    const emoji = regionToEmoji(region);
    badge.textContent = emoji;
    badge.title = `Account based in ${region}`;

    // Circle badge styling - matches profile image size and style
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.width = '40px'; // Match typical avatar size
    badge.style.height = '40px'; // Match typical avatar size
    badge.style.border = '2px solid rgba(29, 155, 240, 0.3)';
    badge.style.borderRadius = '50%'; // Perfect circle
    badge.style.fontSize = '16px'; // Emoji size
    badge.style.background = 'linear-gradient(135deg, rgba(29, 155, 240, 0.15), rgba(29, 155, 240, 0.08))';
    badge.style.backdropFilter = 'blur(8px)';
    badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.05)';
    badge.style.transition = 'all 0.3s ease';
    badge.style.cursor = 'default';
    badge.style.userSelect = 'none';
    badge.style.marginRight = '8px'; // Space between badge and profile image
    badge.style.flexShrink = '0';

    // Hover effects
    badge.addEventListener('mouseenter', () => {
      badge.style.background = 'linear-gradient(135deg, rgba(29, 155, 240, 0.25), rgba(29, 155, 240, 0.15))';
      badge.style.border = '2px solid rgba(29, 155, 240, 0.5)';
      badge.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1)';
      badge.style.transform = 'scale(1.05)';
    });

    badge.addEventListener('mouseleave', () => {
      badge.style.background = 'linear-gradient(135deg, rgba(29, 155, 240, 0.15), rgba(29, 155, 240, 0.08))';
      badge.style.border = '2px solid rgba(29, 155, 240, 0.3)';
      badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.05)';
      badge.style.transform = 'scale(1)';
    });

    // Click to show full country name
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      badge.textContent = badge.textContent === emoji ? region : emoji;
    });

    host.appendChild(badge);
  }

  /* ----------------- queue logic ------------------ */
  function enqueueUser(user) {
    const key = user.toLowerCase();
    if (mem.has(key)) return;
    if (enqSet.has(key)) return;
    if (opened.has(key)) return;
    enqSet.add(key);
    queue.push(user);
    pumpQueue();
  }

  function pumpQueue() {
    if (processingUser) return;
    const next = queue.shift();
    if (!next) return;

    const key = next.toLowerCase();
    processingUser = key;
    opened.add(key);

    GM_openInTab(`https://x.com/${encodeURIComponent(next)}/about?tm_autoclose=1`, {
      active: false, insert: true, setParent: true
    });

    // If for some reason we never receive a broadcast, release the lock later
    setTimeout(() => {
      if (processingUser === key) {
        processingUser = null;
        setTimeout(pumpQueue, QUEUE_DELAY_MS);
      }
    }, LOAD_TIMEOUT + 2000);
  }

  /* ---------- cross-tab receive + update ---------- */
  GM_addValueChangeListener(BROADCAST_KEY, (_k, _o, val, remote) => {
    if (!remote || !val) return;
    try {
      const msg = JSON.parse(val);
      const user = (msg.user || '').toLowerCase();
      const region = msg.region || '';
      if (!user) return;

      mem.set(user, region);

      // Update visible tweets for this user
      document.querySelectorAll('[data-testid="User-Name"]').forEach(box => {
        const u = usernameFromHeaderBox(box);
        if (!u || u.toLowerCase() !== user) return;
        const art = tweetArticleFromNameBox(box);
        if (art) renderRegionBadge(art, box, u, region);
      });

      // Release queue if this was our current one
      if (processingUser === user) {
        processingUser = null;
        setTimeout(pumpQueue, QUEUE_DELAY_MS);
      }
    } catch {}
  });

  /* ------------- observe visible tweets ----------- */
  const io = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const article = ent.target;
      if (seenArticles.has(article)) continue;
      seenArticles.add(article);

      // find its header name box
      const box = article.querySelector('[data-testid="User-Name"]');
      if (!box) continue;

      const user = usernameFromHeaderBox(box);
      if (!user) continue;

      // If known, render now; else enqueue lazy fetch
      const known = mem.get(user.toLowerCase());
      if (known !== undefined) {
        renderRegionBadge(article, box, user, known);
      } else {
        // Create/ensure host (empty) so layout is stable, then enqueue
        ensureBadgeHostBesideAvatar(article, user);
        enqueueUser(user);
      }
    }
  }, { root: null, rootMargin: VIEWPORT_ROOTMARGIN, threshold: 0 });

  function observeExistingTweets(root = document) {
    root.querySelectorAll('article[data-testid="tweet"], article[role="article"], article').forEach(a => {
      if (!seenArticles.has(a)) io.observe(a);
    });
  }

  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.('article[data-testid="tweet"], article[role="article"], article')) {
          io.observe(n);
        } else {
          const arts = n.querySelectorAll?.('article[data-testid="tweet"], article[role="article"], article');
          arts && arts.forEach(a => io.observe(a));
        }
      }
    }
  });

  /* ------------- scrape in /about tab ------------- */
  async function scrapeRegionAndClose() {
    const user = currentUserFromPath();
    if (!user) return;

    const deadline = Date.now() + LOAD_TIMEOUT;
    let region = '';

    while (Date.now() < deadline) {
      const pivots = document.querySelectorAll('[data-testid="pivot"], [role="tab"]');
      if (pivots.length) {
        let found = false;
        for (const pv of pivots) {
          const lines = Array.from(pv.querySelectorAll('span,div'))
            .map(x => (x.textContent || '').trim())
            .filter(Boolean);
          if (lines.length >= 2) {
            const label = lines[0].toLowerCase();
            const val   = lines[1].trim();
            if (label.includes('account based in') && val) {
              // Remove "Account based in" prefix and clean up
              region = val.replace(/^Account based in\s*/i, '');
              found = true;
              break;
            }
          }
        }
        if (!found) {
          for (const pv of pivots) {
            const lines = Array.from(pv.querySelectorAll('span,div'))
              .map(x => (x.textContent || '').trim())
              .filter(Boolean);
            if (lines.length >= 2) {
              const val = lines[1];
              if (/^[\p{L}\s\-\.,]+$/u.test(val) && val.length <= 40) {
                // Also clean the fallback value
                region = val.replace(/^Account based in\s*/i, '');
                break;
              }
            }
          }
        }
        break; // stop polling after pivots found
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    const key = user.toLowerCase();
    mem.set(key, region || '');

    // broadcast & auto-close
    GM_setValue(BROADCAST_KEY, JSON.stringify({
      user, region, ts: Date.now(), nonce: Math.random()
    }));

    if (new URL(location.href).searchParams.get('tm_autoclose') === '1') {
      setTimeout(() => window.close(), 100);
    }
  }

  /* --------------------- boot ---------------------- */
  if (isAbout()) {
    scrapeRegionAndClose();
  } else {
    observeExistingTweets();
    mo.observe(document, { childList: true, subtree: true });
  }
})();