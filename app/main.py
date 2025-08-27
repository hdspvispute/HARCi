# app/main.py
import os
import json
import time
import uuid
import random
import logging
import threading
from logging.handlers import RotatingFileHandler
from datetime import datetime
from typing import Optional, Dict, List

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

load_dotenv(override=False)

# ===== Azure Agents SDK (optional) ============================================
try:
    from azure.core.credentials import AccessToken, TokenCredential  # type: ignore
    from azure.ai.projects import AIProjectClient  # type: ignore
    from azure.ai.agents.models import ListSortOrder  # type: ignore
except Exception:
    # Keep server bootable even if SDK isn't installed or env not set
    AccessToken = None          # type: ignore
    TokenCredential = None      # type: ignore
    AIProjectClient = None      # type: ignore
    ListSortOrder = None        # type: ignore

# ===== Env ====================================================================
HITACHI_RED      = os.getenv("HITACHI_RED", "#E60027")

PROJECT_ENDPOINT = os.getenv("PROJECT_ENDPOINT")   # https://<acct>.services.ai.azure.com/api/projects/<project>
AGENT_ID         = os.getenv("AGENT_ID")
AGENT_TOKEN      = os.getenv("AGENT_TOKEN")        # Optional static token (fast in dev)

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

# ===== Sessions (in-memory MVP) ==============================================
SESSION_COOKIE = "harci_sid"

class Session(BaseModel):
    sid: str
    name: str
    company: str
    created_at: datetime
    last_active: datetime
    active: bool = True
    agent_thread_id: str = ""

SESSIONS: Dict[str, Session] = {}

def new_sid() -> str:
    return uuid.uuid4().hex

def touch_sid(sid: str):
    s = SESSIONS.get(sid)
    if s:
        s.last_active = datetime.utcnow()

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
    }

@app.get("/api/config")
async def api_config():
    return ui_cfg()

# ===== Pages ==================================================================
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    sid = request.cookies.get(SESSION_COOKIE)
    if sid and sid in SESSIONS:
        return RedirectResponse("/guide")
    return RedirectResponse("/register")

@app.get("/register", response_class=HTMLResponse)
async def page_register(request: Request):
    return templates.TemplateResponse("register.html", {"request": request, "cfg": ui_cfg()})

@app.get("/transition", response_class=HTMLResponse)
async def page_transition(request: Request):
    return templates.TemplateResponse("transition.html", {"request": request, "cfg": ui_cfg()})

@app.get("/guide", response_class=HTMLResponse)
async def page_guide(request: Request):
    sid = request.cookies.get(SESSION_COOKIE)
    return templates.TemplateResponse("guide.html", {"request": request, "cfg": ui_cfg(), "has_sid": bool(sid)})

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
    SESSIONS[sid] = Session(
        sid=sid, name=name, company=company,
        created_at=datetime.utcnow(), last_active=datetime.utcnow(), active=True
    )
    res = JSONResponse({"ok": True, "sid": sid, "next": "/transition"})
    # Not HttpOnly so client JS can read it if needed; fine for MVP
    res.set_cookie(SESSION_COOKIE, sid, httponly=False, samesite="Lax", max_age=60*60*8, path="/")
    return res

class SidBody(BaseModel):
    sid: str = ""

@app.post("/api/session/start")
async def api_session_start(body: SidBody):
    sid = body.sid or ""
    if not sid:
        raise HTTPException(400, "sid required")
    sess = SESSIONS.get(sid)
    if not sess:
        raise HTTPException(404, "Session not found")
    sess.active = True
    touch_sid(sid)
    return {"ok": True}

@app.post("/api/session/end")
async def api_session_end(body: SidBody):
    sid = body.sid or ""
    sess = SESSIONS.get(sid)
    if sess:
        sess.active = False
        touch_sid(sid)
    return {"ok": True}

# ===== Tokens (Speech + Relay) ===============================================
@app.get("/speech-token")
@app.get("/api/speech/token")  # alias
async def speech_token():
    res = _next_speech_resource()
    region, key = res["region"], res["key"]

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

    # 9 minutes is the typical TTL; be conservative
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

def _is_aca_environment() -> bool:
    """Heuristic to detect Azure Container Apps / MI or WI environments."""
    return any(k in os.environ for k in (
        "IDENTITY_ENDPOINT", "MSI_ENDPOINT", "IDENTITY_HEADER",
        "AZURE_FEDERATED_TOKEN_FILE", "AZURE_TENANT_ID"
    ))

def _build_agent_credential():
    """
    Build a DefaultAzureCredential tuned for:
      - Local Windows/dev: prefer env + Azure CLI; skip MI/WI probes (avoid timeouts)
      - Azure Container Apps: prefer Managed Identity / Workload Identity; skip CLI
    Warm a token to avoid first-call latency. Fall back to AGENT_TOKEN if present.
    """
    try:
        from azure.identity import DefaultAzureCredential  # type: ignore
    except Exception as e:
        log.warning("azure-identity not installed: %s", e)
        if AGENT_TOKEN and AccessToken is not None:
            class StaticTokenCredential:
                def get_token(self, *scopes, **kwargs):
                    return AccessToken(AGENT_TOKEN, int(time.time()) + 50 * 60)
            return StaticTokenCredential()
        raise

    in_aca = _is_aca_environment()
    try:
        cred = DefaultAzureCredential(
            exclude_managed_identity_credential=not in_aca,
            exclude_workload_identity_credential=not in_aca,
            exclude_environment_credential=False,
            exclude_azure_cli_credential=in_aca,
            exclude_developer_cli_credential=True,
            exclude_visual_studio_code_credential=True,
            exclude_powershell_credential=True,
            exclude_shared_token_cache_credential=True,
            exclude_interactive_browser_credential=True,
        )
        # Warm once so the first Agents call isn't stuck on token acquisition.
        cred.get_token("https://cognitiveservices.azure.com/.default")
        return cred
    except Exception as e:
        log.warning("DefaultAzureCredential failed to get token: %s", e)

    # Dev fallback if provided
    if AGENT_TOKEN and AccessToken is not None:
        class StaticTokenCredential:
            def get_token(self, *scopes, **kwargs):
                return AccessToken(AGENT_TOKEN, int(time.time()) + 50 * 60)
        return StaticTokenCredential()

    raise RuntimeError("No usable Azure credential found (and no AGENT_TOKEN).")

def _get_client_and_agent():
    """Create/cached AIProjectClient + Agent lazily and thread-safely."""
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
        _CREDENTIAL = _build_agent_credential()
        client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=_CREDENTIAL)
        agent = client.agents.get_agent(AGENT_ID)
        _PROJECT_CLIENT, _AGENT_OBJ = client, agent
        return client, agent

# ===== Helpers for parsing agent replies ======================================
def _extract_text(msg):
    """Best-effort to extract a text string from an agent message object."""
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
    """Parse the agent's JSON-ish payload, with markdown fences tolerated."""
    s2 = (s or "").strip()
    if s2.startswith("```"):
        fence = "```json" if s2.lower().startswith("```json") else "```"
        s2 = s2[len(fence):].strip()
        if s2.endswith("```"):
            s2 = s2[:-3].strip()
    try:
        return json.loads(s2)
    except Exception:
        # Fall back to narration-only
        return {"narration": s, "briefing_md": "", "image": None}

# ===== Assist endpoint ========================================================
@app.post("/assist/run")
async def assist_run(req: Request, body: dict = Body(default={})):
    """
    Invoke the Azure Agent with the given text.
    - One thread per session (context preserved).
    - Poll run status quickly to reduce latency.
    - Fetch the latest agent message(s) without using unsupported 'after' filter.
    """
    text = (body.get("text") or "").strip()
    sid  = body.get("session_id") or req.cookies.get(SESSION_COOKIE)

    # Fallback demo path (if agent not configured or SDK missing)
    if not agent_config_ok() or AIProjectClient is None:
        topic = text or "Welcome"
        return JSONResponse({
            "narration": f"{topic}: Here's what you need to know for the HARC AI Launch.",
            "briefing_md": (
                f"### {topic}\n"
                f"- Venue: Hall A (Ground Floor)\n"
                f"- Time: 10:00–17:00\n"
                f"- Tip: Use the quick chips (Agenda, Venue Map, Speakers, Help)\n"
            ),
            "image": {"url": "/static/assets/venue-map.png", "alt": "Venue map"}
        })

    try:
        project, agent = _get_client_and_agent()

        # Thread per session
        sess = SESSIONS.get(sid) if sid else None
        thread_id = getattr(sess, "agent_thread_id", None) or ""
        if not thread_id:
            thread = project.agents.threads.create()
            thread_id = thread.id
            if sess:
                sess.agent_thread_id = thread_id

        # Create user message (remember id)
        user_msg = project.agents.messages.create(
            thread_id=thread_id, role="user", content=text
        )

        # Start run and poll quickly (reduce latency)
        run = project.agents.runs.create(thread_id=thread_id, agent_id=agent.id)
        deadline = time.time() + 30.0  # 30s safety ceiling
        while run.status not in ("completed", "failed") and time.time() < deadline:
            time.sleep(0.25)  # 250ms poll
            run = project.agents.runs.get(thread_id=thread_id, run_id=run.id)

        if run.status == "failed":
            log.error("Agent run failed: %s", run.last_error)
            return JSONResponse(
                {"narration": "Agent run failed.", "briefing_md": f"### Error\n- {run.last_error}"},
                status_code=500
            )

        # ---- List messages WITHOUT 'after' (SDK 1.1.0 doesn't support it) ----
        list_kwargs = {"thread_id": thread_id, "limit": 16}
        if ListSortOrder is not None:
            list_kwargs["order"] = ListSortOrder.ASCENDING  # optional in this SDK
        msgs = project.agents.messages.list(**list_kwargs)

        out_payload = None

        # Prefer reply from THIS run (if run_id is present)
        latest_any = None
        for m in msgs:
            role_name = str(getattr(getattr(m, "role", None), "name", "")).lower()
            if role_name != "agent":
                continue
            if getattr(m, "run_id", None) and str(m.run_id) == str(run.id):
                txt = _extract_text(m)
                if txt:
                    out_payload = _parse_payload(txt)
                    break
            latest_any = m  # keep newest agent we see in this iteration order

        # Fallback: newest agent message we saw
        if out_payload is None and latest_any is not None:
            txt = _extract_text(latest_any)
            if txt:
                out_payload = _parse_payload(txt)

        return JSONResponse(out_payload or {"narration": "No agent reply found.", "briefing_md": "", "image": None})
    except Exception:
        log.exception("assist_run agent SDK error")
        return JSONResponse({
            "narration": "I couldn’t reach the agent service just now. Here’s a quick brief.",
            "briefing_md": f"### {text or 'Info'}\n- The service is temporarily unavailable.\n- Please try again in a moment.",
        }, status_code=200)
