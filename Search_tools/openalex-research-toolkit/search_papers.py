"""OpenAlex Paper Search — Search 250M+ academic papers with zero setup."""
import requests
import csv
import argparse
import sys

BASE_URL = "https://api.openalex.org"

def search_papers(query, sort="cited_by_count:desc", limit=10, email=None):
    params = {"search": query, "sort": sort, "per_page": min(limit, 200)}
    if email:
        params["mailto"] = email
    resp = requests.get(f"{BASE_URL}/works", params=params)
    resp.raise_for_status()
    data = resp.json()
    return data["meta"]["count"], data["results"]

def search_authors(query, email=None):
    params = {"search": query}
    if email:
        params["mailto"] = email
    resp = requests.get(f"{BASE_URL}/authors", params=params)
    resp.raise_for_status()
    return resp.json()["results"]

def trend_by_year(concept_id, start=2020, end=2026, email=None):
    results = {}
    for year in range(start, end + 1):
        params = {"filter": f"concept.id:{concept_id},publication_year:{year}"}
        if email:
            params["mailto"] = email
        resp = requests.get(f"{BASE_URL}/works", params=params)
        results[year] = resp.json()["meta"]["count"]
    return results

def export_csv(papers, filename="papers.csv"):
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Title", "Year", "Citations", "DOI", "Authors"])
        for p in papers:
            authors = "; ".join(a["author"]["display_name"] for a in p.get("authorships", [])[:5])
            writer.writerow([p["title"], p["publication_year"], p["cited_by_count"], p.get("doi", ""), authors])
    return filename

def main():
    parser = argparse.ArgumentParser(description="Search OpenAlex — 250M+ academic papers")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--sort", default="cited_by_count:desc", help="Sort: cited_by_count:desc, publication_date:desc, relevance_score:desc")
    parser.add_argument("--limit", type=int, default=10, help="Number of results")
    parser.add_argument("--email", help="Your email for polite pool (faster responses)")
    parser.add_argument("--csv", help="Export to CSV file")
    args = parser.parse_args()

    total, papers = search_papers(args.query, args.sort, args.limit, args.email)
    print(f"\nFound {total:,} papers for '{args.query}'\n")

    for i, p in enumerate(papers, 1):
        print(f"{i}. [{p['cited_by_count']:,} citations] {p['title']}")
        if p.get("doi"):
            print(f"   DOI: {p['doi']}")
        print()

    if args.csv:
        export_csv(papers, args.csv)
        print(f"Exported to {args.csv}")

if __name__ == "__main__":
    main()
