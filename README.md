# RSS Tool

A locally-hosted RSS aggregator and feed generator — a free alternative to rss.app. Turn any website into an RSS feed, aggregate multiple sources, and manage your content in a clean, modern interface.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

## Features

### Feed Management
- **Add any RSS/Atom feed** - Supports standard RSS, Atom, and JSON feeds
- **Auto-discovery** - Automatically detects feeds from website URLs
- **Smart scraping** - Converts any website into an RSS feed using advanced extraction
- **Twitter/X support** - Fetches Twitter/X timelines via Nitter proxies (no API key needed)
- **Feed collections** - Organize feeds into custom collections
- **OPML import/export** - Import/export your feed list

### Content Features
- **Full-text extraction** - Automatically extracts article content
- **Image support** - Displays article images in feed list
- **Read/unread tracking** - Never miss new content
- **Starred articles** - Save articles for later
- **Search** - Find articles across all feeds
- **Auto-refresh** - Configurable automatic feed updates

### Technical
- **Evasive scraping** - Advanced bot detection evasion for stubborn sites
- **Docker support** - Run in a container with docker-compose
- **REST API** - Full API for programmatic access
- **No external dependencies** - Self-hosted, your data stays local

## Quick Start

### Local Installation

```bash
# Clone the repository
git clone https://github.com/raitata/rss-tool.git
cd rss-tool

# Install dependencies
npm install

# Start the server
npm start
```

Open http://localhost:55794 in your browser.

### Docker Installation

```bash
# Using docker-compose
docker-compose up -d

# Or build manually
docker build -t rss-tool .
docker run -p 55794:55794 -v ./data:/app/data rss-tool
```

## Usage

### Adding Feeds

1. **Direct RSS URL** - Paste any RSS/Atom feed URL
2. **Website URL** - Enter a website URL and the tool will auto-discover feeds
3. **Twitter/X** - Enter `https://x.com/username` to fetch Twitter timelines
4. **Custom scraping** - Use CSS selectors to scrape specific content

### Smart Scraping

For sites without RSS feeds, the tool uses multiple extraction strategies:
- JSON-LD structured data
- Article HTML elements
- Heading/link patterns
- Aggressive fallback mode for stubborn sites

### Feed Collections

Create collections to organize feeds:
- News (BBC, Reuters, CNN)
- Tech (TechCrunch, The Verge)
- Finance (Bloomberg, FinancialJuice)

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/feeds` | List all feeds |
| POST | `/api/feeds` | Add a new feed |
| DELETE | `/api/feeds/:id` | Remove a feed |
| POST | `/api/feeds/:id/refresh` | Refresh a feed |
| GET | `/api/articles` | Get all articles |
| POST | `/api/scrape` | Scrape a URL for feeds |
| POST | `/api/discover` | Discover content options |
| POST | `/api/scrape-custom` | Scrape with CSS selector |
| GET | `/api/collections` | List collections |
| POST | `/api/collections` | Create collection |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 55794 | Server port |
| `NODE_ENV` | production | Environment mode |

### Data Storage

All data is stored in the `data/` directory:
- `feeds.json` - Feed configurations
- `collections.json` - Collection definitions
- `articles.json` - Cached articles

Mount this directory as a volume in Docker for persistence.

## Troubleshooting

### "Maximum redirects exceeded"
- Some sites redirect heavily. The tool now allows up to 10 redirects.

### "All Twitter proxy instances failed"
- Nitter instances can be unreliable. The tool tries multiple fallbacks automatically.

### "Failed to construct URL"
- Fixed in latest version. Ensure siteUrl or rssUrl is provided in API responses.

### Bot detection issues
- The tool uses multiple evasion techniques: header rotation, cookie jars, randomized delays
- Enable aggressive mode for stubborn sites (auto-enabled in scrape-custom)

## Architecture

```
┌─────────────────┐     ┌─────────────┐     ┌──────────────┐
│   Frontend      │────▶│  Express    │────▶│   Feed       │
│   (app-v2.js)   │     │  Server     │     │   Parser     │
└─────────────────┘     └─────────────┘     └──────────────┘
                               │                    │
                               ▼                    ▼
                         ┌─────────────┐     ┌──────────────┐
                         │   Smart     │     │   Twitter    │
                         │   Scraper   │     │   Proxies    │
                         └─────────────┘     └──────────────┘
```

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: Vanilla JavaScript (no framework)
- **Parsing**: rss-parser, cheerio, jsdom
- **Scraping**: axios with advanced evasion
- **Styling**: Custom CSS with CSS variables

## Contributing

Contributions welcome! Areas for improvement:
- Additional scraper strategies
- More Nitter/Twitter proxy sources
- UI/UX enhancements
- Test coverage

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- [Nitter](https://github.com/zedeus/nitter) for Twitter proxy instances
- [Readability](https://github.com/mozilla/readability) by Mozilla for content extraction
- [rss-parser](https://github.com/rbren/rss-parser) for feed parsing
