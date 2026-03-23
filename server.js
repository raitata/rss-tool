const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const RSS = require('rss');
const fs = require('fs');
const path = require('path');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const app = express();
const PORT = 3500;
const parser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedBot/2.0)' },
  customFields: { item: ['media:content', 'media:thumbnail', 'enclosure', 'content:encoded'] }
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Add cache-control headers to prevent browser caching issues
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static('public', {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ─── Data Persistence ──────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readJSON(file, fallback = {}) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) { fs.writeFileSync(fp, JSON.stringify(fallback)); return fallback; }
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ─── HTTP Helper ───────────────────────────────────────────────────────────────
const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; FeedFetcher/1.0; +http://localhost)',
];

async function fetchHtml(url) {
  let lastErr;
  for (const ua of UA_LIST) {
    try {
      const resp = await axios.get(url, {
        timeout: 12000,
        maxRedirects: 5,
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
        },
        responseType: 'text',
      });
      return resp.data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ─── RSS/JSON Fetch Helper ──────────────────────────────────────────────────────────
const TWITTER_PROXIES = [
  username => `https://nitter.net/${username}/rss`,
  username => `https://nitter.cz/${username}/rss`,
  username => `https://twiiit.com/${username}/rss`,
  username => `https://nitter.lucabased.xyz/${username}/rss`,
  username => `https://xcancel.com/${username}/rss`,
  username => `https://bird.makeup/users/${username}/rss`,
  username => `https://rsshub.app/twitter/user/${username}`,
  username => `https://nitter.privacydev.net/${username}/rss`,
  username => `https://nitter.snopyta.org/${username}/rss`,
  username => `https://nitter.42l.fr/${username}/rss`,
  username => `https://t.comf.st/${username}/rss`
];

// ─── Nitter HTML Scraping Fallback ───────────────────────────────────────────
async function scrapeTwitterViaNitterHtml(username) {
  const nitterInstances = [
    `https://nitter.net/${username}`,
    `https://xcancel.com/${username}`,
    `https://nitter.cz/${username}`,
    `https://nitter.privacydev.net/${username}`,
    `https://nitter.snopyta.org/${username}`,
    `https://nitter.42l.fr/${username}`,
  ];
  
  for (const nitterUrl of nitterInstances) {
    try {
      const html = await fetchHtml(nitterUrl);
      
      // Check for verification/challenge pages
      if (html.includes('Verifying') || html.includes('challenge') || html.length < 1000) {
        continue;
      }
      
      const $ = cheerio.load(html);
      
      // Extract profile info
      const profileName = $('.profile-card-fullname, .fullname').first().text().trim();
      const displayName = profileName || username;
      
      const bio = $('.profile-bio, .bio').first().text().trim();
      
      let avatarUrl = $('.profile-card-avatar img, .avatar img').first().attr('src');
      if (avatarUrl && !avatarUrl.startsWith('http')) {
        avatarUrl = `https://nitter.net${avatarUrl}`;
      }
      
      // Extract tweets
      const items = [];
      const tweets = $('.timeline-item, .tweet-body, .timeline-Tweet');
      
      tweets.each((i, el) => {
        try {
          const $tweet = $(el);
          
          // Get tweet link
          const linkEl = $tweet.find('.tweet-link, a[href*="/status/"]').first();
          let tweetLink = linkEl.attr('href') || '';
          if (tweetLink && !tweetLink.startsWith('http')) {
            tweetLink = `https://x.com${tweetLink.replace('/i/web', '')}`;
          }
          
          // Get tweet content
          const contentEl = $tweet.find('.tweet-content, .tweet-text').first();
          const content = contentEl.text().trim();
          
          // Get timestamp
          const timeEl = $tweet.find('.tweet-date a, time').first();
          const timestamp = timeEl.attr('title') || timeEl.attr('datetime') || new Date().toISOString();
          
          // Get images
          const imgEl = $tweet.find('.still-image img, .attachment-image img, img[src*="pic"]').first();
          let image = imgEl.attr('src') || null;
          if (image && !image.startsWith('http')) {
            image = `https://nitter.net${image}`;
          }
          
          if (content) {
            items.push({
              id: tweetLink || uuidv4(),
              title: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
              link: tweetLink || `https://x.com/${username}`,
              content: content,
              fullContent: content,
              author: `@${username}`,
              date: timestamp,
              image: image,
            });
          }
        } catch (e) {
          // Skip problematic tweets
        }
      });
      
      if (items.length > 0) {
        console.log(`Nitter HTML scrape success: ${nitterUrl} with ${items.length} tweets`);
        return {
          title: `${displayName} (@${username})`,
          description: bio,
          link: `https://x.com/${username}`,
          image: avatarUrl || `https://unavatar.io/twitter/${username}`,
          items: items,
        };
      }
    } catch (e) {
      console.warn(`Nitter HTML scrape failed for ${nitterUrl}: ${e.message}`);
      continue;
    }
  }
  
  return null;
}

// ─── Direct Twitter Syndication API Fallback ─────────────────────────────────
async function scrapeTwitterDirectly(username) {
  try {
    // Try Twitter's syndication API (used for embeds, doesn't require auth)
    const syndicationUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`;
    
    const html = await fetchHtml(syndicationUrl);
    const $ = cheerio.load(html);
    
    // Extract tweets from the timeline
    const items = [];
    const tweetElements = $('[data-tweet-id], .timeline-Tweet, .Tweet, article');
    
    tweetElements.each((i, el) => {
      try {
        const $tweet = $(el);
        
        // Get tweet ID
        const tweetId = $tweet.attr('data-tweet-id') || '';
        
        // Get tweet text
        const textEl = $tweet.find('.timeline-Tweet-text, .Tweet-text, .tweet-text, p').first();
        const text = textEl.text().trim();
        
        // Get timestamp
        const timeEl = $tweet.find('time, .dt-updated, [datetime]').first();
        const timestamp = timeEl.attr('datetime') || new Date().toISOString();
        
        // Get images
        const imgEl = $tweet.find('img[src*="pbs.twimg.com"], img[src*="media"]').first();
        const image = imgEl.attr('src') || null;
        
        // Build link
        const link = tweetId ? `https://x.com/${username}/status/${tweetId}` : `https://x.com/${username}`;
        
        if (text) {
          items.push({
            id: tweetId || uuidv4(),
            title: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
            link: link,
            content: text,
            fullContent: text,
            author: `@${username}`,
            date: timestamp,
            image: image,
          });
        }
      } catch (e) {
        // Skip problematic tweets
      }
    });
    
    if (items.length > 0) {
      console.log(`Direct Twitter scrape success for @${username} with ${items.length} tweets`);
      return {
        title: `@${username} on X`,
        description: `Posts from @${username} on X (Twitter)`,
        link: `https://x.com/${username}`,
        image: `https://unavatar.io/twitter/${username}`,
        items: items,
      };
    }
    
    return null;
  } catch (e) {
    console.warn(`Direct Twitter scrape failed: ${e.message}`);
    return null;
  }
}

async function fetchFeed(url) {
  let parserErr;
  
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    if (host === 'twitter.com' || host === 'x.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const username = parts[0];
      if (username) {
        for (const proxy of TWITTER_PROXIES) {
          try {
            const proxylink = proxy(username);
            const feed = await parser.parseURL(proxylink);
            return mapParserResult(feed, proxylink);
          } catch (e) {
            parserErr = e;
          }
        }
        throw new Error('All Twitter proxy instances failed. Try updating proxy list.');
      }
    }
  } catch (e) {
    if (e.message.includes('All Twitter proxy')) throw e;
  }

  try {
    // 1. Try standard XML RSS/Atom parsing
    const feed = await parser.parseURL(url);
    return mapParserResult(feed, url);
  } catch (err) {
    parserErr = err;
  }

  // 2. Fallback to try parsing as JSON Feed
  try {
    const resp = await axios.get(url, { headers: { 'User-Agent': UA_LIST[0] }, timeout: 8000 });
    const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    if (data && typeof data === 'object' && data.version && data.version.includes('jsonfeed')) {
      return mapJsonFeedResult(data, url);
    }
  } catch (e) {
    // Ignore JSON fetch errors and throw the original parser error
  }

  throw parserErr;
}

function mapParserResult(feed, url) {
  return {
    title: feed.title || url,
    description: feed.description || '',
    link: feed.link || url,
    image: feed.image?.url || null,
    items: (feed.items || []).slice(0, 100).map(item => ({
      id: item.guid || item.link || uuidv4(),
      title: item.title || 'Untitled',
      link: item.link || '',
      content: item.contentSnippet || item.content || '',
      fullContent: item['content:encoded'] || item.content || '',
      author: item.creator || item.author || '',
      date: item.isoDate || item.pubDate || new Date().toISOString(),
      image: item['media:content']?.['$']?.url
        || item['media:thumbnail']?.['$']?.url
        || item.enclosure?.url
        || extractFirstImage(item['content:encoded'] || item.content || '')
    }))
  };
}

function mapJsonFeedResult(feed, url) {
  return {
    title: feed.title || url,
    description: feed.description || '',
    link: feed.home_page_url || feed.feed_url || url,
    image: feed.icon || feed.favicon || null,
    items: (feed.items || []).slice(0, 100).map(item => ({
      id: item.id || item.url || uuidv4(),
      title: item.title || 'Untitled',
      link: item.url || '',
      content: item.summary || item.content_text || item.content_html || '',
      fullContent: item.content_html || item.content_text || '',
      author: item.author?.name || feed.author?.name || feed.authors?.[0]?.name || '',
      date: item.date_published || item.date_modified || new Date().toISOString(),
      image: item.image || item.banner_image || extractFirstImage(item.content_html || item.content_text || '')
    }))
  };
}

function extractFirstImage(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const src = $('img').first().attr('src');
  return src || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SMART SCRAPER ENGINE — turns ANY URL into an RSS feed
// ═══════════════════════════════════════════════════════════════════════════════
async function smartScrape(url) {
  const baseUrl = new URL(url);
  const host = baseUrl.hostname.replace('www.', '');
  
  // ── 0. Handle Twitter/X URLs directly ───────────────────────────────────
  if (host === 'twitter.com' || host === 'x.com') {
    const parts = baseUrl.pathname.split('/').filter(Boolean);
    const username = parts[0];
    if (username && !['i', 'search', 'explore', 'home', 'notifications', 'messages', 'settings'].includes(username.toLowerCase())) {
      let lastError = null;
      
      // Tier 1: Try RSS proxies
      for (const proxy of TWITTER_PROXIES) {
        try {
          const proxylink = proxy(username);
          const feedData = await fetchFeed(proxylink);
          return { type: 'rss', rssUrl: proxylink, feedData, allRssLinks: [{ href: proxylink, title: `${username}'s Twitter Feed` }] };
        } catch (e) {
          lastError = e;
          console.log(`Twitter proxy failed: ${e.message}`);
          // Try next proxy
        }
      }
      
      // Tier 2: Try Nitter HTML scraping
      console.log(`All RSS proxies failed for @${username}, trying Nitter HTML scraping...`);
      const nitterResult = await scrapeTwitterViaNitterHtml(username);
      if (nitterResult && nitterResult.items && nitterResult.items.length > 0) {
        console.log(`Nitter HTML scrape success for @${username} with ${nitterResult.items.length} tweets`);
        return { 
          type: 'rss', 
          rssUrl: `https://x.com/${username}`, 
          feedData: nitterResult, 
          allRssLinks: [{ href: `https://x.com/${username}`, title: `@${username} on X` }] 
        };
      }
      
      // Tier 3: Try direct Twitter syndication API
      console.log(`Nitter HTML scraping failed for @${username}, trying direct Twitter scrape...`);
      const directResult = await scrapeTwitterDirectly(username);
      if (directResult && directResult.items && directResult.items.length > 0) {
        console.log(`Direct Twitter scrape success for @${username} with ${directResult.items.length} tweets`);
        return { 
          type: 'rss', 
          rssUrl: `https://x.com/${username}`, 
          feedData: directResult, 
          allRssLinks: [{ href: `https://x.com/${username}`, title: `@${username} on X` }] 
        };
      }
      
      // All methods failed - return structured error response with helpful info
      return {
        type: 'scraped',
        siteTitle: `@${username} on X (Unable to fetch)`,
        siteDescription: `Could not fetch @${username}. All methods failed:\n• RSS proxies: Most Nitter instances are down or blocked\n• HTML scraping: Site requires JavaScript or account is private\n• Direct scrape: Twitter syndication API blocked\n\nTry using a direct Nitter URL like https://nitter.net/${username}/rss`,
        siteUrl: url,
        siteImage: `https://unavatar.io/twitter/${username}`,
        siteName: 'X (Twitter)',
        favicon: 'https://abs.twimg.com/favicons/twitter.3.ico',
        items: [],
        itemCount: 0,
        error: lastError?.message || 'All Twitter proxy instances failed'
      };
    }
  }
  
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // ── 1. Check for native RSS/Atom link in <head> ────────────────────────────
  const rssLinks = [];
  $('link[type="application/rss+xml"], link[type="application/atom+xml"], link[type="application/feed+json"]').each((i, el) => {
    let href = $(el).attr('href') || '';
    if (!href) return;
    if (!href.startsWith('http')) href = new URL(href, baseUrl.origin).href;
    rssLinks.push({ href, title: $(el).attr('title') || 'RSS Feed' });
  });

  // ── 2. Guess common RSS paths if nothing found yet ─────────────────────────
  if (!rssLinks.length) {
    const guesses = [
      '/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/feed/atom',
      '/blog/feed', '/blog/rss.xml', '/index.xml', '/feeds/posts/default',
      `/${baseUrl.hostname.replace('www.', '')}/feed`,
    ];
    for (const g of guesses) {
      try {
        const guessUrl = new URL(g, baseUrl.origin).href;
        await parser.parseURL(guessUrl);   // will throw if not a valid feed
        rssLinks.push({ href: guessUrl, title: 'RSS Feed' });
        break;
      } catch {}
    }
  }

  if (rssLinks.length) {
    // Validate the best candidate
    try {
      const feedData = await fetchFeed(rssLinks[0].href);
      return { type: 'rss', rssUrl: rssLinks[0].href, feedData, allRssLinks: rssLinks };
    } catch {}
  }

  // ── 3. Extract JSON-LD structured data ────────────────────────────────────
  const jsonLdItems = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      items.forEach(d => {
        const graph = d['@graph'] || [d];
        graph.forEach(node => {
          if (['Article', 'NewsArticle', 'BlogPosting', 'WebPage'].includes(node['@type'])) {
            jsonLdItems.push(node);
          }
        });
      });
    } catch {}
  });

  // ── 4. Extract Open Graph / meta data for page-level info ──────────────────
  const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const ogDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
  const ogImage = $('meta[property="og:image"]').attr('content') || '';
  const ogSite = $('meta[property="og:site_name"]').attr('content') || baseUrl.hostname;

  // ── 5. Article extraction strategies ──────────────────────────────────────
  const articles = [];
  const seen = new Set();

  function absUrl(href) {
    if (!href) return null;
    try { return href.startsWith('http') ? href : new URL(href, baseUrl.origin).href; } catch { return null; }
  }

  function absImg(src) {
    if (!src) return null;
    // Skip base64, tracking pixels, tiny icons
    if (src.startsWith('data:') || src.includes('1x1') || src.includes('pixel') || src.includes('tracking')) return null;
    try { return src.startsWith('http') ? src : new URL(src, baseUrl.origin).href; } catch { return null; }
  }

  function parseDate(el, $el) {
    const candidates = [
      $el.find('time').attr('datetime'),
      $el.find('[class*="date"], [class*="time"], [class*="published"], [class*="posted"]').first().attr('datetime'),
      $el.find('[class*="date"], [class*="time"], [class*="published"], [class*="posted"]').first().text().trim(),
      $el.find('time').first().text().trim(),
    ].filter(Boolean);
    for (const c of candidates) {
      const d = new Date(c);
      if (!isNaN(d)) return d.toISOString();
    }
    return new Date().toISOString();
  }

  function addArticle(title, link, image, content, date, author) {
    if (!title || !link) return;
    const absLink = absUrl(link);
    if (!absLink || seen.has(absLink)) return;
    // Skip same-page anchors
    if (absLink === url || absLink === url + '/') return;
    // Only keep links on same domain or absolute
    seen.add(absLink);
    articles.push({
      id: absLink,
      title: title.trim().slice(0, 200),
      link: absLink,
      image: absImg(image),
      content: (content || '').slice(0, 500),
      fullContent: content || '',
      author: author || '',
      date: date || new Date().toISOString(),
    });
  }

  // Strategy A: Use JSON-LD structured data (most reliable)
  jsonLdItems.forEach(node => {
    addArticle(
      node.headline || node.name,
      node.url || node.mainEntityOfPage?.['@id'],
      node.image?.url || node.image,
      node.description || node.articleBody?.slice(0, 500),
      node.datePublished,
      node.author?.name
    );
  });

  // Strategy B: <article> elements
  if (articles.length < 5) {
    $('article, [role="article"]').each((i, el) => {
      if (i >= 40) return false;
      const $el = $(el);
      const title = $el.find('h1,h2,h3').first().text().trim();
      const link = $el.find('a[href]').first().attr('href');
      const img = $el.find('img[src]').not('[src*="avatar"], [src*="icon"], [src*="logo"]').first().attr('src')
        || $el.find('[style*="background-image"]').first().css?.('background-image')?.match(/url\(['"](.*?)['"]\)/)?.[1];
      const desc = $el.find('p').first().text().trim();
      const date = parseDate(el, $el);
      const author = $el.find('[class*="author"], [rel="author"]').first().text().trim();
      addArticle(title, link, img, desc, date, author);
    });
  }

  // Strategy C: hentry / h-entry microformat
  if (articles.length < 5) {
    $('.hentry, .h-entry, .post, .entry, .blog-post, .post-entry, article').each((i, el) => {
      if (i >= 40) return false;
      const $el = $(el);
      const title = $el.find('.entry-title, .post-title, h2, h3, h1').first().text().trim();
      const link = $el.find('.entry-title a, .post-title a, h2 a, h3 a, h1 a').first().attr('href')
        || $el.find('a[href]').first().attr('href');
      const img = $el.find('img').not('[src*="avatar"]').first().attr('src');
      const desc = $el.find('.entry-summary, .excerpt, p').first().text().trim();
      const date = parseDate(el, $el);
      const author = $el.find('.author, .byline, [rel="author"]').first().text().trim();
      addArticle(title, link, img, desc, date, author);
    });
  }

  // Strategy D: Heading + link patterns (lists, indexes)
  if (articles.length < 5) {
    const headingSelectors = [
      'h2 a', 'h3 a', 'h4 a',
      '.title a', '.headline a', '[class*="card"] a', '[class*="item"] > a',
      'li a', '.story a', '.news-item a',
    ];
    for (const sel of headingSelectors) {
      $(sel).each((i, el) => {
        if (i >= 50) return false;
        const $a = $(el);
        const title = $a.text().trim();
        const link = $a.attr('href');
        const $parent = $a.parents('[class], li').first();
        const img = $parent.find('img').not('[src*="icon"],[src*="avatar"]').first().attr('src');
        const desc = $parent.find('p, [class*="desc"], [class*="summary"]').first().text().trim();
        const date = parseDate(null, $parent);
        addArticle(title, link, img, desc, date, '');
      });
      if (articles.length >= 10) break;
    }
  }

  // Strategy E: Any <a> with decent text that points to same domain (last resort)
  if (articles.length < 3) {
    $('a[href]').each((i, el) => {
      if (articles.length >= 20) return false;
      const $a = $(el);
      const href = $a.attr('href');
      const title = $a.text().trim();
      if (!href || !title || title.length < 15 || title.length > 200) return;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;
      const absLink = absUrl(href);
      if (!absLink) return;
      // Only same-domain deep links
      try {
        const linkUrl = new URL(absLink);
        if (linkUrl.hostname !== baseUrl.hostname) return;
        if (linkUrl.pathname === '/' || linkUrl.pathname === '') return;
      } catch { return; }
      const $parent = $a.parent();
      const img = $parent.find('img').first().attr('src');
      addArticle(title, href, img, '', new Date().toISOString(), '');
    });
  }

  // ── 6. Deduplicate and sort ─────────────────────────────────────────────────
  const sorted = articles
    .filter((a, i, arr) => arr.findIndex(b => b.link === a.link) === i)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 60);

  return {
    type: 'scraped',
    siteTitle: ogTitle || url,
    siteDescription: ogDesc,
    siteUrl: url,
    siteImage: absImg(ogImage),
    siteName: ogSite,
    favicon: `https://www.google.com/s2/favicons?domain=${baseUrl.hostname}&sz=64`,
    items: sorted,
    itemCount: sorted.length,
  };
}

// ── Refresh scraped feed (re-scrape) ──────────────────────────────────────────
async function refreshScrapedFeed(feed) {
  const result = await smartScrape(feed.url);
  return {
    ...feed,
    items: result.items,
    lastFetched: new Date().toISOString(),
    unreadCount: result.items.length,
  };
}

// ─── FEEDS API ────────────────────────────────────────────────────────────────
app.get('/api/feeds', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  res.json(Object.values(feeds));
});

app.post('/api/feeds', async (req, res) => {
  const { url, name, category } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    let feedData;
    let finalUrl = url;
    try {
      feedData = await fetchFeed(url);
    } catch (err) {
      // Auto-discovery fallback for HTML pages pasted directly as RSS
      const smartResult = await smartScrape(url);
      if (smartResult && smartResult.type === 'rss' && smartResult.rssUrl) {
        finalUrl = smartResult.rssUrl;
        feedData = smartResult.feedData || await fetchFeed(finalUrl);
      } else {
        throw err; // Throw original parsing error if no RSS tags found
      }
    }

    const feeds = readJSON('feeds.json', {});
    const id = uuidv4();
    feeds[id] = {
      id, url: finalUrl, type: 'rss',
      name: name || feedData.title,
      description: feedData.description,
      siteUrl: feedData.link,
      favicon: feedData.image || `https://www.google.com/s2/favicons?domain=${new URL(finalUrl).hostname}&sz=64`,
      category: category || 'Uncategorized',
      addedAt: new Date().toISOString(),
      lastFetched: new Date().toISOString(),
      unreadCount: feedData.items.length,
      items: feedData.items,
    };
    writeJSON('feeds.json', feeds);
    res.json(feeds[id]);
  } catch (err) {
    res.status(400).json({ error: `Could not parse feed: ${err.message}` });
  }
});

app.delete('/api/feeds/:id', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  if (!feeds[req.params.id]) return res.status(404).json({ error: 'Feed not found' });
  delete feeds[req.params.id];
  writeJSON('feeds.json', feeds);
  const collections = readJSON('collections.json', {});
  Object.values(collections).forEach(col => { col.feedIds = (col.feedIds || []).filter(fid => fid !== req.params.id); });
  writeJSON('collections.json', collections);
  res.json({ success: true });
});

app.post('/api/feeds/:id/refresh', async (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const feed = feeds[req.params.id];
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  try {
    let updated;
    if (feed.type === 'scraped') {
      updated = await refreshScrapedFeed(feed);
    } else {
      const feedData = await fetchFeed(feed.url);
      updated = { ...feed, items: feedData.items, lastFetched: new Date().toISOString(), unreadCount: feedData.items.length };
    }
    feeds[req.params.id] = updated;
    writeJSON('feeds.json', feeds);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/feeds/:id/articles', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const feed = feeds[req.params.id];
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  res.json(feed.items || []);
});

// ─── COLLECTIONS API ──────────────────────────────────────────────────────────
app.get('/api/collections', (req, res) => res.json(Object.values(readJSON('collections.json', {}))));

app.post('/api/collections', (req, res) => {
  const { name, feedIds = [], color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const collections = readJSON('collections.json', {});
  const id = uuidv4();
  collections[id] = { id, name, feedIds, color: color || '#4F8EF7', createdAt: new Date().toISOString() };
  writeJSON('collections.json', collections);
  res.json(collections[id]);
});

app.put('/api/collections/:id', (req, res) => {
  const collections = readJSON('collections.json', {});
  if (!collections[req.params.id]) return res.status(404).json({ error: 'Not found' });
  collections[req.params.id] = { ...collections[req.params.id], ...req.body };
  writeJSON('collections.json', collections);
  res.json(collections[req.params.id]);
});

app.delete('/api/collections/:id', (req, res) => {
  const collections = readJSON('collections.json', {});
  delete collections[req.params.id];
  writeJSON('collections.json', collections);
  res.json({ success: true });
});

app.get('/api/collections/:id/articles', (req, res) => {
  const col = readJSON('collections.json', {})[req.params.id];
  if (!col) return res.status(404).json({ error: 'Not found' });
  const feeds = readJSON('feeds.json', {});
  const articles = [];
  (col.feedIds || []).forEach(fid => {
    const feed = feeds[fid];
    if (feed?.items) feed.items.forEach(item => articles.push({ ...item, feedName: feed.name, feedId: fid, favicon: feed.favicon }));
  });
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(articles);
});

// ─── SMART SCRAPE API ─────────────────────────────────────────────────────────
// Preview: analyze a URL and return what we found (RSS or scraped articles)
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const result = await smartScrape(url);
    res.json(result);
  } catch (err) {
    // Check if this is a Twitter/X URL to return structured error
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace('www.', '');
      if (host === 'twitter.com' || host === 'x.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        const username = parts[0];
        if (username) {
          return res.status(400).json({
            type: 'scraped',
            siteTitle: `@${username} on X (Unable to fetch)`,
            siteDescription: `Could not fetch @${username}. All Nitter instances failed or are blocked. Try using a direct Nitter URL like https://nitter.net/${username}/rss`,
            siteUrl: url,
            siteImage: `https://unavatar.io/twitter/${username}`,
            siteName: 'X (Twitter)',
            favicon: 'https://abs.twimg.com/favicons/twitter.3.ico',
            items: [],
            itemCount: 0,
            error: err.message || 'All Twitter proxy instances failed'
          });
        }
      }
    } catch {}
    res.status(400).json({ error: `Could not process URL: ${err.message}` });
  }
});

// Save a scraped feed
app.post('/api/feeds/scraped', async (req, res) => {
  const { name, siteUrl, siteDescription, items = [], favicon, siteImage, autoRefreshMinutes, category } = req.body;
  if (!siteUrl) return res.status(400).json({ error: 'siteUrl required' });
  const feeds = readJSON('feeds.json', {});
  const id = uuidv4();
  feeds[id] = {
    id,
    url: siteUrl,
    type: 'scraped',
    name: name || siteUrl,
    description: siteDescription || 'Auto-generated feed',
    siteUrl,
    favicon: favicon || `https://www.google.com/s2/favicons?domain=${new URL(siteUrl).hostname}&sz=64`,
    siteImage: siteImage || null,
    category: category || 'Generated',
    addedAt: new Date().toISOString(),
    lastFetched: new Date().toISOString(),
    unreadCount: items.length,
    items,
    isScraped: true,
    autoRefreshMinutes: autoRefreshMinutes || 60,
  };
  writeJSON('feeds.json', feeds);
  res.json(feeds[id]);
});

// Convert any URL to RSS on-the-fly (no save needed — live endpoint)
app.get('/api/url-to-rss', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });
  try {
    const result = await smartScrape(url);
    if (result.type === 'rss') {
      return res.json({ redirectTo: result.rssUrl, type: 'rss' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── FULL ARTICLE CONTENT PROXY ───────────────────────────────────────────────
// Uses Mozilla Readability (Firefox Reader View engine) for robust extraction
app.get('/api/article-content', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });
  try {
    const html = await fetchHtml(url);
    const pageUrl = new URL(url);

    // ── Extract metadata with cheerio (fast, reliable for meta tags) ────────
    const $ = cheerio.load(html);
    let heroImage = $('meta[property="og:image"]').attr('content') || '';
    let siteName = $('meta[property="og:site_name"]').attr('content') || pageUrl.hostname;
    let date = $('meta[property="article:published_time"]').attr('content')
      || $('time[datetime]').first().attr('datetime') || '';
    let author = $('meta[name="author"]').attr('content')
      || $('[rel="author"], .author, .byline, [itemprop="author"]').first().text().trim() || '';

    // ── Strategy 1: Mozilla Readability (Firefox Reader View engine) ─────────
    let content = '';
    let title = '';
    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document, {
        charThreshold: 20,      // lower threshold catches short articles
      });
      const article = reader.parse();
      if (article && article.content) {
        content = article.content;   // clean HTML
        title = article.title || '';
        author = author || article.byline || '';
        if (article.excerpt && !content.includes(article.excerpt.slice(0, 50))) {
          // prepend excerpt if article body doesn't already include it
        }
      }
    } catch (readErr) {
      console.log('Readability failed, falling back to cheerio:', readErr.message);
    }

    // ── Strategy 2: Cheerio fallback (if Readability returned nothing) ───────
    if (!content || content.length < 100) {
      // Try JSON-LD articleBody first
      $('script[type="application/ld+json"]').each((i, el) => {
        if (content && content.length > 200) return;
        try {
          const data = JSON.parse($(el).html());
          const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
          for (const node of items) {
            const nodeType = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
            if (nodeType.some(t => ['Article', 'NewsArticle', 'BlogPosting', 'ReportageNewsArticle', 'TechArticle'].includes(t))) {
              if (node.articleBody && node.articleBody.length > 100) {
                // Convert plain text to paragraphs
                content = node.articleBody.split(/\n\n+/).map(p => `<p>${p.trim()}</p>`).join('');
                title = title || node.headline || '';
                author = author || node.author?.name || (Array.isArray(node.author) ? node.author[0]?.name : '') || '';
                date = date || node.datePublished || '';
                heroImage = heroImage || node.image?.url || (typeof node.image === 'string' ? node.image : '') || '';
              }
            }
          }
        } catch {}
      });
    }

    // ── Strategy 3: Direct selector fallback ─────────────────────────────────
    if (!content || content.length < 100) {
      const selectors = [
        '[itemprop="articleBody"]', 'article .entry-content', 'article .post-content',
        '.article-body', '.article-content', '.story-body', '.post-body',
        '.entry-content', '.post-content', 'article', 'main', '[role="main"]',
      ];
      for (const sel of selectors) {
        const $el = $(sel).first();
        if ($el.length && $el.text().trim().length > 100) {
          $el.find('script, style, nav, .ad, .ads, .share, .social, .related, .newsletter, [aria-hidden="true"]').remove();
          content = $el.html();
          break;
        }
      }
    }

    // ── Extract title if still missing ───────────────────────────────────────
    if (!title) {
      title = $('meta[property="og:title"]').attr('content')
        || $('h1').first().text().trim()
        || $('title').text().trim() || '';
    }

    // ── Fix relative URLs and set target=_blank on links ────────────────────
    if (content) {
      const $c = cheerio.load(content);

      // Remove placeholder images, tracking pixels, and fix srcset-only images
      $c('img').each((i, el) => {
        const src = $c(el).attr('src') || '';
        const srcset = $c(el).attr('srcset') || '';
        const ariaLabel = $c(el).attr('aria-label') || '';
        const w = parseInt($c(el).attr('width')) || 0;
        const h = parseInt($c(el).attr('height')) || 0;

        // Remove placeholder/unavailable images (BBC grey-placeholder, lazy-load stubs, etc.)
        if (ariaLabel.includes('unavailable')
          || src.includes('placeholder') || src.includes('lazy')
          || src.includes('grey-placeholder') || src.includes('blank.')
          || (src.startsWith('data:image/gif') && src.length < 200)
          || (src.startsWith('data:image/png') && src.length < 200)
          || (src.startsWith('data:image/svg') && src.length < 300)
          || src.includes('pixel') || src.includes('beacon') || src.includes('tracker')
          || src.includes('/1x1') || src.includes('spacer')
          || (!src && !srcset)
          || (w > 0 && w <= 5) || (h > 0 && h <= 5)) {
          // If it has a srcset, try to promote that before removing
          if (srcset && !src.includes('placeholder')) {
            // keep it — we'll fix the src below
          } else if (srcset) {
            // placeholder src but has real srcset — remove the bad src, promote srcset
            $c(el).removeAttr('src');
          } else {
            $c(el).remove();
            return;
          }
        }

        // If image has srcset but no usable src, extract a good URL from srcset
        const currentSrc = $c(el).attr('src') || '';
        if (srcset && (!currentSrc || currentSrc.includes('placeholder') || currentSrc.includes('lazy') || currentSrc.includes('blank'))) {
          // Parse srcset: "url1 240w, url2 640w, ..."
          const candidates = srcset.split(',').map(s => {
            const parts = s.trim().split(/\s+/);
            return { url: parts[0], width: parseInt(parts[1]) || 0 };
          }).filter(c => c.url && c.url.startsWith('http'));
          // Pick ~640w or the middle option for quality/size balance
          const target = candidates.find(c => c.width >= 480 && c.width <= 800)
            || candidates[Math.floor(candidates.length / 2)]
            || candidates[0];
          if (target) {
            $c(el).attr('src', target.url);
          } else {
            $c(el).remove();
            return;
          }
        }

        // Fix relative URLs on remaining images
        const finalSrc = $c(el).attr('src') || '';
        if (finalSrc && !finalSrc.startsWith('http') && !finalSrc.startsWith('data:')) {
          try { $c(el).attr('src', new URL(finalSrc, pageUrl.origin).href); } catch {}
        }
        // Clean up srcset to avoid browser confusion
        $c(el).removeAttr('srcset');
        $c(el).removeAttr('sizes');
      });

      $c('a[href]').each((i, el) => {
        const href = $c(el).attr('href');
        if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
          try { $c(el).attr('href', new URL(href, pageUrl.origin).href); } catch {}
        }
        $c(el).attr('target', '_blank');
        $c(el).attr('rel', 'noopener noreferrer');
      });
      content = $c.html();
    }

    if (!content) content = '<p>Could not extract article content. Try opening the full article.</p>';

    res.json({
      title,
      author: author.trim(),
      date,
      heroImage,
      content,
      sourceUrl: url,
      siteName,
    });
  } catch (err) {
    res.status(400).json({ error: `Failed to fetch article: ${err.message}` });
  }
});

// ─── ALL ARTICLES ─────────────────────────────────────────────────────────────
app.get('/api/articles', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const { search, feedId, limit = 200, offset = 0 } = req.query;
  let articles = [];
  Object.values(feeds).forEach(feed => {
    if (feedId && feed.id !== feedId) return;
    (feed.items || []).forEach(item => articles.push({ ...item, feedName: feed.name, feedId: feed.id, favicon: feed.favicon }));
  });
  if (search) {
    const q = search.toLowerCase();
    articles = articles.filter(a => (a.title || '').toLowerCase().includes(q) || (a.content || '').toLowerCase().includes(q) || (a.feedName || '').toLowerCase().includes(q));
  }
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ total: articles.length, articles: articles.slice(Number(offset), Number(offset) + Number(limit)) });
});

// ─── LIVE RSS XML OUTPUT — subscribe to any generated feed in your reader ─────
app.get('/rss/:feedId', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const feed = feeds[req.params.feedId];
  if (!feed) return res.status(404).send('Feed not found');

  const rss = new RSS({
    title: feed.name,
    description: feed.description || '',
    feed_url: `http://localhost:${PORT}/rss/${feed.id}`,
    site_url: feed.siteUrl || feed.url,
    image_url: feed.siteImage || feed.favicon || '',
    pubDate: feed.lastFetched,
    ttl: feed.autoRefreshMinutes || 60,
  });

  (feed.items || []).slice(0, 50).forEach(item => {
    rss.item({
      title: item.title,
      description: item.content || '',
      url: item.link,
      guid: item.id || item.link,
      author: item.author || '',
      date: item.date,
      enclosure: item.image ? { url: item.image, type: 'image/jpeg' } : undefined,
    });
  });

  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(rss.xml({ indent: true }));
});

// ─── EXPORT ───────────────────────────────────────────────────────────────────
app.get('/api/export/opml', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0"><head><title>RSS Tool Feeds</title></head><body>'];
  const byCategory = {};
  Object.values(feeds).forEach(f => { const cat = f.category || 'Uncategorized'; (byCategory[cat] = byCategory[cat] || []).push(f); });
  Object.entries(byCategory).forEach(([cat, catFeeds]) => {
    lines.push(`  <outline text="${cat}">`);
    catFeeds.forEach(f => {
      const xmlUrl = f.isScraped ? `http://localhost:${PORT}/rss/${f.id}` : f.url;
      lines.push(`    <outline type="rss" text="${escXML(f.name)}" xmlUrl="${escXML(xmlUrl)}" htmlUrl="${escXML(f.siteUrl || f.url)}"/>`);
    });
    lines.push('  </outline>');
  });
  lines.push('</body></opml>');
  res.set('Content-Type', 'text/xml');
  res.set('Content-Disposition', 'attachment; filename="rss-feeds.opml"');
  res.send(lines.join('\n'));
});

function escXML(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

app.get('/api/export/json', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const all = [];
  Object.values(feeds).forEach(f => (f.items || []).forEach(i => all.push({ ...i, feedName: f.name, feedUrl: f.url })));
  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.set('Content-Disposition', 'attachment; filename="rss-articles.json"');
  res.json(all);
});

app.get('/api/export/csv', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const rows = [['Feed', 'Title', 'Author', 'Date', 'Link']];
  Object.values(feeds).forEach(f => (f.items || []).forEach(i => rows.push([csvEsc(f.name), csvEsc(i.title), csvEsc(i.author), csvEsc(i.date), csvEsc(i.link)])));
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="rss-articles.csv"');
  res.send(rows.map(r => r.join(',')).join('\n'));
});
function csvEsc(s) { return `"${(s || '').replace(/"/g, '""')}"`; }

// ─── IMPORT OPML ──────────────────────────────────────────────────────────────
app.post('/api/import/opml', async (req, res) => {
  const { opmlContent } = req.body;
  if (!opmlContent) return res.status(400).json({ error: 'OPML content required' });
  const $ = cheerio.load(opmlContent, { xmlMode: true });
  const urls = [];
  $('outline[xmlUrl]').each((i, el) => { urls.push($(el).attr('xmlUrl')); });
  res.json({ found: urls.length, urls });
});

// ─── WIDGET ───────────────────────────────────────────────────────────────────
app.get('/widget/:feedId', (req, res) => {
  const feeds = readJSON('feeds.json', {});
  const feed = feeds[req.params.feedId];
  if (!feed) return res.status(404).send('Feed not found');
  const { theme = 'dark', limit = 10, layout = 'list' } = req.query;
  const items = (feed.items || []).slice(0, Number(limit));
  const bg = theme === 'light' ? '#ffffff' : '#0d1117';
  const text = theme === 'light' ? '#1a1a1a' : '#e2e8f0';
  const card = theme === 'light' ? '#f5f5f5' : '#1e2736';
  const accent = '#4F8EF7';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,sans-serif;background:${bg};color:${text};padding:12px}
    a{color:${accent};text-decoration:none}.item{background:${card};border-radius:8px;padding:12px;margin-bottom:8px;display:${layout==='grid'?'inline-block':'block'};${layout==='grid'?'width:calc(50% - 4px);margin-right:8px;vertical-align:top':''}}
    .item:hover{opacity:0.85}.item img{width:100%;height:100px;object-fit:cover;border-radius:4px;margin-bottom:8px}
    .title{font-weight:600;font-size:13px;line-height:1.4}.meta{font-size:11px;opacity:0.6;margin-top:4px}
    .feed-header{font-weight:700;font-size:14px;margin-bottom:10px;color:${accent}}
  </style></head><body>
  <div class="feed-header">${escXML(feed.name)}</div>
  ${items.map(i => `<div class="item">${i.image?`<img src="${i.image}" alt="" onerror="this.style.display='none'">`:''}<div class="title"><a href="${i.link}" target="_blank">${escXML(i.title)}</a></div><div class="meta">${new Date(i.date).toLocaleDateString()}</div></div>`).join('')}
  </body></html>`;
  res.send(html);
});

// ─── Auto-refresh scraped feeds every 30 min ─────────────────────────────────
setInterval(async () => {
  const feeds = readJSON('feeds.json', {});
  const scrapedFeeds = Object.values(feeds).filter(f => f.isScraped && f.url);
  for (const feed of scrapedFeeds) {
    const ageMinutes = (Date.now() - new Date(feed.lastFetched)) / 60000;
    if (ageMinutes >= (feed.autoRefreshMinutes || 60)) {
      try {
        const updated = await refreshScrapedFeed(feed);
        feeds[feed.id] = updated;
        writeJSON('feeds.json', feeds);
        console.log(`🔄 Auto-refreshed: ${feed.name}`);
      } catch (e) { console.warn(`⚠️ Auto-refresh failed for ${feed.name}:`, e.message); }
    }
  }
}, 5 * 60 * 1000); // check every 5 min

app.listen(PORT, () => {
  console.log(`✅ RSS Tool running at http://localhost:${PORT}`);
  console.log(`📡 URL-to-RSS API: POST /api/scrape   or   GET /api/url-to-rss?url=...`);
  console.log(`📰 Live RSS feed:  GET /rss/:feedId`);
});
