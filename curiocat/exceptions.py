class CurioCatError(Exception):
    """Base exception for CurioCat."""


class PipelineError(CurioCatError):
    """Raised when a pipeline stage fails."""


class LLMError(CurioCatError):
    """Raised when an LLM API call fails."""


class DAGError(CurioCatError):
    """Raised when graph construction or validation fails."""


class ValidationError(CurioCatError):
    """Raised when input validation fails."""
