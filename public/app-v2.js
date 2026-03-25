/* ═══════════════════════════════════════════════════════════════════════════════
   RSS Tool — Modern UI (Adapted from RSS-Bridge)
   Features: Bulk selection, drag-drop, fullscreen reading, Mozilla Readability
   ═══════════════════════════════════════════════════════════════════════════════ */

const API = '';  // same origin

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  feeds: [],
  collections: [],
  articles: [],
  filteredArticles: [],
  currentView: 'all',
  currentFeedId: null,
  currentCollectionId: null,
  selectedArticle: null,
  search: '',
  filter: 'all',
  sort: 'date',
  layout: 'list',
  starred: new Set(JSON.parse(localStorage.getItem('starred') || '[]')),
  offset: 0,
  PAGE_SIZE: 40,
  widgetFeedId: null,
  selectedColor: '#22c55e',
  scraperResult: null,
  confirmAction: null,
  renameColId: null,
  expandedCollections: {},
  bulkMode: false,
  selectedFeeds: new Set(),
  draggedFeedId: null,
  settings: JSON.parse(localStorage.getItem('rssToolSettings')) || {
    rssHubUrl: 'https://rsshub.app',
    theme: 'dark',
    fontSize: 'medium',
    showImages: true,
    refreshInterval: 0
  }
};

window.state = state;
window.API = API;

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  applySettings();
  await Promise.all([loadFeeds(), loadCollections()]);
  renderSidebar();
  await loadArticles();
  bindEvents();
  initScraperAutocomplete();
  updateBadges();
  setupAutoRefresh(); // Initialize auto-refresh on startup
}

// ── Data Loading ─────────────────────────────────────────────────────────────
async function loadFeeds() {
  try {
    const res = await fetch(`${API}/api/feeds`);
    state.feeds = await res.json();
  } catch (err) { console.error('Failed to load feeds:', err); state.feeds = []; }
}

async function loadCollections() {
  try {
    const res = await fetch(`${API}/api/collections?t=${Date.now()}`);
    state.collections = await res.json();
  } catch (err) { console.error('Failed to load collections:', err); state.collections = []; }
}

async function loadArticles() {
  const articlesList = $('articlesList');
  if (articlesList) {
    articlesList.innerHTML = `<div class="loading-state"><svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg><span>Loading articles...</span></div>`;
  }
  state.offset = 0;
  try {
    let data;
    if (state.currentView === 'all' || state.currentView === 'starred') {
      const res = await fetch(`${API}/api/articles?limit=200`);
      data = await res.json();
      state.articles = data.articles || [];
    } else if (state.currentView.startsWith('feed:')) {
      const feedId = state.currentView.split(':')[1];
      const res = await fetch(`${API}/api/feeds/${encodeURIComponent(feedId)}/articles`);
      const items = await res.json();
      const feed = state.feeds.find(f => f.id === feedId) || {};
      state.articles = items.map(i => ({ ...i, feedName: feed.name, feedId: feed.id, favicon: feed.favicon }));
    } else if (state.currentView.startsWith('collection:')) {
      const colId = state.currentView.split(':')[1];
      const res = await fetch(`${API}/api/collections/${colId}/articles`);
      state.articles = await res.json();
    }
  } catch (err) { console.error('Failed to load articles:', err); state.articles = []; }
  applyFilters();
}

// ── Filtering & Sorting ───────────────────────────────────────────────────────
function applyFilters() {
  let articles = [...state.articles];

  if (state.currentView === 'starred') {
    articles = articles.filter(a => state.starred.has(a.id || a.link));
  }

  if (state.search) {
    const q = state.search.toLowerCase();
    articles = articles.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.content || '').toLowerCase().includes(q) ||
      (a.feedName || '').toLowerCase().includes(q)
    );
  }

  if (state.sort === 'date') articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  else if (state.sort === 'date-asc') articles.sort((a, b) => new Date(a.date) - new Date(b.date));
  else if (state.sort === 'feed') articles.sort((a, b) => (a.feedName || '').localeCompare(b.feedName || ''));

  state.filteredArticles = articles;
  renderArticleList(true);
  updateBadges();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  const feedsList = $('feedsList');
  const collectionsList = $('collectionsList');
  
  console.log('[RENDER-SIDEBAR] Rendering with', state.collections.length, 'collections,', state.feeds.length, 'feeds');
  state.collections.forEach(c => {
    console.log(`[RENDER-SIDEBAR] Collection ${c.name}: ${(c.feedIds || []).length} feeds`);
  });
  
  if (!state.feeds.length && !state.collections.length) {
    if (feedsList) feedsList.innerHTML = '<div class="empty-hint">No feeds yet.<br/>Click + to add one.</div>';
    if (collectionsList) collectionsList.innerHTML = '';
    return;
  }

  const unassignedFeeds = state.feeds.filter(f => !state.collections.some(c => (c.feedIds || []).includes(f.id)));
  console.log(`[RENDER-SIDEBAR] Unassigned feeds: ${unassignedFeeds.length}`, unassignedFeeds.map(f => f.name));

  // Collections with checkboxes in bulk mode
  if (collectionsList) {
    const collectionsHtml = state.collections.map(c => {
      const colFeeds = state.feeds.filter(f => (c.feedIds || []).includes(f.id));
      const isColActive = state.currentView === 'collection:' + c.id;
      const isExpanded = state.expandedCollections[c.id] || isColActive;

      const feedsHtml = colFeeds.map(f => {
        const isSelected = state.selectedFeeds.has(f.id);
        return `
        <div class="nested-feed ${state.currentView === 'feed:' + f.id ? 'active' : ''} ${isSelected ? 'selected' : ''}" 
             data-feedid="${f.id}"
             ${state.bulkMode ? '' : 'draggable="true"'}>
          ${state.bulkMode ? `<input type="checkbox" class="feed-checkbox" data-feedid="${f.id}" ${isSelected ? 'checked' : ''}>` : ''}
          <img class="feed-favicon" src="${f.favicon || 'default.ico'}" alt="" onerror="this.style.display='none'">
          <span>${esc(f.name)}</span>
        </div>
      `}).join('');

      return `
        <div class="folder-group" data-colid="${c.id}">
          <div class="collection-item ${isColActive ? 'active' : ''}" data-colid="${c.id}">
            <button class="expand-btn" data-colid="${c.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="${isExpanded ? '6 9 12 15 18 9' : '9 18 15 12 9 6'}"/>
              </svg>
            </button>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${c.color || '#22c55e'}" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="feed-name">${esc(c.name)}</span>
            <span class="collection-count">${colFeeds.length}</span>
            <div class="feed-actions">
              <button class="delete-btn" data-colid="${c.id}" title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="collection-feeds" style="display: ${isExpanded ? 'block' : 'none'};">
            ${feedsHtml}
          </div>
        </div>
      `;
    }).join('');
    collectionsList.innerHTML = collectionsHtml || '<div class="empty-hint">No collections yet</div>';
  }

  // Unassigned Feeds with checkboxes in bulk mode
  if (feedsList) {
    const unassignedHtml = unassignedFeeds.map(f => {
      const isSelected = state.selectedFeeds.has(f.id);
      return `
      <div class="feed-item ${state.currentView === 'feed:' + f.id ? 'active' : ''} ${isSelected ? 'selected' : ''}" 
           data-feedid="${f.id}"
           ${state.bulkMode ? '' : 'draggable="true"'}>
        <div class="feed-checkbox-wrapper">
          <input type="checkbox" class="feed-checkbox" data-feedid="${f.id}" ${isSelected ? 'checked' : ''}>
        </div>
        <img class="feed-favicon" src="${f.favicon || 'default.ico'}" alt="" onerror="this.style.display='none'">
        <span class="feed-name">${esc(f.name)}</span>
        <span class="feed-count">${f.unreadCount || 0}</span>
        <div class="feed-actions">
          <button class="refresh-btn" data-feedid="${f.id}" title="Refresh">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button class="delete-btn" data-feedid="${f.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>
      </div>
    `}).join('');
    feedsList.innerHTML = unassignedHtml || '<div class="empty-hint">No unassigned feeds</div>';
  }

  bindSidebarEvents();
}

function renderArticleList(reset = false) {
  const articlesList = $('articlesList');
  if (!articlesList) return;

  if (reset) state.offset = 0;

  const page = state.filteredArticles.slice(state.offset, state.offset + state.PAGE_SIZE);

  if (reset && page.length === 0) {
    articlesList.innerHTML = state.articles.length === 0
      ? `<div class="welcome-screen">
          <div class="welcome-icon">📡</div>
          <h2>Welcome to RSS Bridge</h2>
          <p>Your free, local-first RSS aggregator. Add your first feed to get started.</p>
          <button class="btn-primary" id="btnWelcomeAddFeed">Add Your First Feed</button>
        </div>`
      : `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>No articles found</span></div>`;
    
    const wBtn = $('btnWelcomeAddFeed');
    if (wBtn) wBtn.onclick = () => $('addFeedForm').style.display = 'block';
    return;
  }

  const html = page.map((a, idx) => articleListItem(a, state.offset + idx)).join('');
  if (reset) articlesList.innerHTML = html;
  else articlesList.insertAdjacentHTML('beforeend', html);

  state.offset += page.length;

  articlesList.querySelectorAll('.article-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      selectArticle(state.filteredArticles[idx]);
    });
  });
}

function articleListItem(article, idx) {
  const id = article.id || article.link || '';
  const isStarred = state.starred.has(id);
  const dateStr = article.date ? formatDate(article.date) : '';
  const isActive = state.selectedArticle && (state.selectedArticle.id || state.selectedArticle.link) === id;

  return `
    <div class="article-item ${isActive ? 'active' : ''}" data-idx="${idx}" data-artid="${esc(id)}">
      ${article.image && state.settings.showImages ? `<img class="article-thumb" src="${esc(article.image)}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="article-content">
        <h3 class="article-title">${esc(article.title || 'Untitled')}</h3>
        <div class="article-meta">
          ${article.feedName ? `<span class="feed-badge"><img src="${article.favicon || ''}" alt="" onerror="this.style.display='none'">${esc(article.feedName)}</span>` : ''}
          ${article.author ? `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${esc(article.author)}</span>` : ''}
          ${dateStr ? `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dateStr}</span>` : ''}
        </div>
        <p class="article-snippet">${esc(stripHtml(article.content || '').slice(0, 150))}...</p>
      </div>
    </div>
  `;
}

function selectArticle(article) {
  if (!article) return;
  state.selectedArticle = article;
  
  $$('.article-item').forEach(el => el.classList.remove('active'));
  const artId = article.id || article.link || '';
  const activeEl = document.querySelector(`.article-item[data-artid="${CSS.escape(artId)}"]`);
  if (activeEl) activeEl.classList.add('active');

  const articleView = $('articleView');
  const id = article.id || article.link || '';
  const isStarred = state.starred.has(id);
  const dateStr = article.date ? new Date(article.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  // Check if this is a YouTube video article
  let embedHtml = '';
  if (article.link) {
    const ytMatch = article.link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
    if (ytMatch && ytMatch[1]) {
      const videoId = ytMatch[1];
      console.log('[VIDEO] Creating YouTube embed for videoId:', videoId, 'article:', article.title?.slice(0, 50));
      embedHtml = `
        <div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 8px; margin-bottom: 16px;" data-video-id="${videoId}">
          <iframe id="yt-iframe-${videoId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border:0;" src="https://www.youtube.com/embed/${videoId}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
        </div>
      `;
    }
  }

  articleView.className = 'article-view';
  articleView.innerHTML = `
    <div class="article-header">
      <button class="close-btn" id="closeArticleView">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="article-actions">
        <button id="starArticleBtn" title="${isStarred ? 'Unstar' : 'Star'}">
          <svg viewBox="0 0 24 24" fill="${isStarred ? '#f59e0b' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button id="fullscreenBtn" title="Fullscreen reading">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
          </svg>
        </button>
        <a href="${esc(article.link || '#')}" target="_blank" rel="noopener" title="Open in browser">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>
    </div>
    <article class="article-body">
      ${article.image ? `<img class="hero-image" src="${esc(article.image)}" alt="" onerror="this.style.display='none'">` : ''}
      <h1>${esc(article.title || 'Untitled')}</h1>
      <div class="article-meta-full">
        ${article.feedName ? `<span class="feed-badge"><img src="${article.favicon || ''}" alt="" onerror="this.style.display='none'">${esc(article.feedName)}</span>` : ''}
        ${article.author ? `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${esc(article.author)}</span>` : ''}
        ${dateStr ? `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dateStr}</span>` : ''}
      </div>
      <button class="load-full-btn" id="loadFullArticle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>
        </svg>
        Load Full Article (Mozilla Readability)
      </button>
      <div class="article-text" id="articleContent">
        ${embedHtml ? embedHtml : (article.content || article.summary || '<p>No content available.</p>')}
      </div>
      <a href="${esc(article.link || '#')}" target="_blank" rel="noopener" class="reading-open-full">Open in Browser →</a>
    </article>
  `;

  // Bind events
  $('closeArticleView').addEventListener('click', () => {
    articleView.className = 'article-view empty';
    articleView.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>
      </svg>
      <h2>Select an article to read</h2>
      <p>Choose from the list on the left</p>
    `;
    state.selectedArticle = null;
    $$('.article-item').forEach(el => el.classList.remove('active'));
  });

  $('starArticleBtn').addEventListener('click', () => {
    toggleStar(id);
    selectArticle(article);
  });

  $('fullscreenBtn').addEventListener('click', () => {
    articleView.classList.toggle('fullscreen');
  });

  $('loadFullArticle')?.addEventListener('click', () => fetchFullArticle(article));
  
  // Add logging for video iframe
  const ytIframe = document.querySelector('.video-container iframe');
  if (ytIframe) {
    console.log('[VIDEO] iframe found, src:', ytIframe.src);
    ytIframe.addEventListener('load', () => console.log('[VIDEO] iframe loaded:', ytIframe.src));
    ytIframe.addEventListener('error', (e) => console.error('[VIDEO] iframe error:', e));
    
    // Monitor for visibility changes
    const videoContainer = document.querySelector('.video-container');
    if (videoContainer) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(m => console.log('[VIDEO] Container mutation:', m.type, m.attributeName));
      });
      observer.observe(videoContainer, { attributes: true, childList: true });
    }
  }
  
  // Process any video/audio in the article body (includes content + links)
  const articleBody = document.querySelector('.article-body');
  if (articleBody) {
    cleanArticleImages(articleBody);
    processVideoEmbeds(articleBody);
    processAudioPlayers(articleBody);
  }
}

async function fetchFullArticle(article) {
  const contentEl = $('articleContent');
  if (!contentEl) return;

  const loadBtn = $('loadFullArticle');
  if (loadBtn) {
    loadBtn.innerHTML = `<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Loading with Mozilla Readability...`;
    loadBtn.disabled = true;
  }

  try {
    const res = await fetch(`${API}/api/article-content?url=${encodeURIComponent(article.link)}&readability=true`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    // Store hero image URL for duplicate detection
    const heroImage = article.image || data.heroImage;

    // Clean content first
    contentEl.innerHTML = data.content || '<p>Could not extract article content.</p>';

    // Mozilla Readability: Remove duplicate hero image from content
    if (heroImage) {
      const cleanHeroUrl = heroImage.split('?')[0].replace(/^https?:\/\//, '');
      contentEl.querySelectorAll('img').forEach(img => {
        const imgSrc = (img.src || '').split('?')[0].replace(/^https?:\/\//, '');
        // Check if this image matches the hero image
        if (imgSrc === cleanHeroUrl || 
            imgSrc.includes(cleanHeroUrl) || 
            cleanHeroUrl.includes(imgSrc) ||
            (cleanHeroUrl.length > 20 && imgSrc.includes(cleanHeroUrl.slice(-20)))) {
          // Also check dimensions - hero images are usually larger
          if (img.naturalWidth > 200 || img.width > 200 || !img.complete) {
            img.classList.add('hero-detected');
            img.style.display = 'none';
          }
        }
      });
    }

    // Remove duplicate title headings
    const cleanStr = (s) => (s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetTitle = cleanStr(article.title);
    if (targetTitle.length > 5) {
      contentEl.querySelectorAll('h1, h2, h3').forEach(heading => {
        const headingText = cleanStr(heading.textContent);
        if (headingText && (targetTitle.includes(headingText) || headingText.includes(targetTitle))) {
          heading.remove();
        }
      });
    }

    // Clean up small/tracking images
    cleanArticleImages(contentEl);
    
    // Process video embeds on the entire article body to catch the "Open in Browser" link
    const articleBody = document.querySelector('.article-body');
    if (articleBody) {
      processVideoEmbeds(articleBody);
      processAudioPlayers(articleBody);
    }

    // Hide load button
    if (loadBtn) loadBtn.style.display = 'none';

  } catch (err) {
    contentEl.innerHTML = `<p class="article-fetch-error">Could not load article content. <a href="${esc(article.link)}" target="_blank">Open in browser →</a></p>`;
    if (loadBtn) {
      loadBtn.innerHTML = 'Load Full Article (Mozilla Readability)';
      loadBtn.disabled = false;
    }
  }
}

function cleanArticleImages(container) {
  if (!container) return;
  container.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!src || src === '' || src.startsWith('data:image/gif') || src.includes('pixel') || src.includes('beacon') || src.includes('tracker')) {
      img.remove();
      return;
    }
    const w = img.getAttribute('width');
    const h = img.getAttribute('height');
    if ((w && parseInt(w) <= 5) || (h && parseInt(h) <= 5)) {
      img.remove();
      return;
    }
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.3s ease';
    img.onload = () => {
      if (img.naturalWidth <= 5 || img.naturalHeight <= 5) {
        img.remove();
        return;
      }
      img.style.opacity = '1';
    };
    img.onerror = () => img.remove();
    if (img.complete) {
      if (img.naturalWidth <= 5 || img.naturalHeight <= 5 || img.naturalWidth === 0) {
        img.remove();
      } else {
        img.style.opacity = '1';
      }
    }
  });
}

// ── Video & Audio Processing ───────────────────────────────────────────────────
function processVideoEmbeds(container) {
  if (!container) return;
  
  container.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.getAttribute('src') || '';
    
    // Skip if already properly embedded in video-container (from selectArticle)
    if (iframe.closest('.video-container')) return;
    
    // Check if it's a video embed
    if (src.includes('youtube.com/embed/') || 
        src.includes('youtu.be/') ||
        src.includes('vimeo.com/video/') ||
        src.includes('player.vimeo.com/') ||
        src.includes('dailymotion.com/embed/') ||
        src.includes('twitch.tv/embed/') ||
        src.includes('kick.com/') ||
        src.includes('odysee.com/$/embed/')) {
      
      // Wrap in video-embed container if not already wrapped
      const parent = iframe.parentElement;
      if (!parent?.classList.contains('video-embed')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'video-embed';
        parent.insertBefore(wrapper, iframe);
        wrapper.appendChild(iframe);
      }
    }
  });
  
  // Skip YouTube link conversion if video-container already exists (from selectArticle)
  if (container.querySelector('.video-container')) return;
  
  // Convert YouTube links to embeds
  const youtubeLinks = container.querySelectorAll('a[href*="youtube.com/watch"], a[href*="youtu.be/"], a[href*="youtube.com/shorts/"]');
  youtubeLinks.forEach(link => {
    const videoId = extractYouTubeId(link.href);
    if (videoId && !link.classList.contains('video-converted')) {
      // Check if there's already a video-embed wrapper for this videoId in the container
      const existingEmbed = container.querySelector(`.video-embed iframe[src*="/embed/${videoId}"]`);
      if (existingEmbed) {
        link.classList.add('video-converted');
        return;
      }
      link.classList.add('video-converted');
      const wrapper = document.createElement('div');
      wrapper.className = 'video-embed';
      wrapper.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
      link.parentNode.insertBefore(wrapper, link.nextSibling);
    }
  });
  
  // Convert native video elements
  container.querySelectorAll('video').forEach(video => {
    video.setAttribute('controls', '');
    video.setAttribute('preload', 'metadata');
    video.style.maxWidth = '100%';
    
    // Add poster if first frame is available
    if (!video.poster && video.querySelector('source')) {
      video.poster = '';
    }
  });
}

function processAudioPlayers(container) {
  if (!container) return;
  
  // Process existing audio elements
  container.querySelectorAll('audio').forEach(audio => {
    audio.setAttribute('controls', '');
    audio.style.width = '100%';
    
    // Wrap in audio-embed container if not already wrapped
    if (!audio.parentElement.classList.contains('audio-embed')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'audio-embed';
      
      // Try to extract title from nearby text or data attribute
      const title = audio.getAttribute('data-title') || 
                    audio.closest('figure, .audio-wrapper')?.querySelector('figcaption, .audio-title')?.textContent ||
                    'Audio';
      
      wrapper.innerHTML = `
        <div class="audio-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          ${esc(title)}
        </div>
      `;
      audio.parentNode.insertBefore(wrapper, audio);
      wrapper.appendChild(audio);
    }
  });
  
  // Convert podcast/audio file links to players
  container.querySelectorAll('a[href$=".mp3"], a[href$=".mp4"], a[href$=".m4a"], a[href$=".ogg"], a[href$=".oga"], a[href$=".wav"], a[href$=".webm"]').forEach(link => {
    if (link.classList.contains('audio-converted')) return;
    link.classList.add('audio-converted');
    
    const url = link.href;
    const title = link.textContent || 'Audio';
    
    // Check if it's a video file
    if (url.match(/\.(mp4|webm|ogv)$/i)) {
      const wrapper = document.createElement('div');
      wrapper.className = 'video-embed';
      wrapper.innerHTML = `<video controls preload="metadata" src="${esc(url)}"></video>`;
      link.parentNode.insertBefore(wrapper, link.nextSibling);
    } else {
      // Audio file
      const wrapper = document.createElement('div');
      wrapper.className = 'audio-embed';
      wrapper.innerHTML = `
        <div class="audio-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          ${esc(title)}
        </div>
        <audio controls preload="metadata" src="${esc(url)}"></audio>
      `;
      link.parentNode.insertBefore(wrapper, link.nextSibling);
    }
  });
  
  // Convert podcast embed URLs (Spotify, Apple Podcasts, etc.)
  container.querySelectorAll('a[href*="open.spotify.com/episode"], a[href*="open.spotify.com/show"]').forEach(link => {
    if (link.classList.contains('spotify-converted')) return;
    link.classList.add('spotify-converted');
    
    // Extract Spotify URI
    const spotifyUrl = link.href.replace('open.spotify.com/', 'open.spotify.com/embed/');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'audio-embed';
    wrapper.style.padding = '0';
    wrapper.innerHTML = `<iframe src="${esc(spotifyUrl)}" width="100%" height="152" frameborder="0" allowtransparency="true" allow="encrypted-media"></iframe>`;
    link.parentNode.insertBefore(wrapper, link.nextSibling);
  });
}

function extractYouTubeId(url) {
  const patterns = [
    /youtube\.com\/watch\?[^#]*v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function updateBadges() {
  const allCount = state.filteredArticles.length;
  state.feeds.forEach(f => {
    const feedItems = state.articles.filter(a => (a.feedId || a.feed_id) === f.id);
    f.unreadCount = feedItems.length;
  });
}

function setView(view, title) {
  state.currentView = view;
  const viewTitle = $('viewTitle');
  if (viewTitle) viewTitle.textContent = title;
  
  $$('.nav-item').forEach(el => el.classList.remove('active'));
  $$('.feed-item').forEach(el => el.classList.remove('active'));
  $$('.collection-item').forEach(el => el.classList.remove('active'));
  
  if (view === 'all') {
    const navAll = $('nav-all');
    if (navAll) navAll.classList.add('active');
  } else if (view === 'starred') {
    const navStarred = $('nav-starred');
    if (navStarred) navStarred.classList.add('active');
  }
  
  loadArticles();
}

// ── Bulk Selection ────────────────────────────────────────────────────────────
function toggleBulkMode() {
  state.bulkMode = !state.bulkMode;
  state.selectedFeeds.clear();
  updateBulkUI();
  renderSidebar();
}

function updateBulkUI() {
  const btn = $('btnBulkToggle');
  const bar = $('bulkActionsBar');
  const sidebar = $('sidebar');
  
  if (btn) btn.classList.toggle('active', state.bulkMode);
  if (sidebar) sidebar.classList.toggle('bulk-mode', state.bulkMode);
  
  if (state.bulkMode && state.selectedFeeds.size > 0) {
    bar.classList.add('visible');
    $('bulkCount').textContent = `${state.selectedFeeds.size} selected`;
  } else {
    bar.classList.remove('visible');
  }
}

function toggleFeedSelection(feedId) {
  if (state.selectedFeeds.has(feedId)) {
    state.selectedFeeds.delete(feedId);
  } else {
    state.selectedFeeds.add(feedId);
  }
  updateBulkUI();
  renderSidebar();
}

// Bulk delete state
let pendingBulkDelete = null;

async function bulkDelete() {
  if (state.selectedFeeds.size === 0) return;
  
  // Clear any single-item confirm action to prevent conflicts
  state.confirmAction = null;
  
  // Use styled modal instead of native confirm
  pendingBulkDelete = Array.from(state.selectedFeeds);
  $('confirmDeleteMessage').textContent = `Delete ${pendingBulkDelete.length} selected feeds?`;
  openModal('modalConfirmDelete');
}

// Handle bulk delete confirmation
async function executeBulkDelete() {
  if (!pendingBulkDelete || pendingBulkDelete.length === 0) return;
  
  const btnConfirmDelete = $('btnConfirmDelete');
  btnConfirmDelete.disabled = true;
  
  let deleted = 0;
  const failed = [];
  for (const feedId of pendingBulkDelete) {
    try {
      await fetch(`${API}/api/feeds/${encodeURIComponent(feedId)}`, { method: 'DELETE' });
      deleted++;
    } catch (err) {
      console.error(`Failed to delete feed ${feedId}:`, err);
      failed.push(feedId);
    }
  }
  
  pendingBulkDelete = null;
  // Keep failed items selected so user can retry
  state.selectedFeeds.clear();
  if (failed.length > 0) {
    failed.forEach(id => state.selectedFeeds.add(id));
  }
  toggleBulkMode();
  await loadFeeds();
  renderSidebar();
  await loadArticles();
  
  if (failed.length > 0) {
    toast(`Deleted ${deleted} feeds, ${failed.length} failed`, 'warning');
  } else {
    toast(`Deleted ${deleted} feeds`, 'success');
  }
  
  btnConfirmDelete.disabled = false;
  closeModal('modalConfirmDelete');
}

// Bulk move state
let pendingBulkMove = null;

async function bulkMove() {
  if (state.selectedFeeds.size === 0) return;
  
  // Clear any pending state to prevent conflicts with previous operations
  pendingBulkMove = null;
  
  pendingBulkMove = Array.from(state.selectedFeeds);
  
  // Populate move options
  const optionsEl = $('moveFeedOptions');
  optionsEl.innerHTML = `
    <div class="move-feed-option" data-target="">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 2H8a2 2 0 00-2 2v3h12V4a2 2 0 00-2-2z"/>
      </svg>
      <span>Unassigned (no collection)</span>
    </div>
    ${state.collections.map(c => `
      <div class="move-feed-option" data-target="${c.id}">
        <svg viewBox="0 0 24 24" fill="${c.color || '#22c55e'}" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>${esc(c.name)}</span>
      </div>
    `).join('')}
  `;
  
  // Bind selection
  let selectedTarget = null;
  optionsEl.querySelectorAll('.move-feed-option').forEach(opt => {
    opt.addEventListener('click', () => {
      optionsEl.querySelectorAll('.move-feed-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedTarget = opt.dataset.target;
    });
  });
  
  // Bind confirm - replace any previous handler
  const confirmBtn = $('btnMoveFeedConfirm');
  confirmBtn.onclick = async () => {
    if (!pendingBulkMove || pendingBulkMove.length === 0) return;
    
    if (selectedTarget === null) {
      toast('Please select a destination', 'error');
      return;
    }
    
    // Capture state to prevent race conditions
    const targetId = selectedTarget;
    const feedsToMove = pendingBulkMove;
    
    confirmBtn.disabled = true;
    pendingBulkMove = null;
    
    let moved = 0;
    const failed = [];
    const alreadyThere = [];
    console.log(`[BULK-MOVE] Starting move of ${feedsToMove.length} feeds to target: ${targetId || 'unassigned'}`);
    
    // Group feeds by their source collection to batch removals
    const feedsBySource = new Map();
    for (const feedId of feedsToMove) {
      const currentCol = state.collections.find(c => (c.feedIds || []).includes(feedId));
      const sourceId = currentCol ? currentCol.id : null;
      if (!feedsBySource.has(sourceId)) {
        feedsBySource.set(sourceId, []);
      }
      feedsBySource.get(sourceId).push(feedId);
    }
    
    console.log(`[BULK-MOVE] Grouped by source:`, Array.from(feedsBySource.entries()).map(([k, v]) => `${k || 'unassigned'}: ${v.length}`));
    
    // Process each source collection in a single batch
    for (const [sourceId, feedIds] of feedsBySource) {
      try {
        if (sourceId) {
          // Batch remove all feeds from this collection at once
          const sourceCol = state.collections.find(c => c.id === sourceId);
          if (sourceCol) {
            const feedsToKeep = sourceCol.feedIds.filter(id => !feedIds.includes(id));
            console.log(`[BULK-MOVE] Batch removing ${feedIds.length} feeds from ${sourceId}, keeping ${feedsToKeep.length}`);
            const removeRes = await fetch(`${API}/api/collections/${sourceId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ feedIds: feedsToKeep })
            });
            if (!removeRes.ok) throw new Error(`Failed to remove from ${sourceId}`);
            console.log(`[BULK-MOVE] Successfully removed ${feedIds.length} feeds from ${sourceId}`);
          }
        }
        
        // Now handle adding to target (if any)
        if (targetId) {
          for (const feedId of feedIds) {
            // Refresh target state each time to avoid duplicates
            const refreshRes = await fetch(`${API}/api/collections?t=${Date.now()}`);
            const freshCollections = await refreshRes.json();
            const targetCol = freshCollections.find(c => c.id === targetId);
            
            if (targetCol) {
              if ((targetCol.feedIds || []).includes(feedId)) {
                alreadyThere.push(feedId);
                moved++;
                console.log(`[BULK-MOVE] Feed ${feedId} already in target`);
                continue;
              }
              
              const updatedIds = [...(targetCol.feedIds || []), feedId];
              const addRes = await fetch(`${API}/api/collections/${targetId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedIds: updatedIds })
              });
              if (!addRes.ok) throw new Error(`Failed to add to ${targetId}`);
              console.log(`[BULK-MOVE] Added feed ${feedId} to ${targetId}`);
              moved++;
            }
          }
        } else {
          // Moving to unassigned - just count them
          moved += feedIds.length;
          console.log(`[BULK-MOVE] Moved ${feedIds.length} feeds to unassigned`);
        }
      } catch (err) {
        console.error(`[BULK-MOVE] Failed to process batch from ${sourceId || 'unassigned'}:`, err);
        feedIds.forEach(id => failed.push(id));
      }
    }
    
    console.log(`[BULK-MOVE] Completed: ${moved} moved, ${failed.length} failed, ${alreadyThere.length} already there`);
    closeModal('modalMoveFeed');
    // Keep failed items selected for retry
    state.selectedFeeds.clear();
    if (failed.length > 0) {
      failed.forEach(id => state.selectedFeeds.add(id));
      toast(`Moved ${moved} feeds, ${failed.length} failed`, 'warning');
    } else {
      toast(`Moved ${moved} feeds`, 'success');
    }
    toggleBulkMode();
    await loadCollections();
    await loadFeeds();
    renderSidebar();
    confirmBtn.disabled = false;
  };
  
  openModal('modalMoveFeed');
}

// ── URL Scraper with Discovery ────────────────────────────────────────────────
let currentDiscoveryOptions = [];
let currentScrapeUrl = '';

async function handleScrape(e) {
  e.preventDefault();
  const urlInput = $('scraperUrlInput');
  const url = urlInput.value.trim();
  if (!url) return;

  const form = $('scraperForm');
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = $('scraperError');
  const resultEl = $('scraperResult');

  btn.innerHTML = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Discovering content...`;
  btn.disabled = true;
  errorEl.style.display = 'none';
  resultEl.style.display = 'none';

  try {
    // First, call the discovery API to find all content options
    const discoverRes = await fetch(`${API}/api/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const discoverData = await discoverRes.json();

    if (!discoverRes.ok) throw new Error(discoverData.error || 'Failed to discover content');

    currentScrapeUrl = url;
    currentDiscoveryOptions = discoverData.options || [];

    // If we found options, show the picker
    if (currentDiscoveryOptions.length > 0) {
      showDiscoveryPicker(discoverData.siteTitle, currentDiscoveryOptions);
    } else {
      // No options found, try regular scrape
      await performScrape(url);
    }

  } catch (err) {
    // If discovery fails, fall back to regular scrape
    console.log('Discovery failed, trying regular scrape:', err.message);
    await performScrape(url);
  } finally {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze URL`;
    btn.disabled = false;
  }
}

function showDiscoveryPicker(siteTitle, options) {
  const resultEl = $('scraperResult');
  const recommended = options.filter(o => o.priority >= 80);
  const others = options.filter(o => o.priority < 80 && o.type !== 'custom');
  const custom = options.find(o => o.type === 'custom');

  let html = `
    <div class="result-header">
      <div>
        <h4>${esc(siteTitle || 'Select Content Source')}</h4>
        <span class="result-type scraped">${options.length} content sources found</span>
      </div>
    </div>
    <div class="discovery-options">
  `;

  if (recommended.length > 0) {
    html += `<div class="discovery-section"><h5>Recommended</h5>`;
    recommended.forEach(opt => {
      html += renderDiscoveryOption(opt);
    });
    html += `</div>`;
  }

  if (others.length > 0) {
    html += `<div class="discovery-section"><h5>Other Options</h5>`;
    others.forEach(opt => {
      html += renderDiscoveryOption(opt);
    });
    html += `</div>`;
  }

  if (custom) {
    html += `<div class="discovery-section"><h5>Custom</h5>`;
    html += renderDiscoveryOption(custom, true);
    html += `</div>`;
  }

  // Add Site Map option
  html += `<div class="discovery-section"><h5>Advanced</h5>`;
  html += `
    <div class="discovery-option" id="discover-site-map" data-option-id="site-map">
      <span class="option-icon">🗺️</span>
      <div class="option-info">
        <strong>Site Map Discovery</strong>
        <span>Crawl sitemap.xml and robots.txt to find all available feeds</span>
      </div>
      <button id="discover-btn-site-map" class="btn-select">Map Site</button>
    </div>
  `;
  html += `</div>`;

  html += `</div>`;
  resultEl.innerHTML = html;
  resultEl.style.display = 'block';

  // Bind click handlers - make entire row clickable
  options.forEach(opt => {
    const row = $(`discover-${opt.id}`);
    const btn = $(`discover-btn-${opt.id}`);
    if (row) {
      row.addEventListener('click', (e) => {
        // Don't trigger if clicking the button (button has its own handler)
        if (e.target !== btn && !btn.contains(e.target)) {
          selectDiscoveryOption(opt);
        }
      });
    }
    if (btn) {
      btn.addEventListener('click', () => selectDiscoveryOption(opt));
    }
  });

  // Bind site map row and button
  const siteMapRow = $('discover-site-map');
  const siteMapBtn = $('discover-btn-site-map');
  if (siteMapRow) {
    siteMapRow.addEventListener('click', (e) => {
      if (e.target !== siteMapBtn && !siteMapBtn.contains(e.target)) {
        performSiteMap(currentScrapeUrl);
      }
    });
  }
  if (siteMapBtn) {
    siteMapBtn.addEventListener('click', () => performSiteMap(currentScrapeUrl));
  }

  // Bind custom selector form
  const customBtn = $('btn-custom-scrape');
  if (customBtn) {
    customBtn.addEventListener('click', () => {
      const selector = $('custom-selector').value.trim();
      if (selector) {
        performCustomScrape(currentScrapeUrl, selector);
      }
    });
  }
}

function renderDiscoveryOption(opt, isCustom = false) {
  if (isCustom) {
    return `
      <div class="discovery-option custom-option">
        <div class="option-info">
          <strong>Custom CSS Selector</strong>
          <span>Enter your own selector to scrape specific content</span>
        </div>
        <div class="custom-selector-input">
          <input type="text" id="custom-selector" placeholder="e.g., .article, .news-item, article" />
          <button id="btn-custom-scrape" class="save-btn">Scrape</button>
        </div>
      </div>
    `;
  }

  const typeIcons = {
    'rss': '📡',
    'section': '📄',
    'auto-detected': '🔍',
    'custom': '⚙️'
  };

  return `
    <div class="discovery-option" id="discover-${opt.id}" data-option-id="${opt.id}">
      <span class="option-icon">${typeIcons[opt.type] || '📄'}</span>
      <div class="option-info">
        <strong>${esc(opt.label)}</strong>
        <span>${esc(opt.description)}</span>
      </div>
      ${opt.count ? `<span class="option-count">${opt.count}</span>` : ''}
      <button id="discover-btn-${opt.id}" class="btn-select">Select</button>
    </div>
  `;
}

async function selectDiscoveryOption(opt) {
  const resultEl = $('scraperResult');
  resultEl.innerHTML = `<div class="result-preview"><div class="loading">Loading ${esc(opt.label)}...</div></div>`;

  if (opt.type === 'rss') {
    // For RSS, just add the feed directly
    try {
      const res = await fetch(`${API}/api/feeds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: opt.url })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast('RSS feed added!', 'success');
      $('scraperUrlInput').value = '';
      resultEl.style.display = 'none';
      await loadFeeds();
      renderSidebar();
    } catch (err) {
      toast(err.message, 'error');
    }
  } else {
    // For sections, scrape with the selector
    await performCustomScrape(currentScrapeUrl, opt.selector);
  }
}

async function performCustomScrape(url, selector) {
  const resultEl = $('scraperResult');
  
  // Validate selector
  if (!selector || typeof selector !== 'string' || selector.trim() === '') {
    resultEl.innerHTML = `<div class="scraper-error"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div><span>No valid selector provided for this option</span></div></div>`;
    resultEl.style.display = 'block';
    return;
  }
  
  resultEl.innerHTML = `<div class="result-preview"><div class="loading">Scraping with selector: ${esc(selector)}...</div></div>`;

  try {
    const res = await fetch(`${API}/api/scrape-custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, selector: selector.trim() })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Scraping failed');

    state.scraperResult = data;
    renderScrapeResult(data);

  } catch (err) {
    let errorMsg = err.message;
    
    // Provide helpful messages for common errors
    if (err.message.includes('403')) {
      errorMsg = 'Access blocked (403). The site is preventing scraping. Try using the custom CSS selector option or a different URL.';
    } else if (err.message.includes('401')) {
      errorMsg = 'Authentication required (401). This site requires login.';
    } else if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
      errorMsg = 'Request timed out. The site may be slow or blocking requests.';
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
      errorMsg = 'Could not resolve the website. Check the URL.';
    }
    
    resultEl.innerHTML = `<div class="scraper-error"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div><span>${esc(errorMsg)}</span></div></div>`;
  }
}

async function performSiteMap(url) {
  const resultEl = $('scraperResult');
  resultEl.innerHTML = `<div class="result-preview"><div class="loading">Mapping site structure via sitemap.xml and robots.txt...</div></div>`;

  try {
    const res = await fetch(`${API}/api/site-map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await res.text();
      console.error('Non-JSON response:', text.slice(0, 200));
      throw new Error('Server returned invalid response format');
    }
    
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Site mapping failed');

    renderSiteMapResult(data);

  } catch (err) {
    let errorMsg = err.message;
    if (err.message.includes('403')) {
      errorMsg = 'Access blocked (403). The site is preventing access.';
    } else if (err.message.includes('timeout')) {
      errorMsg = 'Request timed out while mapping site.';
    } else if (err.message.includes('JSON') || err.message.includes('invalid')) {
      errorMsg = 'Server error: Invalid response format. Please try again.';
    }
    
    resultEl.innerHTML = `<div class="scraper-error"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div><span>${esc(errorMsg)}</span></div></div>`;
  }
}

function renderSiteMapResult(data) {
  const resultEl = $('scraperResult');
  const feeds = data.feeds || [];
  const pages = data.pages || [];
  
  let html = `
    <div class="result-header">
      <div>
        <h4>${esc(data.siteName || 'Site Map')}</h4>
        <span class="result-type scraped">${feeds.length} feeds, ${pages.length} pages discovered</span>
      </div>
    </div>
  `;
  
  if (feeds.length > 0) {
    html += `<div class="discovery-section"><h5>Discovered Feeds</h5><div class="discovery-options">`;
    feeds.forEach((feed, idx) => {
      html += `
        <div class="discovery-option" id="sitemap-feed-${idx}">
          <span class="option-icon">📡</span>
          <div class="option-info">
            <strong>${esc(feed.title)}</strong>
            <span>${esc(feed.source)} • ${feed.url}</span>
          </div>
          <button class="btn-select" data-feed-idx="${idx}">Add</button>
        </div>
      `;
    });
    html += `</div></div>`;
  }
  
  if (pages.length > 0) {
    html += `<div class="discovery-section"><h5>Sample Pages</h5><div class="preview-items" style="max-height: 200px; overflow-y: auto;">`;
    pages.slice(0, 10).forEach(page => {
      html += `
        <div class="preview-item" style="cursor: pointer;" onclick="window.open('${esc(page)}', '_blank')">
          <span class="preview-title">${esc(page.replace(/^https?:\/\//, ''))}</span>
        </div>
      `;
    });
    if (pages.length > 10) {
      html += `<div class="preview-item"><span class="preview-title">+ ${pages.length - 10} more pages...</span></div>`;
    }
    html += `</div></div>`;
  }
  
  resultEl.innerHTML = html;
  resultEl.style.display = 'block';
  
  // Bind feed add buttons
  resultEl.querySelectorAll('[data-feed-idx]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.feedIdx);
      const feed = feeds[idx];
      if (feed) {
        btn.disabled = true;
        btn.textContent = 'Adding...';
        try {
          const res = await fetch(`${API}/api/feeds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: feed.url })
          });
          if (!res.ok) throw new Error((await res.json()).error);
          toast('Feed added!', 'success');
          btn.textContent = 'Added';
          await loadFeeds();
          renderSidebar();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Add';
        }
      }
    });
  });
}

async function performScrape(url) {
  const resultEl = $('scraperResult');
  resultEl.innerHTML = `<div class="result-preview"><div class="loading">Analyzing...</div></div>`;

  try {
    const res = await fetch(`${API}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to analyze URL');

    state.scraperResult = data;
    renderScrapeResult(data);

  } catch (err) {
    $('scraperError').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div><span>${esc(err.message)}</span></div></svg>`;
    $('scraperError').style.display = 'flex';
  }
}

function renderScrapeResult(data) {
  const resultEl = $('scraperResult');
  const url = data.siteUrl || data.rssUrl || '';
  
  // Safely get favicon URL
  let faviconUrl = data.favicon;
  if (!faviconUrl && url) {
    try {
      const hostname = new URL(url).hostname;
      faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
    } catch {
      faviconUrl = '';
    }
  }

  let resultHtml = `
    <div class="result-header">
      <img src="${faviconUrl}" alt="" class="result-favicon">
      <div>
        <h4>${esc(data.siteTitle || data.feedData?.title || 'Unknown Site')}</h4>
        <span class="result-type ${data.type}">${data.type === 'rss' ? 'RSS/Atom Feed Found' : 'Generated Feed'}</span>
      </div>
    </div>
  `;

  if (data.error) {
    resultHtml += `<div class="scraper-error"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div><span>${esc(data.error)}</span></div></div>`;
  } else {
    const items = data.items || data.feedData?.items || [];
    
    // Show alternative option if available (e.g., FinancialJuice -> Twitter)
    if (data.alternative && items.length === 0) {
      resultHtml += `
        <div class="result-preview">
          <div class="alternative-notice" style="padding: 16px; background: var(--surface-2); border-radius: 8px; margin-bottom: 12px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle;">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <strong>Alternative Available</strong>
            <p style="margin: 8px 0 0 0; color: var(--text-2);">${esc(data.siteDescription)}</p>
            <button class="save-btn" id="btnUseAlternative" style="margin-top: 12px;">Use ${esc(data.alternative.type)} Feed</button>
          </div>
        </div>
      `;
    } else {
      resultHtml += `
        <div class="result-preview">
          <strong>${items.length} articles found</strong>
          <div class="preview-items">
            ${items.slice(0, 5).map(i => `
              <div class="preview-item">
                ${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}
                <div>
                  <span class="preview-title">${esc(i.title)}</span>
                  ${i.date ? `<span class="preview-date">${formatDate(i.date)}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <button class="save-btn" id="btnSaveScrapedFeed">Save as Feed</button>
      `;
    }
  }

  resultEl.innerHTML = resultHtml;
  resultEl.style.display = 'block';

  const saveBtn = $('btnSaveScrapedFeed');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => saveScrapedFeed(data));
  }
  
  const altBtn = $('btnUseAlternative');
  if (altBtn && data.alternative) {
    altBtn.addEventListener('click', () => {
      // Redirect to scrape the alternative Twitter URL
      $('scraperUrlInput').value = data.alternative.url;
      performScrape(data.alternative.url);
    });
  }
}

async function saveScrapedFeed(data) {
  const btn = $('btnSaveScrapedFeed');
  if (btn) {
    btn.innerHTML = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Saving...`;
    btn.disabled = true;
  }

  try {
    let res;
    if (data.type === 'rss') {
      res = await fetch(`${API}/api/feeds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: data.rssUrl })
      });
    } else {
      res = await fetch(`${API}/api/feeds/scraped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.siteTitle,
          siteUrl: data.siteUrl,
          siteDescription: data.siteDescription,
          items: data.items,
          favicon: data.favicon,
          siteImage: data.siteImage
        })
      });
    }

    if (!res.ok) throw new Error((await res.json()).error || 'Failed to save feed');

    toast('Feed saved successfully!', 'success');
    $('scraperUrlInput').value = '';
    $('scraperResult').style.display = 'none';
    $('scraperError').style.display = 'none';
    
    await loadFeeds();
    renderSidebar();
    await loadArticles();
    
  } catch (err) {
    toast(err.message, 'error');
    if (btn) {
      btn.innerHTML = 'Save as Feed';
      btn.disabled = false;
    }
  }
}

// ── Scraper Input Autocomplete ───────────────────────────────────────────────
const POPULAR_SITES = [
  { title: 'BBC News', url: 'https://www.bbc.com/news', icon: '📰' },
  { title: 'CNN', url: 'https://www.cnn.com', icon: '📰' },
  { title: 'Reuters', url: 'https://www.reuters.com', icon: '📡' },
  { title: 'The Guardian', url: 'https://www.theguardian.com', icon: '📰' },
  { title: 'NY Times', url: 'https://www.nytimes.com', icon: '📰' },
  { title: 'TechCrunch', url: 'https://techcrunch.com', icon: '💻' },
  { title: 'The Verge', url: 'https://www.theverge.com', icon: '💻' },
  { title: 'Wired', url: 'https://www.wired.com', icon: '💻' },
  { title: 'Ars Technica', url: 'https://arstechnica.com', icon: '💻' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com', icon: '💻' },
  { title: 'Reddit', url: 'https://www.reddit.com', icon: '🗣️' },
  { title: 'YouTube', url: 'https://www.youtube.com', icon: '🎥' },
  { title: 'FinancialJuice', url: 'https://www.financialjuice.com/home', icon: '💰' },
  { title: 'Bloomberg', url: 'https://www.bloomberg.com', icon: '💰' },
  { title: 'Wall Street Journal', url: 'https://www.wsj.com', icon: '💰' },
  { title: 'Politico', url: 'https://www.politico.com', icon: '🏛️' },
  { title: 'Vox', url: 'https://www.vox.com', icon: '📰' },
  { title: 'Medium', url: 'https://medium.com', icon: '📝' },
  { title: 'Substack', url: 'https://substack.com', icon: '📝' },
  { title: 'Dev.to', url: 'https://dev.to', icon: '💻' },
  { title: 'GitHub', url: 'https://github.com', icon: '💻' },
  { title: 'Product Hunt', url: 'https://www.producthunt.com', icon: '🚀' },
  { title: 'Techmeme', url: 'https://www.techmeme.com', icon: '💻' },
  { title: 'Mashable', url: 'https://mashable.com', icon: '💻' },
  { title: 'Gizmodo', url: 'https://gizmodo.com', icon: '💻' },
  { title: 'Engadget', url: 'https://www.engadget.com', icon: '💻' },
  { title: 'CNET', url: 'https://www.cnet.com', icon: '💻' },
  { title: 'ZDNet', url: 'https://www.zdnet.com', icon: '💻' },
  { title: 'The Atlantic', url: 'https://www.theatlantic.com', icon: '📰' },
  { title: 'New Yorker', url: 'https://www.newyorker.com', icon: '📰' },
  { title: 'Wired UK', url: 'https://www.wired.co.uk', icon: '💻' },
  { title: 'Nature', url: 'https://www.nature.com', icon: '🔬' },
  { title: 'Science', url: 'https://www.science.org', icon: '🔬' },
];

let scraperSuggestionsActive = false;
let scraperSuggestionIndex = -1;
let currentSuggestions = [];

function initScraperAutocomplete() {
  const input = $('scraperUrlInput');
  const suggestionsEl = $('scraperSuggestions');
  
  if (!input || !suggestionsEl) return;

  input.addEventListener('focus', () => {
    if (input.value.trim().length === 0) {
      showScraperSuggestions(POPULAR_SITES.slice(0, 8), 'Popular Sites');
    }
  });

  input.addEventListener('input', (e) => {
    const value = e.target.value.trim().toLowerCase();
    
    if (value.length === 0) {
      showScraperSuggestions(POPULAR_SITES.slice(0, 8), 'Popular Sites');
      return;
    }

    // Filter popular sites
    const matching = POPULAR_SITES.filter(site => 
      site.title.toLowerCase().includes(value) || 
      site.url.toLowerCase().includes(value)
    );

    // Add existing feeds
    const feedMatches = state.feeds?.filter(f => 
      f.name?.toLowerCase().includes(value) ||
      f.url?.toLowerCase().includes(value)
    ).map(f => ({
      title: f.name,
      url: f.url,
      icon: f.type === 'twitter' ? '🐦' : f.type === 'scraped' ? '🔍' : '📡',
      isExistingFeed: true
    })) || [];

    const suggestions = [...matching.slice(0, 6), ...feedMatches.slice(0, 4)];
    
    if (suggestions.length > 0) {
      const category = feedMatches.length > 0 ? 'Suggestions & Your Feeds' : 'Suggestions';
      showScraperSuggestions(suggestions, category);
    } else {
      hideScraperSuggestions();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (!scraperSuggestionsActive) return;

    switch(e.key) {
      case 'ArrowDown':
        e.preventDefault();
        scraperSuggestionIndex = Math.min(scraperSuggestionIndex + 1, currentSuggestions.length - 1);
        updateSuggestionHighlight();
        break;
      case 'ArrowUp':
        e.preventDefault();
        scraperSuggestionIndex = Math.max(scraperSuggestionIndex - 1, -1);
        updateSuggestionHighlight();
        break;
      case 'Enter':
        if (scraperSuggestionIndex >= 0) {
          e.preventDefault();
          selectScraperSuggestion(currentSuggestions[scraperSuggestionIndex]);
        }
        break;
      case 'Escape':
        hideScraperSuggestions();
        break;
    }
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !suggestionsEl.contains(e.target)) {
      hideScraperSuggestions();
    }
  });
}

function showScraperSuggestions(suggestions, category) {
  const suggestionsEl = $('scraperSuggestions');
  if (!suggestionsEl) return;

  currentSuggestions = suggestions;
  scraperSuggestionIndex = -1;
  scraperSuggestionsActive = true;

  let html = `<div class="suggestion-category">${esc(category)}</div>`;
  
  suggestions.forEach((item, index) => {
    html += `
      <div class="suggestion-item" data-index="${index}" data-url="${esc(item.url)}">
        <span class="suggestion-icon">${item.icon}</span>
        <div class="suggestion-content">
          <span class="suggestion-title">${esc(item.title)}</span>
          <span class="suggestion-url">${esc(item.url)}</span>
        </div>
      </div>
    `;
  });

  suggestionsEl.innerHTML = html;
  suggestionsEl.style.display = 'block';

  // Add click handlers
  suggestionsEl.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      selectScraperSuggestion(currentSuggestions[index]);
    });
  });
}

function updateSuggestionHighlight() {
  const suggestionsEl = $('scraperSuggestions');
  if (!suggestionsEl) return;

  suggestionsEl.querySelectorAll('.suggestion-item').forEach((item, index) => {
    item.classList.toggle('active', index === scraperSuggestionIndex);
  });

  // Scroll active item into view
  if (scraperSuggestionIndex >= 0) {
    const activeItem = suggestionsEl.querySelector('.suggestion-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }
}

function selectScraperSuggestion(item) {
  const input = $('scraperUrlInput');
  if (input) {
    input.value = item.url;
    input.focus();
  }
  hideScraperSuggestions();
}

function hideScraperSuggestions() {
  const suggestionsEl = $('scraperSuggestions');
  if (suggestionsEl) {
    suggestionsEl.style.display = 'none';
  }
  scraperSuggestionsActive = false;
  scraperSuggestionIndex = -1;
  currentSuggestions = [];
}

// ── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  const navAll = $('nav-all');
  if (navAll) navAll.addEventListener('click', e => { e.preventDefault(); setView('all', 'All Articles'); });
  
  const navStarred = $('nav-starred');
  if (navStarred) navStarred.addEventListener('click', e => { e.preventDefault(); setView('starred', 'Starred'); });

  const btnAddFeedToggle = $('btnAddFeedToggle');
  if (btnAddFeedToggle) {
    btnAddFeedToggle.addEventListener('click', () => {
      const form = $('addFeedForm');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
  }

  const btnCancelAddFeed = $('btnCancelAddFeed');
  if (btnCancelAddFeed) {
    btnCancelAddFeed.addEventListener('click', () => {
      $('addFeedForm').style.display = 'none';
      $('feedUrlInput').value = '';
      $('addFeedError').style.display = 'none';
    });
  }

  const addFeedForm = $('addFeedForm');
  if (addFeedForm) {
    addFeedForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = $('feedUrlInput').value.trim();
      if (!url) return;

      const btn = addFeedForm.querySelector('button[type="submit"]');
      const errorEl = $('addFeedError');
      
      btn.disabled = true;
      errorEl.style.display = 'none';

      try {
        const res = await fetch(`${API}/api/feeds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to add feed');
        
        toast('Feed added successfully!', 'success');
        $('feedUrlInput').value = '';
        $('addFeedForm').style.display = 'none';
        await loadFeeds();
        renderSidebar();
        await loadArticles();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'flex';
      } finally {
        btn.disabled = false;
      }
    });
  }

  const btnToggleScraper = $('btnToggleScraper');
  if (btnToggleScraper) {
    btnToggleScraper.addEventListener('click', () => {
      const scraper = $('urlScraper');
      const isVisible = scraper.style.display !== 'none';
      scraper.style.display = isVisible ? 'none' : 'block';
      btnToggleScraper.classList.toggle('active', !isVisible);
    });
  }

  const scraperForm = $('scraperForm');
  if (scraperForm) {
    scraperForm.addEventListener('submit', handleScrape);
  }

  const searchInput = $('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value;
      const clearBtn = $('searchClear');
      if (clearBtn) clearBtn.style.display = state.search ? 'block' : 'none';
      applyFilters();
    });
  }

  const searchClear = $('searchClear');
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.search = '';
      searchClear.style.display = 'none';
      applyFilters();
    });
  }

  const btnSettings = $('btnSettings');
  if (btnSettings) btnSettings.addEventListener('click', () => openModal('modalSettings'));

  const settingTheme = $('settingTheme');
  if (settingTheme) {
    settingTheme.value = state.settings.theme;
    settingTheme.addEventListener('change', () => {
      state.settings.theme = settingTheme.value;
      localStorage.setItem('rssToolSettings', JSON.stringify(state.settings));
      applySettings();
    });
  }

  const settingFontSize = $('settingFontSize');
  if (settingFontSize) {
    settingFontSize.value = state.settings.fontSize;
    settingFontSize.addEventListener('change', () => {
      state.settings.fontSize = settingFontSize.value;
      localStorage.setItem('rssToolSettings', JSON.stringify(state.settings));
      applySettings();
    });
  }

  const settingShowImages = $('settingShowImages');
  if (settingShowImages) {
    settingShowImages.checked = state.settings.showImages !== false;
    settingShowImages.addEventListener('change', () => {
      state.settings.showImages = settingShowImages.checked;
      localStorage.setItem('rssToolSettings', JSON.stringify(state.settings));
      renderArticleList(true);
    });
  }

  const settingRefreshInterval = $('settingRefreshInterval');
  if (settingRefreshInterval) {
    settingRefreshInterval.value = state.settings.refreshInterval || 0;
    settingRefreshInterval.addEventListener('change', () => {
      const minutes = parseInt(settingRefreshInterval.value, 10);
      state.settings.refreshInterval = minutes;
      localStorage.setItem('rssToolSettings', JSON.stringify(state.settings));
      setupAutoRefresh();
      toast(minutes > 0 ? `Auto-refresh set to ${minutes} minutes` : 'Auto-refresh disabled', 'success');
    });
  }
  $$('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const modal = tab.closest('.modal');
      modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = modal.querySelector(`#tab-${tab.dataset.tab}`);
      if (panel) panel.classList.add('active');
    });
  });

  $$('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal;
      if (modalId) closeModal(modalId);
    });
  });

  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  const btnAddCollection = $('btnAddCollection');
  if (btnAddCollection) btnAddCollection.addEventListener('click', () => openModal('modalAddCollection'));

  const btnSaveCollection = $('btnSaveCollection');
  if (btnSaveCollection) {
    btnSaveCollection.addEventListener('click', async () => {
      const name = $('collectionName').value.trim();
      if (!name) return toast('Please enter a name', 'error');

      try {
        await fetch(`${API}/api/collections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, color: state.selectedColor })
        });
        closeModal('modalAddCollection');
        $('collectionName').value = '';
        await loadCollections();
        renderSidebar();
        toast('Collection created!', 'success');
      } catch (err) { console.error('Failed to create collection:', err); toast('Failed to create collection', 'error'); }
    });
  }

  $$('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      $$('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      state.selectedColor = sw.dataset.color;
    });
  });

  const btnImportOPML = $('btnImportOPML');
  if (btnImportOPML) btnImportOPML.addEventListener('click', () => openModal('modalImport'));

  const opmlDropZone = $('opmlDropZone');
  if (opmlDropZone) {
    opmlDropZone.addEventListener('click', () => $('opmlFile').click());
    opmlDropZone.addEventListener('dragover', e => { e.preventDefault(); opmlDropZone.classList.add('drag-over'); });
    opmlDropZone.addEventListener('dragleave', () => opmlDropZone.classList.remove('drag-over'));
    opmlDropZone.addEventListener('drop', e => {
      e.preventDefault();
      opmlDropZone.classList.remove('drag-over');
      handleOPMLFile(e.dataTransfer.files[0]);
    });
  }

  const opmlFile = $('opmlFile');
  if (opmlFile) {
    opmlFile.addEventListener('change', e => handleOPMLFile(e.target.files[0]));
  }

  const btnExport = $('btnExport');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const menu = $('exportMenu');
      if (menu) menu.classList.toggle('open');
    });
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.export-dropdown')) {
      const menu = $('exportMenu');
      if (menu) menu.classList.remove('open');
    }
  });

  const btnConfirmDelete = $('btnConfirmDelete');
  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', async () => {
      // Handle bulk delete if pending
      if (pendingBulkDelete) {
        await executeBulkDelete();
        return;
      }
      
      if (!state.confirmAction) return;
      const { type, id } = state.confirmAction;
      btnConfirmDelete.disabled = true;
      
      try {
        if (type === 'feed') {
          await fetch(`${API}/api/feeds/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (state.currentView === 'feed:' + id) setView('all', 'All Articles');
        } else if (type === 'collection') {
          await fetch(`${API}/api/collections/${id}`, { method: 'DELETE' });
          if (state.currentView === 'collection:' + id) setView('all', 'All Articles');
        }
        
        await loadFeeds();
        await loadCollections();
        renderSidebar();
        await loadArticles();
        toast('Deleted successfully', 'success');
      } catch (err) {
        console.error('Delete failed:', err);
        toast('Delete failed', 'error');
      } finally {
        btnConfirmDelete.disabled = false;
        closeModal('modalConfirmDelete');
      }
    });
  }

  // Bulk actions
  const btnBulkToggle = $('btnBulkToggle');
  if (btnBulkToggle) btnBulkToggle.addEventListener('click', toggleBulkMode);
  
  const btnBulkMove = $('btnBulkMove');
  if (btnBulkMove) btnBulkMove.addEventListener('click', bulkMove);
  
  const btnBulkDelete = $('btnBulkDelete');
  if (btnBulkDelete) btnBulkDelete.addEventListener('click', bulkDelete);

  // Refresh All
  const btnRefreshAll = $('btnRefreshAll');
  if (btnRefreshAll) {
    btnRefreshAll.addEventListener('click', async () => {
      btnRefreshAll.classList.add('spinning');
      toast('Refreshing all feeds...', 'info');
      console.log(`[REFRESH-ALL] Starting refresh of ${state.feeds.length} feeds`);
      
      let success = 0, failed = 0;
      
      // Process sequentially with delay to avoid overwhelming the server
      for (const f of state.feeds) {
        try {
          console.log(`[REFRESH-ALL] Refreshing feed: ${f.name || f.id}`);
          const res = await fetch(`${API}/api/feeds/${encodeURIComponent(f.id)}/refresh`, { method: 'POST' });
          if (res.ok) {
            success++;
            console.log(`[REFRESH-ALL] Success: ${f.name || f.id}`);
          } else {
            failed++;
            console.error(`[REFRESH-ALL] Failed: ${f.name || f.id} - ${res.status}`);
          }
          // Small delay between requests to prevent server overload
          await new Promise(r => setTimeout(r, 200));
        } catch (err) {
          console.error(`[REFRESH-ALL] Error refreshing ${f.id}:`, err);
          failed++;
        }
      }
      
      console.log(`[REFRESH-ALL] Completed: ${success} success, ${failed} failed`);
      
      await loadFeeds();
      renderSidebar();
      await loadArticles();
      
      btnRefreshAll.classList.remove('spinning');
      toast(`Refreshed ${success} feeds${failed > 0 ? `, ${failed} failed` : ''}`, failed > 0 ? 'warning' : 'success');
    });
  }
}

function bindSidebarEvents() {
  // Feed item clicks (when not in bulk mode)
  $$('.feed-item[data-feedid]').forEach(el => {
    if (!state.bulkMode) {
      el.addEventListener('click', e => {
        if (e.target.closest('.feed-actions')) return;
        const feedId = el.dataset.feedid;
        const feed = state.feeds.find(f => f.id === feedId);
        if (feed) {
          $$('.feed-item, .collection-item, .nav-item').forEach(i => i.classList.remove('active'));
          el.classList.add('active');
          setView('feed:' + feedId, feed.name);
        }
      });
    }
    
    // Drag events
    if (!state.bulkMode) {
      el.addEventListener('dragstart', e => {
        state.draggedFeedId = el.dataset.feedid;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        state.draggedFeedId = null;
      });
    }
    
    // Checkbox in bulk mode
    const checkbox = el.querySelector('.feed-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        toggleFeedSelection(el.dataset.feedid);
      });
    }
    
    // Refresh/delete buttons
    const refreshBtn = el.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const feedId = el.dataset.feedid;
        toast('Refreshing feed...', 'info');
        try {
          await fetch(`${API}/api/feeds/${encodeURIComponent(feedId)}/refresh`, { method: 'POST' });
          await loadFeeds();
          renderSidebar();
          if (state.currentView === 'feed:' + feedId || state.currentView === 'all') {
            await loadArticles();
          }
          toast('Feed refreshed!', 'success');
        } catch (err) {
          console.error(`Failed to refresh feed ${feedId}:`, err);
          toast('Refresh failed', 'error');
        }
      });
    }
    
    const deleteBtn = el.querySelector('.delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        const feedId = el.dataset.feedid;
        state.confirmAction = { type: 'feed', id: feedId };
        $('confirmDeleteMessage').textContent = 'Are you sure you want to delete this feed?';
        openModal('modalConfirmDelete');
      });
    }
  });

  // Collection clicks
  $$('.collection-item[data-colid]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.feed-actions') || e.target.closest('.expand-btn')) return;
      const colId = el.dataset.colid;
      const col = state.collections.find(c => c.id === colId);
      if (col) {
        $$('.feed-item, .collection-item, .nav-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
        setView('collection:' + colId, col.name);
      }
    });
  });

  // Expand buttons
  $$('.expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const colId = btn.dataset.colid;
      state.expandedCollections[colId] = !state.expandedCollections[colId];
      renderSidebar();
    });
  });

  // Nested feed clicks and drag
  $$('.nested-feed').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.feed-checkbox')) return;
      const feedId = el.dataset.feedid;
      const feed = state.feeds.find(f => f.id === feedId);
      if (feed) {
        $$('.feed-item, .collection-item, .nav-item, .nested-feed').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
        setView('feed:' + feedId, feed.name);
      }
    });
    
    // Drag events for nested feeds
    if (!state.bulkMode) {
      el.addEventListener('dragstart', e => {
        state.draggedFeedId = el.dataset.feedid;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        state.draggedFeedId = null;
      });
    }
    
    const checkbox = el.querySelector('.feed-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        toggleFeedSelection(el.dataset.feedid);
      });
    }
  });

  // Collection drag-drop targets (for moving between collections and from collection to another)
  $$('.collection-item[data-colid]').forEach(el => {
    el.addEventListener('dragover', e => {
      if (!state.draggedFeedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });
    
    el.addEventListener('drop', async e => {
      if (!state.draggedFeedId) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      
      const targetColId = el.dataset.colid;
      const feedId = state.draggedFeedId;
      
      // Check if feed is already in target collection
      const targetCol = state.collections.find(c => c.id === targetColId);
      if (targetCol && (targetCol.feedIds || []).includes(feedId)) {
        toast('Feed already in this collection', 'warning');
        return;
      }
      
      try {
        // Remove from current collection
        const currentCol = state.collections.find(c => (c.feedIds || []).includes(feedId));
        if (currentCol) {
          const updatedIds = currentCol.feedIds.filter(id => id !== feedId);
          await fetch(`${API}/api/collections/${currentCol.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedIds: updatedIds })
          });
        }
        
        // Add to target collection
        if (targetCol) {
          const updatedIds = [...(targetCol.feedIds || []), feedId];
          await fetch(`${API}/api/collections/${targetColId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedIds: updatedIds })
          });
        }
        
        await loadCollections();
        renderSidebar();
        toast('Feed moved', 'success');
      } catch (err) {
        console.error('Failed to move feed to collection:', err);
        toast('Move failed', 'error');
      }
    });
  });

  // Drop target for feeds list (move back to unassigned)
  const feedsList = $('feedsList');
  const feedsSection = feedsList?.closest('.sidebar-section');
  const dropTarget = feedsSection || feedsList;
  
  if (dropTarget) {
    // Track drag counter to handle child element events
    let dragCounter = 0;
    
    dropTarget.addEventListener('dragenter', e => {
      if (!state.draggedFeedId) return;
      dragCounter++;
      e.preventDefault();
      dropTarget.classList.add('drag-over');
    });
    
    dropTarget.addEventListener('dragover', e => {
      if (!state.draggedFeedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropTarget.classList.add('drag-over');
    });
    
    dropTarget.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropTarget.classList.remove('drag-over');
      }
    });
    
    dropTarget.addEventListener('drop', async e => {
      if (!state.draggedFeedId) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropTarget.classList.remove('drag-over');
      
      const feedId = state.draggedFeedId;
      state.draggedFeedId = null; // Prevent duplicate drops
      
      // Check if feed is currently in any collection
      const currentCol = state.collections.find(c => (c.feedIds || []).includes(feedId));
      if (!currentCol) {
        toast('Feed is already unassigned', 'info');
        return;
      }
      
      try {
        // Remove from current collection
        const updatedIds = currentCol.feedIds.filter(id => id !== feedId);
        await fetch(`${API}/api/collections/${currentCol.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedIds: updatedIds })
        });
        
        await loadCollections();
        renderSidebar();
        toast('Feed moved to unassigned', 'success');
      } catch (err) {
        console.error('Failed to move feed to unassigned:', err);
        toast('Move failed', 'error');
      }
    });
  }

  // Collection delete
  $$('.delete-btn[data-colid]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const colId = btn.dataset.colid;
      state.confirmAction = { type: 'collection', id: colId };
      $('confirmDeleteMessage').textContent = 'Are you sure you want to delete this collection?';
      openModal('modalConfirmDelete');
    });
  });
}

// Track auto-refresh timer
let autoRefreshTimer = null;

// ── Auto Refresh ────────────────────────────────────────────────────────────
function setupAutoRefresh() {
  // Clear existing timer
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  
  const minutes = state.settings.refreshInterval;
  if (minutes > 0) {
    console.log(`[AUTO-REFRESH] Setting up auto-refresh every ${minutes} minutes`);
    autoRefreshTimer = setInterval(async () => {
      console.log('[AUTO-REFRESH] Running scheduled refresh');
      // Trigger refresh all silently (without UI feedback)
      for (const f of state.feeds) {
        try {
          await fetch(`${API}/api/feeds/${encodeURIComponent(f.id)}/refresh`, { method: 'POST' });
          await new Promise(r => setTimeout(r, 200));
        } catch (err) {
          console.error(`[AUTO-REFRESH] Failed to refresh ${f.id}:`, err);
        }
      }
      await loadFeeds();
      await loadArticles();
      console.log('[AUTO-REFRESH] Completed scheduled refresh');
    }, minutes * 60 * 1000);
  }
}
async function handleOPMLFile(file) {
  if (!file) return;
  const text = await file.text();
  
  try {
    const res = await fetch(`${API}/api/import/opml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opmlContent: text })
    });
    const data = await res.json();
    
    if (data.urls && data.urls.length > 0) {
      let imported = 0;
      for (const url of data.urls) {
        try {
          await fetch(`${API}/api/feeds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          imported++;
        } catch (err) {
          console.error(`Failed to import feed ${url}:`, err);
        }
      }
      
      closeModal('modalImport');
      await loadFeeds();
      renderSidebar();
      await loadArticles();
      toast(`Imported ${imported} feeds`, 'success');
    }
  } catch (err) {
    console.error('Failed to import OPML:', err);
    toast('Failed to import OPML', 'error');
  }
}

// ── Modals ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const modal = $(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = $(id);
  if (modal) modal.classList.remove('open');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function stripHtml(s) { return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

function formatDate(d) {
  const dt = new Date(d);
  const now = new Date();
  const diff = now - dt;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.round(diff / 86400000)}d ago`;
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;
  
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  el.innerHTML = `<span style="font-weight:600;">${icons[type] || '•'}</span> ${esc(message)}`;
  container.appendChild(el);
  
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

function toggleStar(id) {
  if (!id) return;
  const wasStarred = state.starred.has(id);
  if (wasStarred) state.starred.delete(id); else state.starred.add(id);
  localStorage.setItem('starred', JSON.stringify([...state.starred]));
  if (state.currentView === 'starred') applyFilters();
}

// ── Settings ─────────────────────────────────────────────────────────────────
function applySettings() {
  const theme = state.settings.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : state.settings.theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font', state.settings.fontSize);
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (state.settings.theme === 'system') applySettings();
});

// ── Run ───────────────────────────────────────────────────────────────────────
init();
