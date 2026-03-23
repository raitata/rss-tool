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
    showImages: true
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
  updateBadges();
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
  } catch { state.articles = []; }
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
  
  if (!state.feeds.length && !state.collections.length) {
    if (feedsList) feedsList.innerHTML = '<div class="empty-hint">No feeds yet.<br/>Click + to add one.</div>';
    if (collectionsList) collectionsList.innerHTML = '';
    return;
  }

  const unassignedFeeds = state.feeds.filter(f => !state.collections.some(c => (c.feedIds || []).includes(f.id)));

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
        ${article.content || article.summary || '<p>No content available.</p>'}
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

async function bulkDelete() {
  if (state.selectedFeeds.size === 0) return;
  
  if (!confirm(`Delete ${state.selectedFeeds.size} selected feeds?`)) return;
  
  let deleted = 0;
  for (const feedId of state.selectedFeeds) {
    try {
      await fetch(`${API}/api/feeds/${encodeURIComponent(feedId)}`, { method: 'DELETE' });
      deleted++;
    } catch {}
  }
  
  state.selectedFeeds.clear();
  toggleBulkMode();
  await loadFeeds();
  renderSidebar();
  await loadArticles();
  toast(`Deleted ${deleted} feeds`, 'success');
}

async function bulkMove() {
  if (state.selectedFeeds.size === 0) return;
  
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
  
  // Bind confirm
  const confirmBtn = $('btnMoveFeedConfirm');
  confirmBtn.onclick = async () => {
    if (selectedTarget === null) {
      toast('Please select a destination', 'error');
      return;
    }
    
    let moved = 0;
    for (const feedId of state.selectedFeeds) {
      try {
        // Remove from current collection if any
        const currentCol = state.collections.find(c => (c.feedIds || []).includes(feedId));
        if (currentCol) {
          const updatedIds = currentCol.feedIds.filter(id => id !== feedId);
          await fetch(`${API}/api/collections/${currentCol.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedIds: updatedIds })
          });
        }
        
        // Add to new collection if selected
        if (selectedTarget) {
          const targetCol = state.collections.find(c => c.id === selectedTarget);
          if (targetCol) {
            const updatedIds = [...(targetCol.feedIds || []), feedId];
            await fetch(`${API}/api/collections/${selectedTarget}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ feedIds: updatedIds })
            });
          }
        }
        moved++;
      } catch {}
    }
    
    closeModal('modalMoveFeed');
    state.selectedFeeds.clear();
    toggleBulkMode();
    await loadCollections();
    await loadFeeds();
    renderSidebar();
    toast(`Moved ${moved} feeds`, 'success');
  };
  
  openModal('modalMoveFeed');
}

// ── URL Scraper ───────────────────────────────────────────────────────────────
async function handleScrape(e) {
  e.preventDefault();
  const urlInput = $('scraperUrlInput');
  const url = urlInput.value.trim();
  if (!url) return;

  const form = $('scraperForm');
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = $('scraperError');
  const resultEl = $('scraperResult');

  btn.innerHTML = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Analyzing...`;
  btn.disabled = true;
  errorEl.style.display = 'none';
  resultEl.style.display = 'none';

  try {
    const res = await fetch(`${API}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || data.detail || 'Failed to analyze URL');

    state.scraperResult = data;

    let resultHtml = `
      <div class="result-header">
        <img src="${data.favicon || `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`}" alt="" class="result-favicon">
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

    resultEl.innerHTML = resultHtml;
    resultEl.style.display = 'block';

    const saveBtn = $('btnSaveScrapedFeed');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => saveScrapedFeed(data));
    }

  } catch (err) {
    errorEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div><span>${esc(err.message)}</span></div></svg>`;
    errorEl.style.display = 'flex';
  } finally {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze URL`;
    btn.disabled = false;
  }
}

async function saveScrapedFeed(data) {
  const btn = $('btnSaveScrapedFeed');
  btn.innerHTML = `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Saving...`;
  btn.disabled = true;

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
    btn.innerHTML = 'Save as Feed';
    btn.disabled = false;
  }
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
      } catch { toast('Failed to create collection', 'error'); }
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
      } catch {
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
      
      let success = 0, failed = 0;
      const promises = state.feeds.map(async (f) => {
        try {
          const res = await fetch(`${API}/api/feeds/${encodeURIComponent(f.id)}/refresh`, { method: 'POST' });
          if (res.ok) success++;
          else failed++;
        } catch {
          failed++;
        }
      });
      
      await Promise.allSettled(promises);
      
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
        } catch {
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

  // Nested feed clicks
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
    
    const checkbox = el.querySelector('.feed-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        toggleFeedSelection(el.dataset.feedid);
      });
    }
  });

  // Collection drag-drop targets
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
        const targetCol = state.collections.find(c => c.id === targetColId);
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
      } catch {
        toast('Move failed', 'error');
      }
    });
  });

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

// ── OPML Import ──────────────────────────────────────────────────────────────
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
        } catch {}
      }
      
      closeModal('modalImport');
      await loadFeeds();
      renderSidebar();
      await loadArticles();
      toast(`Imported ${imported} feeds`, 'success');
    }
  } catch {
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
