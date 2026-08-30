"""Crossref Research Toolkit — Search 150M+ scholarly articles via the free Crossref API."""

import requests
import csv
import json
import argparse
from typing import Optional
from urllib.parse import quote

BASE_URL = "https://api.crossref.org"
MAILTO = "spinov001@gmail.com"  # Polite pool — faster responses


class CrossrefClient:
    """Client for the Crossref REST API."""

    def __init__(self, mailto: str = MAILTO):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": f"CrossrefToolkit/1.0 (mailto:{mailto})"})
        self.base = BASE_URL

    def search_works(self, query: str, rows: int = 10, offset: int = 0,
                     filter_type: Optional[str] = None, from_date: Optional[str] = None,
                     sort: str = "relevance") -> list:
        """Search for scholarly works."""
        params = {"query": query, "rows": rows, "offset": offset,
                  "sort": sort, "order": "desc", "mailto": MAILTO}
        filters = []
        if filter_type:
            filters.append(f"type:{filter_type}")
        if from_date:
            filters.append(f"from-pub-date:{from_date}")
        if filters:
            params["filter"] = ",".join(filters)

        resp = self.session.get(f"{self.base}/works", params=params)
        resp.raise_for_status()
        items = resp.json()["message"]["items"]

        return [self._parse_work(item) for item in items]

    def get_work(self, doi: str) -> dict:
        """Get metadata for a specific DOI."""
        resp = self.session.get(f"{self.base}/works/{quote(doi, safe='')}")
        resp.raise_for_status()
        return self._parse_work(resp.json()["message"])

    def get_journal(self, issn: str) -> dict:
        """Get journal information by ISSN."""
        resp = self.session.get(f"{self.base}/journals/{issn}")
        resp.raise_for_status()
        msg = resp.json()["message"]
        return {"title": msg.get("title", ""), "issn": issn,
                "publisher": msg.get("publisher", ""),
                "total_dois": msg.get("counts", {}).get("total-dois", 0)}

    def search_funders(self, query: str, rows: int = 5) -> list:
        """Search for research funders."""
        resp = self.session.get(f"{self.base}/funders", params={"query": query, "rows": rows})
        resp.raise_for_status()
        return [{"name": f["name"], "id": f["id"], "works": f.get("tokens", 0)}
                for f in resp.json()["message"]["items"]]

    def export_csv(self, query: str, rows: int = 100, filename: str = "results.csv"):
        """Export search results to CSV."""
        results = self.search_works(query, rows=rows)
        with open(filename, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["title", "authors", "year", "journal",
                                                     "doi", "citations", "type"])
            writer.writeheader()
            for r in results:
                writer.writerow(r)
        print(f"Exported {len(results)} results to {filename}")

    def _parse_work(self, item: dict) -> dict:
        """Parse a Crossref work item into a clean dict."""
        title_list = item.get("title", ["Untitled"])
        title = title_list[0] if title_list else "Untitled"
        authors = ", ".join(
            f"{a.get('given', '')} {a.get('family', '')}".strip()
            for a in item.get("author", [])[:5]
        )
        date_parts = item.get("published-print", item.get("published-online", {}))
        year = date_parts.get("date-parts", [[None]])[0][0] if date_parts else None
        journal_list = item.get("container-title", [])
        journal = journal_list[0] if journal_list else ""

        return {"title": title, "authors": authors, "year": year,
                "journal": journal, "doi": item.get("DOI", ""),
                "citations": item.get("is-referenced-by-count", 0),
                "type": item.get("type", ""), "url": item.get("URL", "")}


def main():
    parser = argparse.ArgumentParser(description="Search Crossref — 150M+ scholarly articles")
    parser.add_argument("--query", "-q", required=True, help="Search query")
    parser.add_argument("--rows", "-r", type=int, default=10, help="Number of results")
    parser.add_argument("--type", "-t", help="Filter by type (e.g., journal-article)")
    parser.add_argument("--from-date", help="Filter from date (YYYY-MM-DD)")
    parser.add_argument("--csv", help="Export to CSV file")
    parser.add_argument("--doi", help="Look up a specific DOI")
    args = parser.parse_args()

    client = CrossrefClient()

    if args.doi:
        work = client.get_work(args.doi)
        print(json.dumps(work, indent=2, ensure_ascii=False))
        return

    if args.csv:
        client.export_csv(args.query, rows=args.rows, filename=args.csv)
        return

    results = client.search_works(args.query, rows=args.rows,
                                   filter_type=args.type, from_date=args.from_date)
    for i, r in enumerate(results, 1):
        print(f"\n{i}. {r['title']}")
        print(f"   Authors: {r['authors']}")
        print(f"   Journal: {r['journal']} ({r['year']})")
        print(f"   DOI: {r['doi']}")
        print(f"   Citations: {r['citations']}")


if __name__ == "__main__":
    main()
