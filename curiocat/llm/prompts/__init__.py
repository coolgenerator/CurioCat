"""Prompt utilities and language detection for LLM calls."""

import re


def detect_language(text: str) -> str:
    """Detect the dominant language of the input text via character ranges.

    Returns a language name string (e.g. "Chinese", "Japanese", "English").
    Falls back to heuristic detection for Latin-script languages.
    """
    # Sample the first 500 chars for speed
    sample = text[:500]
    # Remove ASCII chars, digits, punctuation, whitespace
    non_ascii = re.sub(r'[\x00-\x7F]', '', sample)

    # If substantial non-ASCII content, check script-based detection
    ratio = len(non_ascii) / max(len(sample), 1) if non_ascii else 0.0

    if ratio >= 0.15 and non_ascii:
        # Check character ranges for script-identifiable languages
        cjk = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', non_ascii))
        hangul = len(re.findall(r'[\uac00-\ud7af\u1100-\u11ff]', non_ascii))
        kana = len(re.findall(r'[\u3040-\u309f\u30a0-\u30ff]', non_ascii))
        cyrillic = len(re.findall(r'[\u0400-\u04ff]', non_ascii))
        arabic = len(re.findall(r'[\u0600-\u06ff]', non_ascii))
        thai = len(re.findall(r'[\u0e00-\u0e7f]', non_ascii))
        devanagari = len(re.findall(r'[\u0900-\u097f]', non_ascii))
        vietnamese = len(re.findall(r'[\u0100-\u024f\u1ea0-\u1ef9]', non_ascii))

        counts = {
            'Chinese': cjk,
            'Korean': hangul,
            'Japanese': kana + cjk // 2,  # Japanese mixes kanji + kana
            'Russian': cyrillic,
            'Arabic': arabic,
            'Thai': thai,
            'Hindi': devanagari,
            'Vietnamese': vietnamese,
        }
        best = max(counts, key=counts.get)  # type: ignore[arg-type]
        if counts[best] > 3:
            # Disambiguate Chinese vs Japanese: if kana present, it's Japanese
            if best == 'Chinese' and kana > 2:
                return 'Japanese'
            return best

    # For Latin-script text, check for accented/diacritical patterns
    # that distinguish non-English European languages
    if non_ascii and 0.02 < ratio < 0.15:
        # Has some non-ASCII but not dominant — likely European language
        # with diacritics (French, German, Spanish, Portuguese, etc.)
        # Let the LLM figure out the exact language
        return "the same language as the input"

    return "English"


_NATIVE_INSTRUCTIONS: dict[str, str] = {
    "Chinese": "⚠️ 语言要求：你必须用中文撰写所有输出内容（分析、结论、理由等）。严格匹配输入文本的语言。",
    "Japanese": "⚠️ 言語要件：すべての出力テキスト（分析、結論、理由など）を日本語で記述してください。入力テキストの言語に正確に合わせてください。",
    "Korean": "⚠️ 언어 요구사항: 모든 출력 텍스트(분석, 결론, 이유 등)를 한국어로 작성해야 합니다. 입력 텍스트의 언어와 정확히 일치시키세요.",
    "Russian": "⚠️ ЯЗЫКОВОЕ ТРЕБОВАНИЕ: Весь выходной текст (анализ, выводы, причины и т.д.) ДОЛЖЕН быть написан на русском языке.",
    "Arabic": "⚠️ متطلبات اللغة: يجب كتابة جميع النصوص (التحليل والاستنتاجات والأسباب وما إلى ذلك) باللغة العربية.",
}


def language_instruction(text: str) -> str:
    """Return a user-prompt suffix that instructs the LLM to respond
    in the same language as *text*.

    The instruction itself is written in the detected language so the LLM
    naturally follows the language pattern.
    """
    lang = detect_language(text)
    if lang in _NATIVE_INSTRUCTIONS:
        return f"\n\n{_NATIVE_INSTRUCTIONS[lang]}"
    if lang == "English":
        return (
            "\n\n⚠️ LANGUAGE REQUIREMENT: You MUST write ALL output text "
            "in English. Match the language of the input text exactly."
        )
    # Fallback for European languages detected by diacritics
    return (
        "\n\n⚠️ LANGUAGE REQUIREMENT: You MUST write ALL output text "
        "in the same language as the input text above. "
        "Match the language exactly."
    )
