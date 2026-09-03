from __future__ import annotations

from fastapi import HTTPException


async def google_translate_text(text: str) -> str:
    query = (text or "").strip()
    if not query:
        return ""

    try:
        from googletrans import Translator
        from langdetect import detect
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Google Translate provider requires 'googletrans' and 'langdetect' to be installed.",
        ) from exc

    try:
        text_language = detect(query)
    except Exception:
        text_language = "unknown"

    print(f"Detected language: {text_language}")
    if text_language == "en":
        print("Text is already in English. No translation needed.")
        return query

    print(f"Translating text from {text_language} to English...")
    try:
        async with Translator() as translator:
            result = await translator.translate(query, dest="en")
        return result.text
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google Translate failed: {exc}") from exc


def _load_translation_skill() -> str:
    from pathlib import Path
    skill_path = Path(__file__).resolve().parents[1] / "skills" / "translation_glossary_skill.md"
    if skill_path.exists():
        try:
            return skill_path.read_text(encoding="utf-8")
        except Exception:
            pass
    return ""


async def llm_translate_text(llm_translate, text: str) -> str:
    query = (text or "").strip()
    if not query:
        return ""
    if llm_translate is None:
        raise HTTPException(status_code=503, detail="LLM translator is not initialized.")

    skill_content = _load_translation_skill()
    system_prompt = f"""
    You are a strict Vietnamese-to-English translator for video/image retrieval queries.

    Your ONLY task is translation.

    Rules:
    - ONLY translate. Do NOT rewrite, enhance, expand, summarize, simplify, clarify, optimize, or beautify the query.
    - Preserve the original meaning, wording, level of detail, and structure as closely as possible.
    - Do NOT add information that is not explicitly present in the original query.
    - Do NOT infer hidden context, locations, nationalities, emotions, appearances, environments, or visual details.
    - Do NOT make vague descriptions more specific.
    - Do NOT replace words with more descriptive alternatives unless necessary for correct translation.
    - Do NOT remove information from the original query.
    - Preserve all entities, actions, colors, locations, visible text, numbers, quantities, and temporal expressions.
    - Preserve singular/plural distinctions when possible.
    - Preserve negation.
    - Preserve uncertainty and modifiers such as "có vẻ", "có thể", "khoảng", "gần", etc.
    - Preserve relationships between objects and people.
    - If the user's query is Vietnamese, translate it into English.
    - If the user's query is already English, return it EXACTLY unchanged.
    - If the query contains both Vietnamese and English, translate ONLY the Vietnamese parts and preserve the English parts unchanged.
    - Keep proper names unchanged unless the glossary explicitly specifies otherwise.
    - Follow the Visual Translation Skill & Glossary below.
    - Prefer glossary translations over alternative translations.
    - Match the longest applicable glossary phrase first.
    - Return ONLY the translated query without quotes, explanations, or additional text.

    ==================================================
    VISUAL TRANSLATION GLOSSARY SKILL
    ==================================================
    {skill_content}
    """

    messages = [
        ("system", system_prompt),
        ("human", query),
    ]

    try:
        response = await llm_translate.ainvoke(messages)
    except AttributeError:
        response = llm_translate.invoke(messages)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM translation failed: {exc}") from exc

    return response.content.strip()
