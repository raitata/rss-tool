/* =============================================================
   RSS Tool — app.js
   Complete client-side application logic
   ============================================================= */

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
  search: '',
  filter: 'all',
  sort: 'date',
  layout: 'grid',
  starred: new Set(JSON.parse(localStorage.getItem('starred') || '[]')),
  offset: 0,
  PAGE_SIZE: 40,
  widgetFeedId: null,
  selectedColor: '#4F8EF7',
  url2rssResult: null,   // result from /api/scrape for the url2rss tab
  scrapeResult: null,    // legacy
  confirmAction: null,
  renameColId: null,
  settings: JSON.parse(localStorage.getItem('rssToolSettings')) || {
    rssHubUrl: 'https://rsshub.app',
    theme: 'dark',
    fontSize: 'medium',
    showImages: true
  }
};

// Expose state and API to window for global access
window.state = state;
window.API = API;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadFeeds(), loadCollections()]);
  renderSidebar();
  await loadArticles();
  bindEvents();
  setLayout(state.layout);
  applySettings();
}

// ── Data Loading ─────────────────────────────────────────────────────────────
async function loadFeeds() {
  try {
    const res = await fetch(`${API}/api/feeds`);
    state.feeds = await res.json();
  } catch { state.feeds = []; }
}

async function loadCollections() {
  try {
    const res = await fetch(`${API}/api/collections`);
    state.collections = await res.json();
  } catch { state.collections = []; }
}

async function loadArticles() {
  $('articlesGrid').innerHTML = `<div class="loading-indicator"><div class="spinner"></div><span>Loading articles…</span></div>`;
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
  } catch { state.articles = []; }
  applyFilters();
}

// ── Filtering & Sorting ───────────────────────────────────────────────────────
function applyFilters() {
  let articles = [...state.articles];

  // View-specific
  if (state.currentView === 'starred') {
    articles = articles.filter(a => state.starred.has(a.id || a.link));
  }

  // Date filters
  const now = Date.now();
  if (state.filter === 'today') {
    articles = articles.filter(a => now - new Date(a.date) < 86400000);
  } else if (state.filter === 'week') {
    articles = articles.filter(a => now - new Date(a.date) < 7 * 86400000);
  } else if (state.filter === 'images') {
    articles = articles.filter(a => a.image);
  }

  // Search
  if (state.search) {
    const q = state.search.toLowerCase();
    articles = articles.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.content || '').toLowerCase().includes(q) ||
      (a.feedName || '').toLowerCase().includes(q)
    );
  }

  // Sort
  if (state.sort === 'date') articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  else if (state.sort === 'date-asc') articles.sort((a, b) => new Date(a.date) - new Date(b.date));
  else if (state.sort === 'feed') articles.sort((a, b) => (a.feedName || '').localeCompare(b.feedName || ''));

  state.filteredArticles = articles;
  renderArticles(true);
  updateBadges();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  const feedsList = $('feedsList');
  if (!state.feeds.length && !state.collections.length) {
    feedsList.innerHTML = '<div class="empty-hint">No feeds or folders yet.<br/>Click + to add one.</div>';
    return;
  }

  // Find unassigned feeds
  const unassignedFeeds = state.feeds.filter(f => !state.collections.some(c => (c.feedIds || []).includes(f.id)));

  // Generate Collections (Folders) HTML
  const collectionsHtml = state.collections.map(c => {
    const colFeeds = state.feeds.filter(f => (c.feedIds || []).includes(f.id));
    const isColActive = state.currentView === 'collection:' + c.id;
    // Keep it open if a child feed is active
    const hasActiveChild = colFeeds.some(f => state.currentView === 'feed:' + f.id);
    const isOpen = isColActive || hasActiveChild;

    const feedsHtml = colFeeds.map(f => `
      <div class="feed-item ${state.currentView === 'feed:' + f.id ? 'active' : ''}" data-feedid="${f.id}" style="padding-left: 42px;" draggable="true">
        <div class="feed-checkbox-wrapper">
          <input type="checkbox" class="feed-checkbox" data-feedid="${f.id}" title="Select for bulk operations">
        </div>
        <img class="feed-favicon" src="${f.favicon || 'default.ico'}" alt="" onerror="this.style.display='none'">
        <span class="feed-item-name">${esc(f.name)}</span>
        <div class="feed-item-actions">
          <button class="feed-action-btn move-btn" data-feedid="${f.id}" title="Move to folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>
          </button>
          <button class="feed-action-btn widget-btn" data-feedid="${f.id}" title="Get widget">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          </button>
          <button class="feed-action-btn refresh-btn" data-feedid="${f.id}" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
          <button class="feed-action-btn delete-btn" data-feedid="${f.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    return `
      <div class="folder-group" data-colid="${c.id}">
        <div class="folder-header feed-item ${isColActive ? 'active' : ''}" style="gap: 8px;" data-folder-target="${c.id}">
          <svg class="folder-icon" style="color:${c.color || 'var(--text-muted)'}" width="16" height="16" viewBox="0 0 24 24" fill="${isOpen ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="feed-item-name" style="font-weight: 500;">${esc(c.name)}</span>
          <div class="feed-item-actions">
            <button class="feed-action-btn edit-col-btn" data-colid="${c.id}" data-name="${esc(c.name)}" title="Rename Folder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="feed-action-btn delete-col-btn" data-colid="${c.id}" title="Delete Folder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>
        </div>
        <div class="folder-content" style="display: ${isOpen ? 'block' : 'none'};" data-folder-target="${c.id}">
          ${feedsHtml}
        </div>
      </div>
    `;
  }).join('');

  // Generate Unassigned Feeds HTML
  const unassignedHtml = unassignedFeeds.map(f => `
    <div class="feed-item ${state.currentView === 'feed:' + f.id ? 'active' : ''}" data-feedid="${f.id}" draggable="true">
      <div class="feed-checkbox-wrapper">
        <input type="checkbox" class="feed-checkbox" data-feedid="${f.id}" title="Select for bulk operations">
      </div>
      <img class="feed-favicon" src="${f.favicon || 'default.ico'}" alt="" onerror="this.style.display='none'">
      <span class="feed-item-name">${esc(f.name)}</span>
      <div class="feed-item-actions">
        <button class="feed-action-btn move-btn" data-feedid="${f.id}" title="Move to folder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>
        </button>
        <button class="feed-action-btn widget-btn" data-feedid="${f.id}" title="Get widget">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        </button>
        <button class="feed-action-btn refresh-btn" data-feedid="${f.id}" title="Refresh">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        </button>
        <button class="feed-action-btn delete-btn" data-feedid="${f.id}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  feedsList.innerHTML = collectionsHtml + unassignedHtml;

  bindSidebarEvents();
}

function renderArticles(reset = false) {
  const grid = $('articlesGrid');
  const layoutClass = state.layout === 'grid' ? 'is-grid' : 'is-list';

  if (reset) {
    state.offset = 0;
    grid.className = 'articles-grid ' + layoutClass;
  }

  const page = state.filteredArticles.slice(state.offset, state.offset + state.PAGE_SIZE);

  if (reset && page.length === 0) {
    grid.innerHTML = state.articles.length === 0
      ? `<div class="welcome-screen" id="welcomeScreen">
          <div class="welcome-icon">📡</div>
          <h2>Welcome to RSS Tool</h2>
          <p>Your free, local-first RSS aggregator. Add your first feed to get started.</p>
          <button class="btn-primary" id="btnWelcomeAddFeed">Add Your First Feed</button>
        </div>`
      : `<div class="welcome-screen"><div class="welcome-icon">🔍</div><h2>No articles found</h2><p>Try adjusting your search or filters.</p></div>`;
    $('loadMoreWrapper').style.display = 'none';
    const wBtn = $('btnWelcomeAddFeed');
    if (wBtn) wBtn.onclick = () => openModal('modalAddFeed');
    return;
  }

  const html = page.map(a => articleCard(a)).join('');
  if (reset) {
    grid.innerHTML = html;
  } else {
    grid.insertAdjacentHTML('beforeend', html);
  }

  state.offset += page.length;
  const hasMore = state.filteredArticles.length > state.offset;
  $('loadMoreWrapper').style.display = hasMore ? 'block' : 'none';

  // Bind card clicks
  grid.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.article-action')) return;
      const idx = card.dataset.idx;
      openArticle(state.filteredArticles[idx]);
    });
    const starBtn = card.querySelector('.star-btn-card');
    if (starBtn) starBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleStar(card.dataset.artid, card);
    });
  });
}

function articleCard(article, idx) {
  // Find index in filteredArticles
  const artIdx = state.filteredArticles.indexOf(article);
  const id = article.id || article.link || '';
  const isStarred = state.starred.has(id);
  const dateStr = article.date ? formatDate(article.date) : '';

  let imgHtml = '';
  if (state.settings.showImages) {
    if (article.image) {
      imgHtml = `<div class="article-img"><img src="${esc(article.image)}" alt="" loading="lazy" onload="this.classList.add('loaded')" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=\\'article-img-placeholder\\'>📰</div>'"></div>`;
    } else {
      // Try to extract image from content if no main image
      const contentImg = extractFirstImage(article.content || article.summary || '');
      if (contentImg) {
        imgHtml = `<div class="article-img"><img src="${esc(contentImg)}" alt="" loading="lazy" onload="this.classList.add('loaded')" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=\\'article-img-placeholder\\'>📰</div>'"></div>`;
      } else {
        imgHtml = `<div class="article-img"><div class="article-img-placeholder">📰</div></div>`;
      }
    }
  }

  return `
    <div class="article-card ${isStarred ? 'starred' : ''}" data-idx="${artIdx}" data-artid="${esc(id)}">
      ${imgHtml}
      <div class="article-body">
        <div class="article-source">
          ${article.favicon ? `<img src="${esc(article.favicon)}" alt="">` : ''}
          <span class="article-source-name">${esc(article.feedName || '')}</span>
        </div>
        <div class="article-title">${esc(article.title || 'Untitled')}</div>
        <div class="article-excerpt">${esc(stripHtml(article.content || ''))}</div>
        <div class="article-meta">
          <span class="article-date">${dateStr}</span>
          <div class="article-actions">
            <button class="article-action star-btn-card ${isStarred ? 'starred' : ''}" title="${isStarred ? 'Unstar' : 'Star'}">
              <svg viewBox="0 0 24 24" stroke="currentColor" fill="${isStarred ? '#f59e0b' : 'none'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
            <a class="article-action" href="${esc(article.link)}" target="_blank" rel="noopener" title="Open in browser" onclick="event.stopPropagation()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}

function openArticle(article) {
  const pane = document.querySelector('.reading-pane');
  const content = $('readingContent');
  pane.classList.add('open');

  const id = article.id || article.link || '';
  const isStarred = state.starred.has(id);

  $('openExternal').href = article.link || '#';
  $('starArticle').dataset.artid = id;
  $('starArticle').querySelector('svg').setAttribute('fill', isStarred ? '#f59e0b' : 'none');

  const dateStr = article.date ? new Date(article.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  let embedHtml = '';
  if (article.link) {
    const ytMatch = article.link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
    if (ytMatch && ytMatch[1]) {
      const videoId = ytMatch[1];
      embedHtml = `
        <div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 8px; margin-bottom: 16px;">
          <iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border:0;" src="https://www.youtube.com/embed/${videoId}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
        </div>
      `;
    }
  }

  // Show quick preview first with loading indicator for full content
  content.innerHTML = `
    <div class="reading-article-source">
      ${article.favicon ? `<img src="${esc(article.favicon)}" alt="">` : ''}
      <span>${esc(article.feedName || '')}</span>
    </div>
    <div class="reading-article-title">${esc(article.title || 'Untitled')}</div>
    ${embedHtml ? embedHtml : (article.image ? `<img class="reading-article-image" src="${esc(article.image)}" alt="">` : '')}
    <div class="reading-article-meta">
      ${article.author ? `<span>✍️ ${esc(article.author)}</span>` : ''}
      ${dateStr ? `<span>📅 ${dateStr}</span>` : ''}
    </div>
    <div class="reading-article-body" id="articleFullContent">
      ${embedHtml ? (article.content || article.contentSnippet || '<p>Video</p>') : `
      <div class="article-loading">
        <div class="spinner"></div>
        <span>Loading full article…</span>
      </div>
      `}
    </div>
    <a href="${esc(article.link)}" target="_blank" rel="noopener" class="reading-open-full">Open in Browser →</a>
  `;

  // Fetch the full article content from the proxy
  if (article.link && !embedHtml) {
    fetchFullArticle(article);
  } else if (!embedHtml) {
    $('articleFullContent').innerHTML = article.fullContent || article.content || '<p>No content available.</p>';
  }
}

async function fetchFullArticle(article) {
  const bodyEl = $('articleFullContent');
  if (!bodyEl) return;

  try {
    const res = await fetch(`${API}/api/article-content?url=${encodeURIComponent(article.link)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    // If the proxy returned a hero image we didn't have, inject it
    if (data.heroImage && !article.image) {
      const titleEl = document.querySelector('.reading-article-title');
      if (titleEl && !titleEl.nextElementSibling?.classList?.contains('reading-article-image')) {
        titleEl.insertAdjacentHTML('afterend', `<img class="reading-article-image" src="${esc(data.heroImage)}" alt="" onerror="this.remove()">`);
      }
    }

    // Update author/date if proxy found better data
    const metaEl = document.querySelector('.reading-article-meta');
    if (metaEl) {
      let metaHtml = '';
      const author = data.author || article.author || '';
      const date = data.date || article.date || '';
      if (author) metaHtml += `<span>✍️ ${esc(author)}</span>`;
      if (date) {
        const dateStr = new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        metaHtml += `<span>📅 ${dateStr}</span>`;
      }
      if (data.siteName) metaHtml += `<span>🌐 ${esc(data.siteName)}</span>`;
      if (metaHtml) metaEl.innerHTML = metaHtml;
    }

    bodyEl.innerHTML = data.content || '<p>Could not extract article content.</p>';

    // --- Strip duplicate title and hero image from extracted content --- //
    const cleanStr = (s) => (s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetTitle = cleanStr(article.title);
    if (targetTitle.length > 5) {
      bodyEl.querySelectorAll('h1, h2, h3').forEach(heading => {
        const headingText = cleanStr(heading.textContent);
        if (headingText && (targetTitle.includes(headingText) || headingText.includes(targetTitle))) {
          heading.remove();
        }
      });
    }

    const heroImageTarget = data.heroImage || article.image;
    if (heroImageTarget) {
      // Extract unique identifier from image URL (e.g., UUID or filename chunk)
      const parts = heroImageTarget.split('/').pop().split('?')[0].split('.')[0];
      const uuidMatch = heroImageTarget.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      const targetId = uuidMatch ? uuidMatch[0] : parts;

      bodyEl.querySelectorAll('img').forEach((img, idx) => {
        // Only check the first few images for a hero duplicate
        if (idx > 3) return; 
        const src = img.getAttribute('src') || '';
        if (src === heroImageTarget || (targetId && targetId.length > 8 && src.includes(targetId))) {
          // Remove the image and its parent figure/div if it's now empty
          const parent = img.parentElement;
          img.remove();
          if (parent && (parent.tagName === 'FIGURE' || parent.tagName === 'DIV') && parent.textContent.trim() === '') {
            parent.remove();
          }
        }
      });
    }

    // Clean up images: hide broken ones, remove tiny tracking pixels
    cleanArticleImages(bodyEl);

  } catch (err) {
    // Fall back to RSS content
    const fallback = article.fullContent || article.content || '';
    if (fallback && fallback.length > 50) {
      bodyEl.innerHTML = fallback;
    } else {
      bodyEl.innerHTML = `<p class="article-fetch-error">Could not load article content. <a href="${esc(article.link)}" target="_blank">Open in browser →</a></p>`;
    }
  }
}

// Clean article images: hide broken ones, remove tiny tracking pixels, fade in on load
function cleanArticleImages(container) {
  if (!container) return;
  container.querySelectorAll('img').forEach(img => {
    // Remove known tracking/spacer images
    const src = img.getAttribute('src') || '';
    if (!src || src === '' || src.startsWith('data:image/gif') || src.includes('pixel') || src.includes('beacon') || src.includes('tracker') || src.includes('1x1')) {
      img.remove();
      return;
    }
    // Remove explicit 1x1 or tiny images
    const w = img.getAttribute('width');
    const h = img.getAttribute('height');
    if ((w && parseInt(w) <= 5) || (h && parseInt(h) <= 5)) {
      img.remove();
      return;
    }
    // Hide image initially, show only after successful load
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.3s ease';
    img.style.background = 'var(--bg-3)';
    img.onload = () => {
      // After loading, check natural dimensions — remove if tiny
      if (img.naturalWidth <= 5 || img.naturalHeight <= 5) {
        img.remove();
        return;
      }
      img.style.opacity = '1';
    };
    img.onerror = () => img.remove();
    // If already loaded (cached), trigger check immediately
    if (img.complete) {
      if (img.naturalWidth <= 5 || img.naturalHeight <= 5 || img.naturalWidth === 0) {
        img.remove();
      } else {
        img.style.opacity = '1';
      }
    }
  });
}

function updateBadges() {
  const allCount = state.filteredArticles.length;
  const starCount = state.articles.filter(a => state.starred.has(a.id || a.link)).length;
  const allBadge = $('badge-all');
  const starBadge = $('badge-starred');
  allBadge.textContent = allCount;
  allBadge.className = 'badge' + (allCount > 0 ? ' visible' : '');
  starBadge.textContent = starCount;
  starBadge.className = 'badge' + (starCount > 0 ? ' visible' : '');
}

function setLayout(layout) {
  state.layout = layout;
  const grid = $('articlesGrid');
  grid.className = 'articles-grid ' + (layout === 'grid' ? 'is-grid' : 'is-list');
  $('viewGrid').className = 'view-btn' + (layout === 'grid' ? ' active' : '');
  $('viewList').className = 'view-btn' + (layout === 'list' ? ' active' : '');
}

function setView(view, title, subtitle = '') {
  state.currentView = view;
  $('viewTitle').textContent = title;
  $('viewSubtitle').textContent = subtitle;
  $$('.nav-item').forEach(el => el.classList.remove('active'));
  $$('.feed-item').forEach(el => el.classList.remove('active'));
  $$('.collection-item').forEach(el => el.classList.remove('active'));
  if (view === 'all') $('nav-all').classList.add('active');
  loadArticles();
}

// ── Bind Events ───────────────────────────────────────────────────────────────
function bindEvents() {
  // Search
  const searchInput = $('searchInput');
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    $('searchClear').className = 'search-clear' + (state.search ? ' visible' : '');
    applyFilters();
  });
  $('searchClear').addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    $('searchClear').className = 'search-clear';
    applyFilters();
  });

  // Filters
  $$('.filter-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      applyFilters();
    });
  });

  // Sort
  $('sortSelect').addEventListener('change', () => {
    state.sort = $('sortSelect').value;
    applyFilters();
  });

  // Layout
  $('viewGrid').addEventListener('click', () => { setLayout('grid'); renderArticles(true); });
  $('viewList').addEventListener('click', () => { setLayout('list'); renderArticles(true); });

  // View nav
  $('nav-all').addEventListener('click', e => { e.preventDefault(); setView('all', 'All Articles'); });
  $$('[data-view="starred"]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault(); setView('starred', 'Starred');
  }));

  // Sidebar toggle
  $('sidebarToggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('collapsed'));

  // Add feed button
  $('btnAddFeed').addEventListener('click', () => openModal('modalAddFeed'));

  // URL→RSS generate button
  $('btnUrl2rssGo').addEventListener('click', handleUrl2rss);
  $('url2rssInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleUrl2rss(); });

  // Refresh all
  $('btnRefreshAll').addEventListener('click', refreshAll);

  // Add collection
  $('btnAddCollection').addEventListener('click', openAddCollection);

  // Modal closes
  $$('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay') || document.getElementById(btn.dataset.modal);
      if (modal) { closeModal(modal.id); }
    });
  });
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) { closeModal(overlay.id); } });
  });

  // Settings Modal
  $('btnSettings').addEventListener('click', () => {
    $('settingRssHubUrl').value = state.settings.rssHubUrl || 'https://rsshub.app';
    $('settingTheme').value = state.settings.theme || 'dark';
    $('settingFontSize').value = state.settings.fontSize || 'medium';
    $('settingShowImages').checked = state.settings.showImages !== false; // default to true
    openModal('modalSettings');
  });

  ['settingRssHubUrl', 'settingTheme', 'settingFontSize'].forEach(id => {
    $(id).addEventListener('change', () => {
      state.settings.rssHubUrl = $('settingRssHubUrl').value;
      state.settings.theme = $('settingTheme').value;
      state.settings.fontSize = $('settingFontSize').value;
      localStorage.setItem('rssToolSettings', JSON.stringify(state.settings));
      applySettings();
    });
  });

  $('settingShowImages').addEventListener('change', () => {
    state.settings.showImages = $('settingShowImages').checked;
    localStorage.setItem('rssToolSettings', JSON.stringify(state.settings));
    applySettings();
    // Re-render articles to apply image setting immediately
    renderArticles();
  });

  // Modal tabs
  $$('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const modal = tab.closest('.modal');
      modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`#tab-${tab.dataset.tab}`)?.classList.add('active');
      const tabLabel = tab.dataset.tab === 'url2rss' ? 'Add Feed' : 'Add Feed';
      $('btnSaveFeed').querySelector('.btn-label').textContent = tabLabel;
    });
  });

  // Suggested feeds
  $$('.suggested-item').forEach(btn => {
    btn.addEventListener('click', () => { $('feedUrl').value = btn.dataset.url; });
  });

  // Save feed
  $('btnSaveFeed').addEventListener('click', handleAddFeed);
  $('feedUrl').addEventListener('keydown', e => { if (e.key === 'Enter') handleAddFeed(); });

  // Save collection
  $('btnSaveCollection').addEventListener('click', handleAddCollection);

  // Color picker
  $$('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      $$('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      state.selectedColor = sw.dataset.color;
    });
  });

  // Close reading pane
  $('closePane').addEventListener('click', () => {
    $('readingPane').classList.remove('open');
    $('readingPane').classList.remove('fullscreen');
  });

  // Expand reading pane
  const expandBtn = $('expandPane');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      $('readingPane').classList.toggle('fullscreen');
    });
  }

  // Star from reading pane
  $('starArticle').addEventListener('click', () => {
    const id = $('starArticle').dataset.artid;
    if (!id) return;
    const wasStarred = state.starred.has(id);
    if (wasStarred) state.starred.delete(id); else state.starred.add(id);
    localStorage.setItem('starred', JSON.stringify([...state.starred]));
    $('starArticle').querySelector('svg').setAttribute('fill', wasStarred ? 'none' : '#f59e0b');
    applyFilters();
    toast(wasStarred ? 'Removed from starred' : 'Added to starred', 'success');
  });

  // Load more
  $('btnLoadMore').addEventListener('click', () => {
    const page = state.filteredArticles.slice(state.offset, state.offset + state.PAGE_SIZE);
    const html = page.map(a => articleCard(a)).join('');
    const grid = $('articlesGrid');
    grid.insertAdjacentHTML('beforeend', html);
    state.offset += page.length;
    const hasMore = state.filteredArticles.length > state.offset;
    $('loadMoreWrapper').style.display = hasMore ? 'block' : 'none';
    // Re-bind new cards
    grid.querySelectorAll(`.article-card[data-idx]`).forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.article-action')) return;
        openArticle(state.filteredArticles[card.dataset.idx]);
      });
      const starBtn = card.querySelector('.star-btn-card');
      if (starBtn) starBtn.addEventListener('click', e => { e.stopPropagation(); toggleStar(card.dataset.artid, card); });
    });
  });

  // Export dropdown toggle
  $('btnExport').addEventListener('click', () => {
    $('exportMenu').classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.export-dropdown')) $('exportMenu').classList.remove('open');
  });

  // Import OPML
  $('btnImportOPML').addEventListener('click', () => openModal('modalImport'));
  const dropZone = $('opmlDropZone');
  dropZone.addEventListener('click', () => $('opmlFile').click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleOPMLFile(e.dataTransfer.files[0]); });
  $('opmlFile').addEventListener('change', e => handleOPMLFile(e.target.files[0]));
  $('btnImportAll').addEventListener('click', handleImportAll);

  // Widget controls update
  ['widgetTheme', 'widgetLayout', 'widgetLimit'].forEach(id => {
    $(id)?.addEventListener('change', updateWidgetPreview);
  });
}

function bindSidebarEvents() {
  // Feed click
  document.querySelectorAll('.feed-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.feed-item-actions')) return;
      const feedId = el.dataset.feedid;
      const feed = state.feeds.find(f => f.id === feedId);
      if (!feed) return;
      $$('.feed-item').forEach(f => f.classList.remove('active'));
      el.classList.add('active');
      setView('feed:' + feedId, feed.name, `${feed.items?.length || 0} articles`);
    });
  });

  // Checkbox selection
  document.querySelectorAll('.feed-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', e => {
      const feedId = e.target.dataset.feedid;
      const feedItem = e.target.closest('.feed-item');
      
      if (e.target.checked) {
        feedItem.dataset.selected = 'true';
        feedItem.setAttribute('data-selected', 'true');
      } else {
        delete feedItem.dataset.selected;
        feedItem.removeAttribute('data-selected');
      }
      
      updateBulkSelectionUI();
    });
  });

  // Bulk selection controls
  $('selectAllBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.feed-checkbox').forEach(checkbox => {
      checkbox.checked = true;
      const feedItem = checkbox.closest('.feed-item');
      feedItem.dataset.selected = 'true';
      feedItem.setAttribute('data-selected', 'true');
    });
    updateBulkSelectionUI();
  });

  $('deselectAllBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.feed-checkbox').forEach(checkbox => {
      checkbox.checked = false;
      const feedItem = checkbox.closest('.feed-item');
      delete feedItem.dataset.selected;
      feedItem.removeAttribute('data-selected');
    });
    updateBulkSelectionUI();
  });

  $('bulkMoveBtn')?.addEventListener('click', () => {
    const selectedFeeds = Array.from(document.querySelectorAll('.feed-checkbox:checked'))
      .map(cb => cb.dataset.feedid);
    
    if (selectedFeeds.length === 0) {
      toast('No feeds selected', 'error');
      return;
    }
    
    openBulkMoveModal(selectedFeeds);
  });

  $('bulkDeleteBtn')?.addEventListener('click', async () => {
    const selectedFeeds = Array.from(document.querySelectorAll('.feed-checkbox:checked'))
      .map(cb => cb.dataset.feedid);
    
    if (selectedFeeds.length === 0) {
      toast('No feeds selected', 'error');
      return;
    }
    
    if (confirm(`Delete ${selectedFeeds.length} selected feeds? This cannot be undone.`)) {
      try {
        for (const feedId of selectedFeeds) {
          await deleteFeed(feedId);
        }
        toast(`Deleted ${selectedFeeds.length} feeds successfully`, 'success');
        hideBulkControls();
      } catch (error) {
        toast('Failed to delete some feeds', 'error');
      }
    }
  });

  // Toggle bulk controls
  $('toggleBulkBtn')?.addEventListener('click', () => {
    const bulkControls = $('bulkControls');
    if (bulkControls.style.display === 'none') {
      showBulkControls();
    } else {
      hideBulkControls();
    }
  });

  // Move feed button
  document.querySelectorAll('.move-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openMoveFeedModal(btn.dataset.feedid); });
  });

  // Feed refresh
  document.querySelectorAll('.refresh-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); refreshFeed(btn.dataset.feedid); });
  });
  // Feed delete
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteUI('feed', btn.dataset.feedid); });
  });
  // Widget btn
  document.querySelectorAll('.widget-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openWidgetModal(btn.dataset.feedid); });
  });

  // Drag and Drop functionality
  let draggedFeedId = null;

  // Feed drag start
  document.querySelectorAll('.feed-item[draggable="true"]').forEach(feed => {
    feed.addEventListener('dragstart', (e) => {
      draggedFeedId = e.target.dataset.feedid;
      e.target.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });

    feed.addEventListener('dragend', (e) => {
      e.target.style.opacity = '';
      draggedFeedId = null;
    });
  });

  // Folder drop zones
  document.querySelectorAll('[data-folder-target]').forEach(dropZone => {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropZone.style.backgroundColor = 'var(--bg-secondary)';
      dropZone.style.border = '2px dashed var(--accent)';
    });

    dropZone.addEventListener('dragleave', (e) => {
      dropZone.style.backgroundColor = '';
      dropZone.style.border = '';
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.style.backgroundColor = '';
      dropZone.style.border = '';
      
      const targetFolderId = dropZone.dataset.folderTarget;
      const targetFolderName = targetFolderId 
        ? state.collections.find(c => c.id === targetFolderId)?.name || 'folder'
        : 'unassigned';
      
      // Check if bulk mode is active and feeds are selected
      const selectedFeeds = Array.from(document.querySelectorAll('.feed-checkbox:checked'))
        .map(cb => cb.dataset.feedid);
      
      if (selectedFeeds.length > 1) {
        // Bulk move - move all selected feeds
        const feedNames = selectedFeeds.map(id => state.feeds.find(f => f.id === id)?.name || id).join(', ');
        $('moveConfirmMessage').textContent = `Move ${selectedFeeds.length} feeds to ${targetFolderName}?`;
        $('moveConfirmTarget').textContent = feedNames;
        openModal('modalMoveFeedConfirm');
        
        // Store bulk move info for confirmation
        state.pendingBulkMove = { feedIds: selectedFeeds, targetFolderId };
      } else if (draggedFeedId) {
        // Single feed move
        const feed = state.feeds.find(f => f.id === draggedFeedId);
        if (!feed) return;
        
        $('moveConfirmMessage').textContent = `Move "${feed.name}" to ${targetFolderName}?`;
        $('moveConfirmTarget').textContent = targetFolderName;
        openModal('modalMoveFeedConfirm');
        
        // Store single move info for confirmation
        state.pendingMove = { feedId: draggedFeedId, targetFolderId };
      }
    });
  });

  // Folder click (Accordion + View)
  document.querySelectorAll('.folder-header').forEach(el => {
    el.addEventListener('click', e => {
      // Don't trigger if clicked on delete button area
      if (e.target.closest('.feed-item-actions')) return;
      
      const grp = el.closest('.folder-group');
      const content = grp.querySelector('.folder-content');
      const icon = el.querySelector('.folder-icon');
      
      // Toggle accordion
      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.fill = 'currentColor';
      } else {
        content.style.display = 'none';
        icon.style.fill = 'none';
      }

      // View Collection
      const colId = grp.dataset.colid;
      const col = state.collections.find(c => c.id === colId);
      if (col) {
        $$('.feed-item, .folder-header').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        setView('collection:' + colId, col.name, 'Collection');
      }
    });
  });
  // Delete collection
  document.querySelectorAll('.delete-col-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteUI('folder', btn.dataset.colid); });
  });
  // Edit collection
  document.querySelectorAll('.edit-col-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openRenameCollection(btn.dataset.colid, btn.dataset.name); });
  });
}

// ── RSSHub Interceptor ─────────────────────────────────────────────────────────
function checkRssHub(url) {
  try {
    const rssHub = (state.settings?.rssHubUrl || 'https://rsshub.app').replace(/\/$/, '');
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    
    // Don't convert X/Twitter URLs - let the backend handle them directly
    // if (host === 'twitter.com' || host === 'x.com') {
    //   const parts = parsed.pathname.split('/').filter(Boolean);
    //   if (parts[0]) return `https://nitter.net/${parts[0]}/rss`;
    // } 
    if (host === 'instagram.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts[0] && parts[0] !== 'p' && parts[0] !== 'reel') {
        return `${rssHub}/instagram/user/${parts[0]}`;
      }
    } else if (host === 'reddit.com') {
      if (!parsed.pathname.endsWith('.rss')) {
        return `${url.replace(/\/$/, '')}/.rss`;
      }
    }
    // Note: YouTube natively supports RSS auto-discovery via <link rel="alternate">, so we map it directly.
  } catch (e) {}
  return url;
}

// ── Feed Actions ──────────────────────────────────────────────────────────────
async function handleAddFeed() {
  const activeTab = document.querySelector('.modal-tab.active')?.dataset.tab;
  const btn = $('btnSaveFeed');
  const errEl = $('addFeedError');
  errEl.textContent = '';
  btn.querySelector('.btn-label').style.display = 'none';
  btn.querySelector('.btn-spinner').style.display = 'inline';
  btn.disabled = true;

  try {
    if (activeTab === 'url2rss') {
      const result = window.state.url2rssResult;
      if (!result) throw new Error('Please generate a feed first');
      const folderId = $('url2rssFolder')?.value;
      let newFeed = null;

      if (result.type === 'rss') {
        const res = await fetch(`${API}/api/feeds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            url: result.rssUrl,  // Use the generated RSS URL for native feeds
            name: $('url2rssName').value.trim() || undefined,
            category: folderId || undefined
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        newFeed = await res.json();
      } else {
        const customName = $('url2rssName').value.trim();
        const res = await fetch(`${API}/api/feeds/scraped`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: customName || result.siteTitle,
            siteUrl: result.siteUrl,
            siteDescription: result.siteDescription,
            items: result.items,
            favicon: result.favicon,
            siteImage: result.siteImage,
            category: folderId || undefined
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        newFeed = await res.json();
      }
      
      if (newFeed && newFeed.id && folderId) {
        await addFeedToCollection(newFeed.id, folderId);
      }
    } else {
      let url = $('feedUrl').value.trim();
      if (!url) throw new Error('Please enter a feed URL');
      url = checkRssHub(url);
      const folderId = $('feedFolder')?.value;
      const res = await fetch(`${API}/api/feeds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: url, 
          name: $('feedName').value.trim() || undefined,
          category: folderId || undefined
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const newFeed = await res.json();
      
      if (newFeed && newFeed.id && folderId) {
        await addFeedToCollection(newFeed.id, folderId);
      }
    }

    closeModal('modalAddFeed');
    resetAddFeedModal();
    toast('Feed added successfully!', 'success');
    await loadFeeds();
    renderSidebar();
    if (state.currentView === 'all' || state.currentView === 'starred') await loadArticles();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.querySelector('.btn-label').style.display = '';
    btn.querySelector('.btn-spinner').style.display = 'none';
    btn.disabled = false;
  }
}

async function addFeedToCollection(feedId, colId) {
  const col = state.collections.find(c => c.id === colId);
  if (!col) return;
  const feedIds = Array.from(new Set([...(col.feedIds || []), feedId]));
  await fetch(`${API}/api/collections/${colId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedIds })
  });
}

function resetAddFeedModal() {
  $('feedUrl').value = '';
  $('feedName').value = '';
  $('feedFolder') && ($('feedFolder').value = '');
  $('url2rssFolder') && ($('url2rssFolder').value = '');
  $('url2rssInput') && ($('url2rssInput').value = '');
  $('url2rssResult') && ($('url2rssResult').style.display = 'none');
  $('url2rssNameGroup') && ($('url2rssNameGroup').style.display = 'none');
  $('addFeedError').textContent = '';
  window.state.url2rssResult = null;
}

async function handleUrl2rss() {
  let url = $('url2rssInput').value.trim();
  if (!url) return;
  url = checkRssHub(url);
  
  const btn = $('btnUrl2rssGo');
  const errEl = $('addFeedError');
  errEl.textContent = '';
  btn.textContent = 'Analyzing…';
  btn.disabled = true;
  $('url2rssResult').style.display = 'none';
  $('url2rssNameGroup').style.display = 'none';

  try {
    const res = await fetch(`${API}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    window.state.url2rssResult = data;

    // Check for error response from backend (structured error for Twitter/X)
    if (data.error) {
      // Show error in result area with helpful info
      $('url2rssResultFavicon').src = data.favicon || `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
      $('url2rssResultTitle').textContent = data.siteTitle || url;
      $('url2rssResultMeta').innerHTML = `<span class="url2rss-rss-badge" style="background:#7f1d1d;border-color:#ef4444;color:#fca5a5">✕ Error</span> <span>${esc(data.error)}</span>`;
      $('url2rssResultItems').innerHTML = `<div class="scrape-preview-item" style="color:var(--text-muted);font-style:italic">${esc(data.siteDescription || 'Unable to fetch feed')}</div>`;
      $('url2rssResult').style.display = 'block';
      toast(data.error, 'error');
      return;
    }

    // Populate result UI
    $('url2rssResultFavicon').src = data.favicon || `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
    
    // Use correct title source: siteTitle for scraped, feedData.title for RSS
    const displayTitle = data.type === 'rss' 
      ? (data.feedData?.title || data.siteTitle || url)
      : (data.siteTitle || url);
    $('url2rssResultTitle').textContent = displayTitle;

    if (data.type === 'rss') {
      // Found a native RSS feed
      const count = data.feedData?.items?.length || 0;
      $('url2rssResultMeta').innerHTML = `<span class="url2rss-rss-badge">✓ Native RSS</span> <span>${esc(data.rssUrl)}</span>`;
      $('url2rssResultItems').innerHTML = (data.feedData?.items || []).slice(0, 5).map(i =>
        `<div class="scrape-preview-item">📄 ${esc(i.title)}</div>`
      ).join('');
      toast('Found a native RSS feed!', 'success');
      if (!count) toast('No articles found — try a different URL', 'error');
    } else {
      // Generated feed from scraping
      const count = data.items?.length || 0;
      $('url2rssResultMeta').innerHTML = `<span class="url2rss-rss-badge" style="background:#1e3a5f;border-color:#4F8EF7;color:#93c5fd">⚡ Generated</span> <span>${count} articles found</span>`;
      $('url2rssResultItems').innerHTML = (data.items || []).slice(0, 6).map(i =>
        `<div class="scrape-preview-item">📄 ${esc(i.title)}</div>`
      ).join('');
      if (!count) toast('No articles found — try a different URL', 'error');
      else toast(`Generated feed with ${count} articles`, 'success');
    }

    $('url2rssResult').style.display = 'block';
    $('url2rssNameGroup').style.display = 'block';
    // Use same logic for name field
    const nameValue = data.type === 'rss' 
      ? (data.feedData?.title || data.siteTitle || '')
      : (data.siteTitle || '');
    $('url2rssName').value = nameValue;
  } catch (err) {
    errEl.textContent = err.message;
    toast(err.message, 'error');
  } finally {
    btn.textContent = 'Generate Feed';
    btn.disabled = false;
  }
}

async function handleScrapePreview() {
  // Kept as stub for compatibility — url2rss tab handles this now
  toast('Use the "Any URL → Feed" tab for smart detection!', 'info');
}

async function refreshFeed(feedId) {
  toast('Refreshing feed…', 'info');
  try {
    await fetch(`${API}/api/feeds/${encodeURIComponent(feedId)}/refresh`, { method: 'POST' });
    await loadFeeds();
    renderSidebar();
    if (state.currentView === 'all' || state.currentView === 'feed:' + feedId) await loadArticles();
    toast('Feed refreshed!', 'success');
  } catch { toast('Refresh failed', 'error'); }
}

async function deleteFeed(feedId) {
  try {
    await fetch(`${API}/api/feeds/${encodeURIComponent(feedId)}`, { method: 'DELETE' });
    await loadFeeds();
    if (state.currentView === 'feed:' + feedId) setView('all', 'All Articles');
    renderSidebar();
    await loadArticles();
    toast('Feed deleted', 'success');
  } catch { toast('Delete failed', 'error'); }
}

async function refreshAll() {
  const btn = $('btnRefreshAll');
  btn.classList.add('spinning');
  toast('Refreshing all feeds…', 'info');
  
  let successCount = 0;
  let failCount = 0;
  
  try {
    const refreshPromises = state.feeds.map(async (f) => {
      try {
        const response = await fetch(`${API}/api/feeds/${encodeURIComponent(f.id)}/refresh`, { method: 'POST' });
        if (response.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
        console.error(`Failed to refresh feed ${f.id}:`, error);
      }
    });
    
    await Promise.allSettled(refreshPromises);
    
    // Reload data
    await loadFeeds();
    renderSidebar();
    await loadArticles();
    
    // Show results
    if (failCount > 0) {
      toast(`Refreshed ${successCount} feeds, ${failCount} failed`, 'warning');
    } else {
      toast(`Successfully refreshed ${successCount} feeds!`, 'success');
    }
  } catch (error) {
    toast('Failed to refresh feeds', 'error');
    console.error('Refresh all error:', error);
  } finally {
    btn.classList.remove('spinning');
  }
}

function toggleStar(id, card) {
  if (!id) return;
  const wasStarred = state.starred.has(id);
  if (wasStarred) state.starred.delete(id); else state.starred.add(id);
  localStorage.setItem('starred', JSON.stringify([...state.starred]));
  if (card) {
    card.classList.toggle('starred', !wasStarred);
    const svg = card.querySelector('.star-btn-card svg');
    if (svg) svg.setAttribute('fill', wasStarred ? 'none' : '#f59e0b');
  }
  applyFilters();
}

// ── Collections ───────────────────────────────────────────────────────────────
function openAddCollection() {
  // Populate feed checkboxes
  $('feedCheckboxes').innerHTML = state.feeds.map(f => `
    <div class="feed-checkbox-item">
      <input type="checkbox" id="cbf_${f.id}" value="${f.id}">
      <label for="cbf_${f.id}">${esc(f.name)}</label>
    </div>
  `).join('') || '<div style="color:var(--text-muted);font-size:12px">No feeds yet. Add some first.</div>';
  openModal('modalAddCollection');
}

async function handleAddCollection() {
  const name = $('collectionName').value.trim();
  if (!name) return toast('Please enter a name', 'error');
  const feedIds = [...$$('#feedCheckboxes input:checked')].map(cb => cb.value);
  try {
    await fetch(`${API}/api/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, feedIds, color: state.selectedColor })
    });
    closeModal('modalAddCollection');
    $('collectionName').value = '';
    await loadCollections();
    renderSidebar();
    toast('Collection created!', 'success');
  } catch { toast('Failed to create collection', 'error'); }
}

async function deleteCollection(colId) {
  try {
    await fetch(`${API}/api/collections/${colId}`, { method: 'DELETE' });
    await loadCollections();
    if (state.currentView === 'collection:' + colId) setView('all', 'All Articles');
    renderSidebar();
    toast('Collection deleted', 'success');
  } catch { toast('Delete failed', 'error'); }
}

// ── Modals: Confirm & Rename ───────────────────────────────────────────────────
function confirmDeleteUI(type, id) {
  state.confirmAction = { type, id };
  $('confirmDeleteMessage').textContent = `Are you sure you want to delete this ${type}?`;
  openModal('modalConfirmDelete');
}

$('btnConfirmDelete')?.addEventListener('click', async () => {
  if (!state.confirmAction) return;
  const { type, id } = state.confirmAction;
  $('btnConfirmDelete').disabled = true;
  if (type === 'feed') await deleteFeed(id);
  else if (type === 'folder') await deleteCollection(id);
  $('btnConfirmDelete').disabled = false;
  closeModal('modalConfirmDelete');
});

function openRenameCollection(colId, currentName) {
  state.renameColId = colId;
  $('renameCollectionInput').value = currentName;
  openModal('modalRenameCollection');
}

$('btnRenameCollectionSave')?.addEventListener('click', async () => {
  const colId = state.renameColId;
  const newName = $('renameCollectionInput').value.trim();
  if (!newName) return toast('Name cannot be empty', 'error');
  $('btnRenameCollectionSave').disabled = true;
  try {
    const res = await fetch(`${API}/api/collections/${colId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    if (!res.ok) throw new Error('Rename failed');
    await loadCollections();
    renderSidebar();
    closeModal('modalRenameCollection');
    toast('Folder renamed', 'success');
  } catch (err) {
    toast('Rename failed', 'error');
  } finally {
    $('btnRenameCollectionSave').disabled = false;
  }
});

// ── Widget Modal ──────────────────────────────────────────────────────────────
function openWidgetModal(feedId) {
  state.widgetFeedId = feedId;
  updateWidgetPreview();
  openModal('modalWidget');
}

function updateWidgetPreview() {
  const feedId = state.widgetFeedId;
  if (!feedId) return;
  const theme = $('widgetTheme')?.value || 'dark';
  const layout = $('widgetLayout')?.value || 'list';
  const limit = $('widgetLimit')?.value || 10;
  const src = `${window.location.origin}/widget/${feedId}?theme=${theme}&layout=${layout}&limit=${limit}`;
  $('widgetPreviewFrame').src = src;
  const code = `<iframe src="${src}" width="100%" height="400" frameborder="0" style="border-radius:8px"></iframe>`;
  $('widgetCode').textContent = code;
  $('btnCopyWidget').onclick = () => { navigator.clipboard.writeText(code); toast('Copied!', 'success'); };
}

// ── OPML Import ────────────────────────────────────────────────────────────────
async function handleOPMLFile(file) {
  if (!file) return;
  const text = await file.text();
  const res = await fetch(`${API}/api/import/opml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opmlContent: text })
  });
  const data = await res.json();
  $('importCount').textContent = `Found ${data.found} feeds`;
  $('importUrlList').innerHTML = (data.urls || []).map(u => `<div class="import-url-item">${esc(u)}</div>`).join('');
  $('importResults').style.display = 'block';
  $('opmlDropZone').style.display = 'none';
  $('btnImportAll').style.display = 'block';
  $('btnImportAll').dataset.urls = JSON.stringify(data.urls);
}

async function handleImportAll() {
  const urls = JSON.parse($('btnImportAll').dataset.urls || '[]');
  if (!urls.length) return;
  $('btnImportAll').textContent = 'Importing…';
  $('btnImportAll').disabled = true;
  let success = 0;
  for (const url of urls) {
    try {
      await fetch(`${API}/api/feeds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      success++;
    } catch {}
  }
  closeModal('modalImport');
  await loadFeeds();
  renderSidebar();
  await loadArticles();
  toast(`Imported ${success}/${urls.length} feeds`, 'success');
  $('opmlDropZone').style.display = 'block';
  $('importResults').style.display = 'none';
  $('btnImportAll').style.display = 'none';
  $('btnImportAll').textContent = 'Import All';
  $('btnImportAll').disabled = false;
}

// ── Modals ─────────────────────────────────────────────────────────────────────
// ── Global Modal Logic ─────────────────────────────────────────────────────────
function populateFolderSelects() {
  const options = '<option value="">-- None --</option>' + 
    state.collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if ($('feedFolder')) $('feedFolder').innerHTML = options;
  if ($('url2rssFolder')) $('url2rssFolder').innerHTML = options;
}

function openModal(id) { 
  if (id === 'modalAddFeed') populateFolderSelects();
  
  // Close any existing open modals first
  document.querySelectorAll('.modal-overlay.open').forEach(modal => {
    modal.classList.remove('open');
  });
  
  $(id)?.classList.add('open'); 
  document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closeModal(id) { 
  $(id)?.classList.remove('open');
  document.body.style.overflow = ''; // Restore scrolling
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function stripHtml(s) { return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function extractFirstImage(html) {
  if (!html) return null;
  
  // Try to find the first valid image in the HTML content
  const imgMatch = html.match(/<img[^>]+src\s*=\s*['"]([^'"]+)['"][^>]*>/i);
  if (imgMatch && imgMatch[1]) {
    const src = imgMatch[1];
    // Filter out common placeholder/bad images
    if (!src.includes('placeholder') && !src.includes('spacer') && !src.includes('1x1')) {
      return src;
    }
  }
  
  // Try to find Open Graph image if available
  const ogImgMatch = html.match(/<meta[^>]+property\s*=\s*['"]og:image['"][^>]+content\s*=\s*['"]([^'"]+)['"][^>]*>/i);
  if (ogImgMatch && ogImgMatch[1]) {
    return ogImgMatch[1];
  }
  
  return null;
}
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
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || '•'}</span> ${esc(message)}`;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Run ───────────────────────────────────────────────────────────────────────
function openExternal(btn) {
  const url = btn.dataset.url;
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Settings ─────────────────────────────────────────────────────────────────
function applySettings() {
  document.documentElement.setAttribute('data-theme', state.settings.theme === 'system' 
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : state.settings.theme);
  
  document.documentElement.setAttribute('data-font', state.settings.fontSize);
}

// System theme listener
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (state.settings.theme === 'system') applySettings();
});

// ── Move Feed & Bulk Selection Helpers ─────────────────────────────────────────
function updateBulkSelectionUI() {
  const selectedCount = document.querySelectorAll('.feed-checkbox:checked').length;
  const bulkControls = $('bulkControls');
  const selectedCountEl = $('selectedCount');
  
  if (selectedCountEl) {
    selectedCountEl.textContent = selectedCount;
  }
  
  if (bulkControls) {
    if (selectedCount > 0) {
      bulkControls.style.display = 'flex';
    } else {
      bulkControls.style.display = 'none';
    }
  }
}

function showBulkControls() {
  const bulkControls = $('bulkControls');
  if (bulkControls) {
    bulkControls.style.display = 'flex';
  }
}

function hideBulkControls() {
  const bulkControls = $('bulkControls');
  if (bulkControls) {
    bulkControls.style.display = 'none';
  }
}

function openMoveFeedModal(feedId) {
  state.moveFeedId = feedId;
  const feed = state.feeds.find(f => f.id === feedId);
  if (!feed) return;
  
  // Populate folder select
  const folderSelect = $('moveFeedFolder');
  if (folderSelect) {
    folderSelect.innerHTML = '<option value="">-- Unassigned --</option>' + 
      state.collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    
    // Pre-select current folder if feed is in one
    const currentCol = state.collections.find(c => (c.feedIds || []).includes(feedId));
    if (currentCol) {
      folderSelect.value = currentCol.id;
    }
  }
  
  $('moveFeedMessage').textContent = `Move "${feed.name}" to:`;
  openModal('modalMoveFeed');
}

function openBulkMoveModal(feedIds) {
  state.bulkMoveFeedIds = feedIds;
  const feeds = state.feeds.filter(f => feedIds.includes(f.id));
  
  // Populate folder select
  const folderSelect = $('moveFeedFolder');
  if (folderSelect) {
    folderSelect.innerHTML = '<option value="">-- Unassigned --</option>' + 
      state.collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }
  
  $('moveFeedMessage').textContent = `Move ${feedIds.length} selected feeds to:`;
  openModal('modalMoveFeed');
}

async function moveFeedToFolder(feedId, targetFolderId) {
  const feed = state.feeds.find(f => f.id === feedId);
  if (!feed) throw new Error('Feed not found');
  
  // Find current collection
  const currentCol = state.collections.find(c => (c.feedIds || []).includes(feedId));
  const currentColId = currentCol?.id;
  
  // If moving to same folder, do nothing
  if (currentColId === targetFolderId) {
    toast('Feed is already in this folder', 'info');
    return;
  }
  
  // Remove from current collection
  if (currentCol) {
    const updatedFeedIds = (currentCol.feedIds || []).filter(id => id !== feedId);
    await fetch(`${API}/api/collections/${currentCol.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedIds: updatedFeedIds })
    });
  }
  
  // Add to new collection if target is not empty (unassigned)
  if (targetFolderId) {
    const targetCol = state.collections.find(c => c.id === targetFolderId);
    if (targetCol) {
      const updatedFeedIds = [...new Set([...(targetCol.feedIds || []), feedId])];
      await fetch(`${API}/api/collections/${targetFolderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedIds: updatedFeedIds })
      });
    }
  }
  
  // Reload data
  await loadCollections();
  await loadFeeds();
  renderSidebar();
  toast('Feed moved successfully', 'success');
}

// Event listeners for move modals
$('btnMoveFeedSave')?.addEventListener('click', async () => {
  const targetFolderId = $('moveFeedFolder').value;
  
  $('btnMoveFeedSave').disabled = true;
  try {
    if (state.bulkMoveFeedIds) {
      // Bulk move
      for (const feedId of state.bulkMoveFeedIds) {
        await moveFeedToFolder(feedId, targetFolderId);
      }
      toast(`Moved ${state.bulkMoveFeedIds.length} feeds successfully`, 'success');
      hideBulkControls();
      state.bulkMoveFeedIds = null;
    } else {
      // Single move
      const feedId = state.moveFeedId;
      if (!feedId) return;
      await moveFeedToFolder(feedId, targetFolderId);
      toast('Feed moved successfully', 'success');
    }
    closeModal('modalMoveFeed');
  } catch (err) {
    toast('Move failed', 'error');
  } finally {
    $('btnMoveFeedSave').disabled = false;
  }
});

$('btnMoveConfirm')?.addEventListener('click', async () => {
  $('btnMoveConfirm').disabled = true;
  try {
    if (state.pendingBulkMove) {
      // Handle bulk move
      const { feedIds, targetFolderId } = state.pendingBulkMove;
      for (const feedId of feedIds) {
        await moveFeedToFolder(feedId, targetFolderId);
      }
      toast(`Moved ${feedIds.length} feeds successfully`, 'success');
      hideBulkControls();
      state.pendingBulkMove = null;
    } else if (state.pendingMove) {
      // Handle single move
      await moveFeedToFolder(state.pendingMove.feedId, state.pendingMove.targetFolderId);
      toast('Feed moved successfully', 'success');
      state.pendingMove = null;
    }
    closeModal('modalMoveFeedConfirm');
  } catch (err) {
    toast('Move failed', 'error');
  } finally {
    $('btnMoveConfirm').disabled = false;
  }
});

init();
