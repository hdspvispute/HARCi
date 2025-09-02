# app/main.py
import os
import json
import time
import uuid
import random
import logging
import threading
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from zoneinfo import ZoneInfo

EVENT_TZ   = os.getenv("EVENT_TZ", "America/Chicago")
EVENT_DATE = os.getenv("EVENT_DATE", "2025-09-16")
EVENT_CITY = os.getenv("EVENT_CITY", "Dallas, Texas, USA")
EVENT_NAME = os.getenv("EVENT_NAME", "Powering Mission-Critical AI")

# Session TTL (seconds) — controls both cookie Max-Age and server-side session retention
SESSION_TTL_SECS = int(os.getenv("SESSION_TTL_SECS", "86400"))

# Ensure Azure CLI path is set for Windows (dev convenience)
if os.name == "nt":
    os.environ.setdefault("AZURE_CLI_PATH", r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd")

import httpx
from fastapi import FastAPI, Request, HTTPException, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from starlette.templating import Jinja2Templates
from dotenv import load_dotenv

# ---- Prompts module (centralized) -------------------------------------------
try:
    from .prompts import build_assist_preamble, build_welcome_prompt
except Exception:
    from prompts import build_assist_preamble, build_welcome_prompt  # type: ignore

load_dotenv(override=False)

# ===== Azure Agents SDK (optional) ============================================
try:
    from azure.core.credentials import AccessToken, TokenCredential  # type: ignore
    from azure.ai.projects import AIProjectClient  # type: ignore
    from azure.ai.agents.models import ListSortOrder  # type: ignore
except Exception:
    AccessToken = None          # type: ignore
    TokenCredential = None      # type: ignore
    AIProjectClient = None      # type: ignore
    ListSortOrder = None        # type: ignore

# ===== Env ====================================================================
HITACHI_RED      = os.getenv("HITACHI_RED", "#E60027")
PROJECT_ENDPOINT = os.getenv("PROJECT_ENDPOINT")   # https://<acct>.services.ai.azure.com/api/projects/<project>
AGENT_ID         = os.getenv("AGENT_ID")
SPEECH_REGION    = os.getenv("SPEECH_REGION")
SPEECH_KEY       = os.getenv("SPEECH_KEY")
SPEECH_RESOURCES = (os.getenv("SPEECH_RESOURCES") or "").strip()  # JSON: [{"region":"eastus2","key":"..."}]

# Optional TURN/relay override (not used server-side if you rely on service relay token)
RELAY_URLS      = os.getenv("RELAY_URLS", "")
RELAY_USERNAME  = os.getenv("RELAY_USERNAME", "")
RELAY_PASSWORD  = os.getenv("RELAY_PASSWORD", "")

AVATAR_ID        = os.getenv("AVATAR_ID", "lisa")
AVATAR_STYLE     = os.getenv("AVATAR_STYLE", "casual-sitting")
SPEECH_LANG      = os.getenv("SPEECH_LANG", "en-US")
SPEECH_VOICE     = os.getenv("SPEECH_VOICE", "en-US-JennyNeural")

LOG_LEVEL        = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FILE         = os.getenv("LOG_FILE")  # If set, logs will also be written to this file (rotating)

# ===== Logging ================================================================
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s"
)
if LOG_FILE:
    fh = RotatingFileHandler(LOG_FILE, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    fh.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s :: %(message)s"))
    logging.getLogger().addHandler(fh)

log = logging.getLogger("harci")

def agent_config_ok() -> bool:
    return bool(PROJECT_ENDPOINT and AGENT_ID)

# ===== App / Static / Templates ==============================================
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

_APP_ROOT = os.path.dirname(os.path.abspath(__file__))
_STATIC_DIR = os.path.join(_APP_ROOT, "static")
_TEMPLATES_DIR = os.path.join(_APP_ROOT, "templates")

app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
templates = Jinja2Templates(directory=_TEMPLATES_DIR)

# ===== Sessions (in-memory with TTL) =========================================
SESSION_COOKIE = "harci_sid"

class Session(BaseModel):
    sid: str
    name: str
    company: str
    created_at: datetime
    last_active: datetime
    expires_at: datetime
    active: bool = True
    agent_thread_id: str = ""
    agent_ctx_seeded: bool = False  # avoid re-sending system context each turn

SESSIONS: Dict[str, Session] = {}

def _now_utc() -> datetime:
    return datetime.utcnow()

def new_sid() -> str:
    return uuid.uuid4().hex

def _is_expired(sess: Session) -> bool:
    return sess.expires_at <= _now_utc()

def get_session(sid: Optional[str]) -> Optional[Session]:
    if not sid:
        return None
    sess = SESSIONS.get(sid)
    if not sess:
        return None
    if _is_expired(sess):
        try:
            del SESSIONS[sid]
        except Exception:
            pass
        return None
    return sess

def touch_sid(sid: str, slide_expiry: bool = True):
    s = get_session(sid)
    if s:
        s.last_active = _now_utc()
        if slide_expiry:
            s.expires_at = _now_utc() + timedelta(seconds=SESSION_TTL_SECS)

# ===== Speech resource pool ===================================================
_pool: List[Dict[str, str]] = []
_pool_idx = 0
_pool_lock = threading.Lock()

def _init_pool():
    """Initialize rotating pool of speech resources (for rate balancing)."""
    global _pool
    _pool = []
    if SPEECH_RESOURCES:
        try:
            arr = json.loads(SPEECH_RESOURCES)
            if isinstance(arr, list):
                for item in arr:
                    if item.get("region") and item.get("key"):
                        _pool.append({"region": item["region"], "key": item["key"]})
            random.shuffle(_pool)
        except Exception as e:
            log.warning("SPEECH_RESOURCES json error: %s", e)
    if not _pool and SPEECH_REGION and SPEECH_KEY:
        _pool = [{"region": SPEECH_REGION, "key": SPEECH_KEY}]
    if not _pool:
        log.warning("No Speech resources configured")

def _next_speech_resource() -> Dict[str, str]:
    global _pool_idx
    if not _pool:
        _init_pool()
    if not _pool:
        raise HTTPException(500, "Speech not configured")
    with _pool_lock:
        res = _pool[_pool_idx % len(_pool)]
        _pool_idx += 1
        return res

# ===== UI config ==============================================================
def ui_cfg():
    return {
        "brandRed": HITACHI_RED,
        "avatarId": AVATAR_ID,
        "avatarStyle": AVATAR_STYLE,
        "speechLang": SPEECH_LANG,
        "speechVoice": SPEECH_VOICE,
        "event": {
            "tz":   EVENT_TZ,
            "date": EVENT_DATE,
            "city": EVENT_CITY,
            "name": EVENT_NAME,
        },
    }

@app.get("/api/config")
async def api_config():
    return ui_cfg()

# ===== Pages ==================================================================
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    sid = request.cookies.get(SESSION_COOKIE)
    sess = get_session(sid)
    if sess:
        return RedirectResponse("/guide")
    return RedirectResponse("/register")

@app.get("/register", response_class=HTMLResponse)
async def page_register(request: Request):
    return templates.TemplateResponse("register.html", {"request": request, "cfg": ui_cfg()})

# Kept for back-compat: if something tries /transition, just go to /guide.
@app.get("/transition", response_class=HTMLResponse)
async def page_transition(_: Request):
    return RedirectResponse("/guide")

@app.get("/guide", response_class=HTMLResponse)
async def page_guide(request: Request):
    sid = request.cookies.get(SESSION_COOKIE)
    return templates.TemplateResponse("guide.html", {"request": request, "cfg": ui_cfg(), "has_sid": bool(get_session(sid))})

@app.get("/ended", response_class=HTMLResponse)
async def page_ended(request: Request):
    return templates.TemplateResponse("ended.html", {"request": request, "cfg": ui_cfg()})

# ===== Registration + session =================================================
@app.post("/api/register")
async def api_register(name: str = Form(...), company: str = Form(...)):
    name = (name or "").strip()
    company = (company or "").strip()
    if not name or not company:
        raise HTTPException(400, "Name and Company are required")

    sid = new_sid()
    now = _now_utc()
    SESSIONS[sid] = Session(
        sid=sid, name=name, company=company,
        created_at=now, last_active=now, active=True,
        expires_at=now + timedelta(seconds=SESSION_TTL_SECS)
    )

    res = JSONResponse({"ok": True, "sid": sid, "next": "/guide"})
    # Persistent cookie (readable by JS because UI reads it; change httponly if you refactor)
    expires_http = (now + timedelta(seconds=SESSION_TTL_SECS)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    res.set_cookie(
        SESSION_COOKIE, sid,
        httponly=False,  # UI reads cookie today; keep False unless you refactor UI
        samesite="Lax",
        max_age=SESSION_TTL_SECS,
        expires=expires_http,
        path="/",
        # secure=True,  # enable when served over HTTPS only
    )
    return res

class SidBody(BaseModel):
    sid: str = ""

@app.post("/api/session/start")
async def api_session_start(body: SidBody):
    sid = body.sid or ""
    sess = get_session(sid)
    if not sess:
        raise HTTPException(404, "Session not found")
    sess.active = True
    touch_sid(sid)
    return {"ok": True}

@app.post("/api/session/end")
async def api_session_end(body: SidBody):
    sid = body.sid or ""
    sess = get_session(sid)
    if sess:
        sess.active = False
        touch_sid(sid)
    return {"ok": True}

# ===== Tokens (Speech + Relay) ===============================================
_SPEECH_TOKEN_CACHE_LOCK = threading.Lock()
_SPEECH_TOKEN_CACHE: Dict[str, Dict[str, object]] = {}  # {resource_id: {"token": str, "exp": int, "region": str}}

def _resource_id(region: str, key: str) -> str:
    head = key[:6] if key else ""
    return f"{region}:{head}"

def _get_cached_speech_token(region: str, key: str) -> Optional[Dict[str, object]]:
    rid = _resource_id(region, key)
    with _SPEECH_TOKEN_CACHE_LOCK:
        data = _SPEECH_TOKEN_CACHE.get(rid)
        if not data:
            return None
        # Keep 60s safety margin
        if int(data.get("exp", 0)) - int(time.time()) <= 60:
            _SPEECH_TOKEN_CACHE.pop(rid, None)
            return None
        return data

def _set_cached_speech_token(region: str, key: str, token: str, ttl_sec: int = 8 * 60):
    rid = _resource_id(region, key)
    with _SPEECH_TOKEN_CACHE_LOCK:
        _SPEECH_TOKEN_CACHE[rid] = {"token": token, "exp": int(time.time()) + ttl_sec, "region": region}

@app.get("/speech-token")
@app.get("/api/speech/token")  # alias
async def speech_token():
    res = _next_speech_resource()
    region, key = res["region"], res["key"]
    cached = _get_cached_speech_token(region, key)
    if cached:
        return {"token": cached["token"], "region": cached["region"], "expiresAt": cached["exp"]}

    url = f"https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Length": "0",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, headers=headers)
        if r.status_code >= 400:
            log.error("speech-token error: %s %s", r.status_code, r.text)
            raise HTTPException(r.status_code, "Failed to issue speech token")
        token = r.text.strip()

    _set_cached_speech_token(region, key, token, ttl_sec=8 * 60)
    return {"token": token, "region": region, "expiresAt": int(time.time()) + 8 * 60}

@app.get("/relay-token")
async def relay_token():
    # For Microsoft Avatar WebRTC relay discovery
    res = _next_speech_resource()
    region, key = res["region"], res["key"]
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"Ocp-Apim-Subscription-Key": key})
        if r.status_code == 200:
            return r.json()
        raise HTTPException(r.status_code, f"Relay token error {r.status_code}: {r.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Relay token request failed: {e}")

# ===== Azure Agent client/credential (cached) =================================
_CLIENT_LOCK = threading.Lock()
_PROJECT_CLIENT: Optional["AIProjectClient"] = None
_AGENT_OBJ = None
_CREDENTIAL = None  # Optional["TokenCredential"]

def _build_credential():
    from azure.identity import DefaultAzureCredential
    mi_present = bool(os.getenv("IDENTITY_ENDPOINT") or os.getenv("MSI_ENDPOINT"))
    return DefaultAzureCredential(
        exclude_environment_credential=False,
        exclude_managed_identity_credential=not mi_present,
        exclude_shared_token_cache_credential=True,
        exclude_visual_studio_code_credential=True,
        exclude_powershell_credential=True,
        exclude_workload_identity_credential=True,
    )

def _get_client_and_agent():
    global _PROJECT_CLIENT, _AGENT_OBJ, _CREDENTIAL
    if not agent_config_ok():
        raise HTTPException(500, "Agent not configured")
    if AIProjectClient is None:
        raise HTTPException(500, "Azure AI SDK not installed")
    if _PROJECT_CLIENT and _AGENT_OBJ:
        return _PROJECT_CLIENT, _AGENT_OBJ
    with _CLIENT_LOCK:
        if _PROJECT_CLIENT and _AGENT_OBJ:
            return _PROJECT_CLIENT, _AGENT_OBJ
        _CREDENTIAL = _build_credential()
        client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=_CREDENTIAL)
        agent = client.agents.get_agent(AGENT_ID)
        _PROJECT_CLIENT, _AGENT_OBJ = client, agent
        return client, agent

# ===== Helpers for parsing agent replies ======================================
def _extract_text(msg):
    try:
        tms = getattr(msg, "text_messages", None) or []
        if tms:
            last = tms[-1]
            val = getattr(getattr(last, "text", None), "value", None) or getattr(last, "text", None)
            if val:
                return str(val)
    except Exception:
        pass
    c = getattr(msg, "content", None)
    if isinstance(c, str) and c.strip():
        return c.strip()
    return None

def _parse_payload(s: str):
    s2 = (s or "").strip()
    if s2.startswith("```"):
        fence = "```json" if s2.lower().startswith("```json") else "```"
        s2 = s2[len(fence):].strip()
        if s2.endswith("```"):
            s2 = s2[:-3].strip()
    try:
        return json.loads(s2)
    except Exception:
        return {"narration": s, "briefing_md": "", "image": None}

def _now_local_str() -> str:
    try:
        return datetime.now(ZoneInfo(EVENT_TZ)).strftime("%Y-%m-%d %H:%M:%S %Z")
    except Exception:
        return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

# ===== Assist endpoint ========================================================
@app.post("/assist/run")
async def assist_run(req: Request, body: dict = Body(default={})):
    text = (body.get("text") or "").strip()
    sid  = body.get("session_id") or req.cookies.get(SESSION_COOKIE)
    # Prepare session log file path
    session_log_dir = os.path.join(_APP_ROOT, "session_logs")
    os.makedirs(session_log_dir, exist_ok=True)
    log_file_path = os.path.join(session_log_dir, f"SessLog_{sid}.txt")
    sess = get_session(sid)
    user_name = getattr(sess, "name", "Guest") if sess else "Guest"

    if not agent_config_ok() or AIProjectClient is None:
        topic = text or "Welcome"
        narration = f"{topic}: Here's what you need to know for the HARC AI Launch."
        briefing_md = (
            f"### {topic}\n"
            f"- Venue: Hall A (Ground Floor)\n"
            f"- Time: 10:00–17:00\n"
            f"- Tip: Use the quick chips (Agenda, Venue Map, Speakers, Help)\n"
        )
        # Log interaction
        with open(log_file_path, "a", encoding="utf-8") as f:
            f.write(f"User: {user_name}: {text}\n")
            f.write(f"HARCi: {narration}\n")
            f.write(f"Briefing: {briefing_md}\n\n")
        return JSONResponse({
            "narration": narration,
            "briefing_md": briefing_md,
            "image": {"url": "/static/assets/venue-map.png", "alt": "Venue map"}
        })

    try:
        project, agent = _get_client_and_agent()
        thread_id = getattr(sess, "agent_thread_id", None) or ""
        if not thread_id:
            thread = project.agents.threads.create()
            thread_id = thread.id
            if sess:
                sess.agent_thread_id = thread_id

        should_seed = not bool(getattr(sess, "agent_ctx_seeded", False)) if sess else True
        preamble = build_assist_preamble(
            event_name=EVENT_NAME,
            event_city=EVENT_CITY,
            event_date=EVENT_DATE,
            event_tz=EVENT_TZ,
            now_local=_now_local_str()
        ) if should_seed else None

        project.agents.messages.create(thread_id=thread_id, role="user", content=text)
        run = project.agents.runs.create(
            thread_id=thread_id,
            agent_id=agent.id,
            additional_instructions=preamble
        )

        if should_seed and sess:
            sess.agent_ctx_seeded = True

        deadline = time.time() + 30.0
        while getattr(run, "status", None) not in ("completed", "failed") and time.time() < deadline:
            time.sleep(0.25)
            run = project.agents.runs.get(thread_id=thread_id, run_id=run.id)

        if getattr(run, "status", None) == "failed":
            log.error("Agent run failed: %s", getattr(run, "last_error", None))
            narration = "Agent run failed."
            briefing_md = f"### Error\n- {getattr(run, 'last_error', 'unknown')}"
            with open(log_file_path, "a", encoding="utf-8") as f:
                f.write(f"User: {user_name}: {text}\n")
                f.write(f"HARCi: {narration}\n")
                f.write(f"Briefing: {briefing_md}\n\n")
            return JSONResponse(
                {"narration": narration, "briefing_md": briefing_md},
                status_code=500
            )

        try:
            output_ids = getattr(run, "output_messages", None) or []
        except Exception:
            output_ids = []

        response_logged = False
        if output_ids:
            get_by_id = getattr(project.agents.messages, "get", None)
            if callable(get_by_id):
                for mid in output_ids:
                    try:
                        m = project.agents.messages.get(thread_id=thread_id, message_id=mid)
                    except Exception:
                        continue
                    role_name = str(getattr(getattr(m, "role", None), "name", "")).lower()
                    if role_name != "agent":
                        continue
                    txt = _extract_text(m)
                    if txt:
                        payload = _parse_payload(txt)
                        narration = payload.get("narration", "")
                        briefing_md = payload.get("briefing_md", "")
                        with open(log_file_path, "a", encoding="utf-8") as f:
                            f.write(f"User: {user_name}: {text}\n")
                            f.write(f"HARCi: {narration}\n")
                            f.write(f"Briefing: {briefing_md}\n\n")
                        response_logged = True
                        touch_sid(sid or "")
                        return JSONResponse(payload)

        list_kwargs = {"thread_id": thread_id, "limit": 20}
        if ListSortOrder is not None:
            list_kwargs["order"] = ListSortOrder.DESCENDING
        msgs = project.agents.messages.list(**list_kwargs)

        chosen_payload = None
        newest_agent_any = None
        for m in msgs:
            role_name = str(getattr(getattr(m, "role", None), "name", "")).lower()
            if role_name != "agent":
                continue
            if newest_agent_any is None:
                newest_agent_any = m
            mid_run_id = getattr(m, "run_id", None)
            if mid_run_id and str(mid_run_id) == str(run.id):
                txt = _extract_text(m)
                if txt:
                    chosen_payload = _parse_payload(txt)
                    break

        if chosen_payload is None and newest_agent_any is not None:
            txt = _extract_text(newest_agent_any)
            if txt:
                chosen_payload = _parse_payload(txt)

        narration = chosen_payload.get("narration", "") if chosen_payload else "No agent reply found."
        briefing_md = chosen_payload.get("briefing_md", "") if chosen_payload else ""
        with open(log_file_path, "a", encoding="utf-8") as f:
            f.write(f"User: {user_name}: {text}\n")
            f.write(f"HARCi: {narration}\n")
            f.write(f"Briefing: {briefing_md}\n\n")
        touch_sid(sid or "")
        return JSONResponse(chosen_payload or {
            "narration": narration,
            "briefing_md": briefing_md,
            "image": None
        })
    except Exception:
        log.exception("assist_run agent SDK error")
        narration = "I couldn’t reach the agent service just now. Here’s a quick brief."
        briefing_md = f"### {text or 'Info'}\n- The service is temporarily unavailable.\n- Please try again in a moment."
        with open(log_file_path, "a", encoding="utf-8") as f:
            f.write(f"User: {user_name}: {text}\n")
            f.write(f"HARCi: {narration}\n")
            f.write(f"Briefing: {briefing_md}\n\n")
        return JSONResponse({
            "narration": narration,
            "briefing_md": briefing_md,
        }, status_code=200)

# ===== Personalized welcome (Agent-powered) ===================================
@app.post("/assist/welcome")
async def assist_welcome(req: Request):
    sid = req.cookies.get(SESSION_COOKIE)
    sess = get_session(sid)
    user_name = (getattr(sess, "name", None) or "Guest").strip()

    if not agent_config_ok() or AIProjectClient is None:
        fallback_narration = (
            f"Hi {user_name}, welcome to the {EVENT_NAME}. I’m HARCi — "
            "ask me about the agenda, venue map, or speakers."
        )
        fallback_briefing = (
            f"### Welcome, {user_name}\n"
            "- Tap a quick chip: **Agenda**, **Venue Map**, **Speakers**, or **Help**.\n"
            "- Press and hold the mic to talk; release to send.\n"
            "- We only collect minimal info for this event.\n"
        )
        return JSONResponse({"narration": fallback_narration, "briefing_md": fallback_briefing})

    try:
        project, agent = _get_client_and_agent()
        thread_id = getattr(sess, "agent_thread_id", "") if sess else ""
        if not thread_id:
            thread = project.agents.threads.create()
            thread_id = thread.id
            if sess:
                sess.agent_thread_id = thread_id

        should_seed = not bool(getattr(sess, "agent_ctx_seeded", False)) if sess else True
        preamble = build_assist_preamble(
            event_name=EVENT_NAME,
            event_city=EVENT_CITY,
            event_date=EVENT_DATE,
            event_tz=EVENT_TZ,
            now_local=_now_local_str()
        ) if should_seed else None

        welcome_prompt = build_welcome_prompt(
            user_name=user_name,
            event_name=EVENT_NAME,
            event_city=EVENT_CITY
        )

        project.agents.messages.create(thread_id=thread_id, role="user", content=welcome_prompt)
        run = project.agents.runs.create(
            thread_id=thread_id,
            agent_id=agent.id,
            additional_instructions=preamble
        )

        if should_seed and sess:
            sess.agent_ctx_seeded = True

        deadline = time.time() + 30.0
        while getattr(run, "status", None) not in ("completed", "failed") and time.time() < deadline:
            time.sleep(0.25)
            run = project.agents.runs.get(thread_id=thread_id, run_id=run.id)

        if getattr(run, "status", None) == "failed":
            log.error("Agent welcome failed: %s", getattr(run, "last_error", None))
            raise HTTPException(502, "Welcome run failed")

        output_ids = getattr(run, "output_messages", None) or []
        if output_ids:
            get_by_id = getattr(project.agents.messages, "get", None)
            if callable(get_by_id):
                for mid in output_ids:
                    try:
                        m = project.agents.messages.get(thread_id=thread_id, message_id=mid)
                    except Exception:
                        continue
                    role_name = str(getattr(getattr(m, "role", None), "name", "")).lower()
                    if role_name != "agent":
                        continue
                    txt = _extract_text(m)
                    if txt:
                        touch_sid(sid or "")
                        return JSONResponse(_parse_payload(txt))

        list_kwargs = {"thread_id": thread_id, "limit": 20}
        if ListSortOrder is not None:
            list_kwargs["order"] = ListSortOrder.DESCENDING
        msgs = project.agents.messages.list(**list_kwargs)

        for m in msgs:
            role_name = str(getattr(getattr(m, "role", None), "name", "")).lower()
            if role_name != "agent":
                continue
            if getattr(m, "run_id", None) and str(m.run_id) == str(run.id):
                txt = _extract_text(m)
                if txt:
                    touch_sid(sid or "")
                    return JSONResponse(_parse_payload(txt))

        for m in msgs:
            role_name = str(getattr(getattr(m, "role", None), "name", "")).lower()
            if role_name == "agent":
                txt = _extract_text(m)
                if txt:
                    touch_sid(sid or "")
                    return JSONResponse(_parse_payload(txt))
                break

        fallback_narration = (
            f"Hi {user_name}, welcome to the {EVENT_NAME}. I’m HARCi — "
            "ask me about the agenda, venue map, or speakers."
        )
        fallback_briefing = (
            f"### Welcome, {user_name}\n"
            "- Tap a quick chip: **Agenda**, **Venue Map**, **Speakers**, or **Help**.\n"
            "- Press and hold the mic to talk; release to send.\n"
            "- We only collect minimal info for this event.\n"
        )
        touch_sid(sid or "")
        return JSONResponse({"narration": fallback_narration, "briefing_md": fallback_briefing})
    except Exception:
        log.exception("assist_welcome error")
        fallback_narration = (
            f"Hi {user_name}, welcome to the {EVENT_NAME}. I’m HARCi — "
            "ask me about the agenda, venue map, or speakers."
        )
        fallback_briefing = (
            f"### Welcome, {user_name}\n"
            "- Tap a quick chip: **Agenda**, **Venue Map**, **Speakers**, or **Help**.\n"
            "- Press and hold the mic to talk; release to send.\n"
            "- We only collect minimal info for this event.\n"
        )
        return JSONResponse({"narration": fallback_narration, "briefing_md": fallback_briefing})
