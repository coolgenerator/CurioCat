"""NLI-based evidence relevance scoring.

Uses a Cross-Encoder NLI model to determine whether evidence supports,
contradicts, or is neutral to a causal claim. This replaces LLM-based
relevance scoring with a faster, cheaper, and more calibrated approach.

The model outputs logits for [contradiction, neutral, entailment] which
map directly to the evidence scoring needs.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Lazy-loaded singleton
_tokenizer = None
_model = None
_NLI_MODEL = "cross-encoder/nli-deberta-v3-small"


def _load_model():
    """Lazy-load the NLI model on first use."""
    global _tokenizer, _model
    if _model is None:
        logger.info("Loading NLI model: %s (this may take a moment on first run)", _NLI_MODEL)
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        _tokenizer = AutoTokenizer.from_pretrained(_NLI_MODEL)
        _model = AutoModelForSequenceClassification.from_pretrained(_NLI_MODEL)
        _model.eval()
        logger.info("NLI model loaded successfully")
    return _tokenizer, _model


def preload_model() -> None:
    """Pre-load the NLI model at startup so it's ready when needed.

    Call this during application initialization to avoid blocking
    the first evidence grounding request.
    """
    try:
        _load_model()
    except Exception as exc:
        logger.warning("Failed to preload NLI model: %s", exc)


def _softmax(logits):
    """Compute softmax probabilities."""
    exp = np.exp(logits - np.max(logits))
    return exp / exp.sum()


def score_evidence_nli(
    causal_claim: str,
    snippet: str,
) -> dict[str, Any]:
    """Score a single evidence snippet against a causal claim using NLI.

    Uses a cross-encoder model directly (not zero-shot-classification
    pipeline) for ~10x faster inference.

    Args:
        causal_claim: The causal relationship being evaluated.
        snippet: The evidence text to score.

    Returns:
        Dict with relevance_score, is_supporting, summary.
    """
    if not snippet or not snippet.strip():
        return {
            "relevance_score": 0.0,
            "is_supporting": False,
            "summary": "Empty snippet",
        }

    try:
        import torch

        tokenizer, model = _load_model()

        # Cross-encoder: encode (premise, hypothesis) pair
        # premise = evidence snippet, hypothesis = causal claim
        inputs = tokenizer(
            snippet[:512],
            causal_claim[:256],
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )

        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits[0].cpu().numpy()

        # Model output order: [contradiction, neutral, entailment]
        probs = _softmax(logits)
        contra_prob = float(probs[0])
        neutral_prob = float(probs[1])
        entail_prob = float(probs[2])

        # Relevance = 1 - neutral (anything non-neutral is relevant)
        relevance = 1.0 - neutral_prob

        # Supporting if entailment > contradiction
        is_supporting = entail_prob > contra_prob

        if neutral_prob > 0.6:
            summary = "Evidence is not directly relevant to the causal claim."
        elif is_supporting:
            summary = f"Evidence supports the claim (entailment: {entail_prob:.0%})."
        else:
            summary = f"Evidence contradicts the claim (contradiction: {contra_prob:.0%})."

        return {
            "relevance_score": round(relevance, 3),
            "is_supporting": is_supporting,
            "summary": summary,
        }

    except Exception as exc:
        logger.warning("NLI scoring failed: %s", exc)
        return {
            "relevance_score": 0.0,
            "is_supporting": False,
            "summary": f"NLI scoring error: {exc}",
        }


def score_evidence_batch_nli(
    causal_claim: str,
    snippets: list[str],
) -> list[dict[str, Any]]:
    """Score multiple snippets in a batch for better throughput.

    Args:
        causal_claim: The causal relationship being evaluated.
        snippets: List of evidence snippet strings.

    Returns:
        List of score dicts, one per snippet.
    """
    if not snippets:
        return []

    valid = [(i, s) for i, s in enumerate(snippets) if s and s.strip()]
    if not valid:
        return [{"relevance_score": 0.0, "is_supporting": False, "summary": "Empty snippet"}] * len(snippets)

    try:
        import torch

        tokenizer, model = _load_model()

        # Batch encode all pairs
        premises = [s[:512] for _, s in valid]
        hypotheses = [causal_claim[:256]] * len(valid)

        inputs = tokenizer(
            premises,
            hypotheses,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )

        with torch.no_grad():
            outputs = model(**inputs)
            all_logits = outputs.logits.cpu().numpy()

        # Build results
        results = [{"relevance_score": 0.0, "is_supporting": False, "summary": "Empty snippet"}] * len(snippets)

        for (orig_idx, _), logits in zip(valid, all_logits):
            probs = _softmax(logits)
            contra_prob = float(probs[0])
            neutral_prob = float(probs[1])
            entail_prob = float(probs[2])

            relevance = 1.0 - neutral_prob
            is_supporting = entail_prob > contra_prob

            if neutral_prob > 0.6:
                summary = "Evidence is not directly relevant."
            elif is_supporting:
                summary = f"Evidence supports the claim ({entail_prob:.0%})."
            else:
                summary = f"Evidence contradicts the claim ({contra_prob:.0%})."

            results[orig_idx] = {
                "relevance_score": round(relevance, 3),
                "is_supporting": is_supporting,
                "summary": summary,
            }

        return results

    except Exception as exc:
        logger.warning("NLI batch scoring failed: %s", exc)
        return [{"relevance_score": 0.0, "is_supporting": False, "summary": f"Error: {exc}"}] * len(snippets)
