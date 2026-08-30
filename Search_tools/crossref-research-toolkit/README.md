# Crossref Research Toolkit 🔬

**Search 150M+ scholarly articles across all academic disciplines using the free Crossref API. No API key required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://python.org)

## Why Crossref?

- **150M+ works** — journal articles, books, conference papers, datasets
- **Free & open** — no API key, no registration, no rate limits (with polite pool)
- **Rich metadata** — citations, references, funders, licenses, abstracts
- **DOI resolution** — the authoritative source for DOI metadata

## Quick Start

```bash
pip install requests
python crossref_toolkit.py --query "machine learning healthcare" --rows 10
```

## Features

| Feature | Description |
|---------|-------------|
| **Search works** | Full-text search across 150M+ scholarly articles |
| **Filter by type** | Journal articles, books, datasets, proceedings |
| **Citation data** | Get reference counts, cited-by counts |
| **Funder info** | Find who funded the research |
| **Journal lookup** | Search journals by ISSN or title |
| **Export formats** | JSON, CSV, BibTeX output |

## Usage Examples

### Search for articles
```python
from crossref_toolkit import CrossrefClient

client = CrossrefClient()

# Search articles
results = client.search_works("CRISPR gene editing", rows=5)
for work in results:
    print(f"{work['title']} ({work['year']}) - {work['citations']} citations")

# Get article by DOI
article = client.get_work("10.1038/nature12373")
print(f"Title: {article['title']}")
print(f"Journal: {article['journal']}")
print(f"Cited by: {article['cited_by']} papers")

# Search with filters
results = client.search_works(
    "artificial intelligence",
    filter_type="journal-article",
    from_date="2024-01-01",
    sort="relevance"
)
```

### Export to CSV
```python
client.export_csv("quantum computing", rows=100, filename="quantum_papers.csv")
```

### Get journal info
```python
journal = client.get_journal("0028-0836")  # Nature
print(f"{journal['title']}: {journal['total_dois']} DOIs")
```

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/works` | Search and filter scholarly works |
| `/works/{doi}` | Get metadata for a specific DOI |
| `/journals` | Search journals |
| `/funders` | Search research funders |
| `/types` | List work types |

## Part of the Research API Suite

- 🔬 [Crossref Research Toolkit](https://github.com/spinov001/crossref-research-toolkit) ← You are here
- 📚 [OpenAlex Research Toolkit](https://github.com/spinov001/openalex-research-toolkit)
- 🏥 [PubMed Research Toolkit](https://github.com/spinov001/pubmed-research-toolkit)
- 📄 [arXiv Paper Searcher](https://github.com/spinov001/arxiv-paper-searcher)
- 🌍 [World Bank Data Toolkit](https://github.com/spinov001/world-bank-data-toolkit)
- 🚀 [NASA Open Data Toolkit](https://github.com/spinov001/nasa-open-data-toolkit)

## Related Articles

- [Crossref Has a Free API — Search 150M+ Scholarly Articles](https://dev.to/spinov001)
- [OpenAlex API: Search 250M+ Academic Papers](https://dev.to/spinov001)
- [PubMed Has a Free API — Search 36M+ Medical Papers](https://dev.to/spinov001)
- [arXiv Has a Free API — Search 2M+ Research Papers](https://dev.to/spinov001)

## License

MIT License — use freely for research, education, and commercial projects.
