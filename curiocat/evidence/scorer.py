"""Source credibility scoring based on URL classification."""

from __future__ import annotations

from urllib.parse import urlparse

# Credibility scores by source category.
SOURCE_CREDIBILITY: dict[str, float] = {
    "academic": 0.95,
    "news": 0.75,
    "blog": 0.5,
    "forum": 0.35,
    "social": 0.2,
    "other": 0.4,
}

# Domain patterns for classification.
_ACADEMIC_DOMAINS: set[str] = {
    "arxiv.org",
    "pubmed.ncbi.nlm.nih.gov",
    "doi.org",
    "scholar.google.com",
    "jstor.org",
    "nature.com",
    "science.org",
    "sciencedirect.com",
    "springer.com",
    "wiley.com",
    "ieee.org",
    "acm.org",
    "ncbi.nlm.nih.gov",
    "plos.org",
    "frontiersin.org",
    "ssrn.com",
    "researchgate.net",
    "biorxiv.org",
    "medrxiv.org",
}

_NEWS_DOMAINS: set[str] = {
    "reuters.com",
    "apnews.com",
    "bbc.com",
    "bbc.co.uk",
    "nytimes.com",
    "washingtonpost.com",
    "theguardian.com",
    "economist.com",
    "ft.com",
    "bloomberg.com",
    "cnbc.com",
    "cnn.com",
    "npr.org",
    "pbs.org",
    "aljazeera.com",
    "wsj.com",
    "usatoday.com",
    "politico.com",
    "thehill.com",
    "axios.com",
    "time.com",
    "newsweek.com",
    "forbes.com",
    "wired.com",
    "arstechnica.com",
    "techcrunch.com",
    "theverge.com",
}

_BLOG_DOMAINS: set[str] = {
    "medium.com",
    "substack.com",
    "wordpress.com",
    "blogspot.com",
    "tumblr.com",
    "dev.to",
    "hashnode.dev",
    "ghost.io",
}

_FORUM_DOMAINS: set[str] = {
    "reddit.com",
    "quora.com",
    "stackexchange.com",
    "stackoverflow.com",
    "news.ycombinator.com",
    "discourse.org",
}

_SOCIAL_DOMAINS: set[str] = {
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "tiktok.com",
    "threads.net",
    "mastodon.social",
    "linkedin.com",
}


def _extract_domain(url: str) -> str:
    """Extract the registrable domain from a URL.

    For example, 'https://www.bbc.co.uk/news' -> 'bbc.co.uk'.
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        # Strip 'www.' prefix
        if hostname.startswith("www."):
            hostname = hostname[4:]
        return hostname.lower()
    except Exception:
        return ""


def classify_source(url: str) -> str:
    """Classify a URL into a source category.

    Args:
        url: The URL to classify.

    Returns:
        One of: "academic", "news", "blog", "forum", "other".
    """
    domain = _extract_domain(url)
    if not domain:
        return "other"

    # Check for .edu or .ac. domains (academic institutions)
    if domain.endswith(".edu") or ".ac." in domain or ".edu." in domain:
        return "academic"

    # Check against known domain sets
    for known_domain in _ACADEMIC_DOMAINS:
        if domain == known_domain or domain.endswith("." + known_domain):
            return "academic"

    for known_domain in _NEWS_DOMAINS:
        if domain == known_domain or domain.endswith("." + known_domain):
            return "news"

    for known_domain in _BLOG_DOMAINS:
        if domain == known_domain or domain.endswith("." + known_domain):
            return "blog"

    for known_domain in _FORUM_DOMAINS:
        if domain == known_domain or domain.endswith("." + known_domain):
            return "forum"

    for known_domain in _SOCIAL_DOMAINS:
        if domain == known_domain or domain.endswith("." + known_domain):
            return "social"

    # Check for government domains
    if (
        domain.endswith(".gov")
        or domain == "gov.uk"
        or domain.endswith(".gov.uk")
    ):
        return "academic"

    return "other"


def score_credibility(url: str) -> tuple[str, float]:
    """Classify a URL and return its credibility score.

    Args:
        url: The URL to score.

    Returns:
        A tuple of (source_type, credibility_score).
    """
    source_type = classify_source(url)
    score = SOURCE_CREDIBILITY[source_type]
    return source_type, score
