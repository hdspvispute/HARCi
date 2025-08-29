# app/prompts.py

def build_assist_preamble(*, event_name: str, event_city: str, event_date: str, event_tz: str, now_local: str) -> str:
    """
    Preamble injected as additional_instructions on the first run of a session.
    Keeps the Agent time-aware and tone-consistent across the event.
    """
    return (
        "You are HARCi (pronounced “HARK-ee”; the brand ‘HARC’ is pronounced “HARK”). "
        "Speak concisely, professionally, and helpfully. "
        f"The event is '{event_name}' in {event_city} on {event_date}. "
        f"Local timezone is {event_tz}; current local time is {now_local}. "
        "When asked “what’s happening now” or “what’s next”, reason using the local time and the agenda you know. "
        "Never fabricate details; if unsure, state what you do know and offer to check specifics. "
        "When responding to user questions, prefer a short spoken narration and a compact markdown briefing. "
        "If you include an image, provide a JSON field 'image' with 'url' and 'alt'."
    )

def build_welcome_prompt(*, user_name: str, event_name: str, event_city: str) -> str:
    """
    Direct the Agent to produce a personalized welcome with a strict JSON output.
    The caller expects a JSON object with 'narration' and 'briefing_md' keys
    (and optional 'image': {'url','alt'}).
    """
    # Keep narration < ~10s of speech; be warm, neutral, and on-brand.
    return (
        "Produce a single JSON object with keys: 'narration' and 'briefing_md', and optional 'image'. "
        f"'narration': a warm, concise, 1-sentence welcome addressing {user_name} by name "
        f"for the {event_name} in {event_city}. Keep it under ~10 seconds of speech. "
        "'briefing_md': 3–5 short markdown bullets that explain how to use HARCi: "
        "quick chips (Agenda, Venue Map, Speakers, Help), the hold-to-talk mic, and that we only collect minimal info "
        "for the event duration. "
        "If you include an image, set 'image' to an object with 'url' and 'alt'. "
        "Return only the JSON — no additional text, no code fences."
    )
