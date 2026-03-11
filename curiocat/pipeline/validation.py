"""Post-LLM output validation gates."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def validate_causal_output(
    result: dict, source_text: str, target_text: str
) -> dict | None:
    """Validate a single causal inference LLM output.

    Returns cleaned result or None if validation fails.
    """
    # Gate 1: mechanism must be substantive (>10 chars, not just restating claims)
    mechanism = result.get("mechanism", "").strip()
    if len(mechanism) < 10:
        logger.info(
            "Validation: rejected — mechanism too short (%d chars)", len(mechanism)
        )
        return None

    # Gate 2: mechanism should not just repeat claim text
    source_lower = source_text.lower()[:80]
    target_lower = target_text.lower()[:80]
    mechanism_lower = mechanism.lower()
    if source_lower in mechanism_lower and target_lower in mechanism_lower:
        logger.info("Validation: rejected — mechanism restates both claims")
        return None

    # Gate 3: strength must be between 0.1 and 0.95 (reject extreme values)
    strength = result.get("strength", 0.5)
    if strength < 0.1 or strength > 0.95:
        result["strength"] = max(0.1, min(0.95, strength))
        logger.debug("Validation: clamped strength to %.2f", result["strength"])

    return result
