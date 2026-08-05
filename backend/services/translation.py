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


async def llm_translate_text(llm_translate, text: str) -> str:
    query = (text or "").strip()
    if not query:
        return ""
    if llm_translate is None:
        raise HTTPException(status_code=503, detail="LLM translator is not initialized.")

    system_prompt = """
        Translate the user's video/image retrieval query to concise English.
        Preserve concrete entities, actions, colors, locations, visible text, and temporal intent.
        If the query is already English, return it unchanged.
        Return only the translated query, no quotes or explanation.
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
