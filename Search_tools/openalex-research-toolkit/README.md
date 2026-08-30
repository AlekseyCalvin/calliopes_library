# OpenAlex Research Toolkit 🔬

Search 250M+ academic papers, authors, and institutions using the free OpenAlex API. No API key required.

## Features

- **Search papers** by keyword, author, institution, or concept
- **Track research trends** over time (publications per year)
- **Build citation networks** — find who cites whom
- **Export to CSV** for analysis in Excel, Pandas, R
- **Map institutional output** — see what any university publishes
- **Zero setup** — no API key, no authentication, no rate limits

## Quick Start

```bash
pip install requests
python search_papers.py "machine learning" --sort citations --limit 20
```

## Usage Examples

### Search papers
```python
import requests

url = "https://api.openalex.org/works"
params = {"search": "web scraping", "sort": "cited_by_count:desc", "per_page": 10}
papers = requests.get(url, params=params).json()["results"]

for p in papers:
    print(f"{p['cited_by_count']} citations | {p['title'][:80]}")
```

### Track trends
```python
for year in range(2020, 2027):
    url = f"https://api.openalex.org/works?filter=concept.id:C154945302,publication_year:{year}"
    count = requests.get(url).json()["meta"]["count"]
    print(f"{year}: {count:,} AI papers")
```

### Find author publications
```python
author = requests.get("https://api.openalex.org/authors?search=geoffrey+hinton").json()["results"][0]
print(f"{author['display_name']}: {author['works_count']} papers, {author['cited_by_count']:,} citations")
```

## OpenAlex vs Alternatives

| Feature | OpenAlex | Google Scholar | Semantic Scholar | Scopus |
|---------|----------|---------------|-----------------|--------|
| API Key | ❌ No | No API | ✅ Yes | ✅ Yes |
| Rate Limit | 100K/day | Blocked | 100/5min | Varies |
| Papers | 250M+ | Unknown | 200M+ | 84M+ |
| Free | ✅ | N/A | ✅ | ❌ |
| Open Source | ✅ | ❌ | ❌ | ❌ |

## Related Projects

- [arXiv Paper Searcher](https://github.com/Spinov001/arxiv-paper-searcher) — search preprints
- [77 Web Scrapers on Apify](https://apify.com/knotless_cadence) — ready-made data extraction tools
- [Full tutorial on Dev.to](https://dev.to/0012303/openalex-api-search-250m-academic-papers-for-free-no-key-required-50pn)

## License

MIT

---
*Built by [AI Entrepreneur](https://spinov001-art.github.io) — data extraction tools for researchers and developers.*

## Research API Suite

- [arXiv Paper Searcher](https://github.com/spinov001-art/arxiv-paper-searcher) — 2M+ preprints
- **OpenAlex Research Toolkit** (this repo) — 250M+ papers
- [PubMed Research Toolkit](https://github.com/spinov001-art/pubmed-research-toolkit) — 36M+ biomedical
- [Crossref Research Toolkit](https://github.com/spinov001-art/crossref-research-toolkit) — 150M+ scholarly articles
