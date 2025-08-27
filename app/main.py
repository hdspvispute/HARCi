import os, json, time, uuid, random, logging, threading, asyncio
# Ensure Azure CLI path is set for Windows
if os.name == "nt":
    os.environ["AZURE_CLI_PATH"] = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
from datetime import datetime
from typing import Optional, Dict, List
from pathlib import Path

import httpx
from fastapi import FastAPI, Request, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from starlette.templating import Jinja2Templates
from dotenv import load_dotenv
from fastapi import Body

load_dotenv(override=False)

# === Azure Agents SDK (only used if AGENT_TOKEN present) ===
try:
    from azure.core.credentials import AccessToken, TokenCredential
    from azure.ai.projects import AIProjectClient
    from azure.ai.agents.models import ListSortOrder
except Exception:
    # Keep server bootable even if the SDK isn't installed
    AccessToken = TokenCredential = AIProjectClient = ListSortOrder = None  # type: ignore


# ==== Env ====
HITACHI_RED     = os.getenv("HITACHI_RED", "#E60027")

PROJECT_ENDPOINT = os.getenv("PROJECT_ENDPOINT")  # e.g. https://<acct>.services.ai.azure.com/api/projects/<project>
AGENT_ID         = os.getenv("AGENT_ID")
AGENT_TOKEN      = os.getenv("AGENT_TOKEN")       # Fallback for local/dev use

SPEECH_REGION    = os.getenv("SPEECH_REGION")
SPEECH_KEY       = os.getenv("SPEECH_KEY")
SPEECH_RESOURCES = (os.getenv("SPEECH_RESOURCES") or "").strip()  # optional JSON: [{"region":"eastus2","key":"..."}]

# Optional TURN/relay override (if you have a TURN service handy)
RELAY_URLS      = os.getenv("RELAY_URLS", "")     # comma-separated turn: / turns: urls
RELAY_USERNAME  = os.getenv("RELAY_USERNAME", "")
RELAY_PASSWORD  = os.getenv("RELAY_PASSWORD", "")

AVATAR_ID        = os.getenv("AVATAR_ID", "lisa")
AVATAR_STYLE     = os.getenv("AVATAR_STYLE", "casual-sitting")
SPEECH_LANG      = os.getenv("SPEECH_LANG", "en-US")
SPEECH_VOICE     = os.getenv("SPEECH_VOICE", "en-US-JennyNeural")

LOG_LEVEL        = os.getenv("LOG_LEVEL", "INFO").upper()

logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO),
                    format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
log = logging.getLogger("harci")


def agent_config_ok() -> bool:
    return bool(PROJECT_ENDPOINT and AGENT_ID)



# ==== App and static/templates ====
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

_app_root = Path(__file__).resolve().parent      # .../harci/app
_static_dir = _app_root / "static"
_templates_dir = _app_root / "templates"
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")
templates = Jinja2Templates(directory=str(_templates_dir))

# ==== Sessions (in-memory MVP) ====
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

# ==== Speech resource pool ====
_pool: List[Dict[str, str]] = []
_pool_idx = 0
_pool_lock = threading.Lock()

def _init_pool():
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

# ==== UI config ====
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

# ==== Pages ====
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

# ==== Registration + session ====
@app.post("/api/register")
async def api_register(name: str = Form(...), company: str = Form(...)):
    name = (name or "").strip()
    company = (company or "").strip()
    if not name or not company:
        raise HTTPException(400, "Name and Company are required")
    sid = new_sid()
    SESSIONS[sid] = Session(sid=sid, name=name, company=company,
                            created_at=datetime.utcnow(), last_active=datetime.utcnow(), active=True)
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

# ==== Tokens (Speech + Relay) ====
# -------------------------
# Tokens (Speech + Relay)
# -------------------------
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
    # pick a speech resource just like you do for /speech-token
    res = _next_speech_resource()
    region, key = res["region"], res["key"]
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"Ocp-Apim-Subscription-Key": key})
        if r.status_code == 200:
            # Example successful body: { "Urls": ["turn:...", "turns:..."], "Username": "...", "Password": "..." }
            return r.json()
        raise HTTPException(r.status_code, f"Relay token error {r.status_code}: {r.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Relay token request failed: {e}")

# ---- Assist proxy with fallback ----
from fastapi import Body
from fastapi.responses import JSONResponse

@app.post("/assist/run")
async def assist_run(req: Request, body: dict = Body(default={})):
    text = (body.get("text") or "").strip()
    sid  = body.get("session_id") or req.cookies.get(SESSION_COOKIE)

    # Fallback: if agent config is missing, return a dummy response
    if not (PROJECT_ENDPOINT and AGENT_ID):
        log.warning("assist_run: missing agent config; serving dummy response")
        topic = text or "Welcome"
        demo = {
            "narration": f"{topic}: Here's what you need to know for the HARC AI Launch.",
            "briefing_md": (
                f"### {topic}\n"
                f"- Venue: Hall A (Ground Floor)\n"
                f"- Time: 10:00–17:00\n"
                f"- Tip: Use the quick chips (Agenda, Venue Map, Speakers, Help)\n"
            ),
            "image": {
                "url": "/static/assets/venue-map.png",
                "alt": "Venue map"
            }
        }
        return JSONResponse(demo)

    # Live path: use Azure Agents SDK (sync, but safe for FastAPI threadpool)
    try:
        # --- Credential resolution (DefaultAzureCredential, else AGENT_TOKEN) ---
        from azure.identity import DefaultAzureCredential
        from azure.core.credentials import TokenCredential  # used for StaticTokenCredential
        cred = None
        try:
            cred = DefaultAzureCredential()
            _ = cred.get_token("https://cognitiveservices.azure.com/.default")
        except Exception as e:
            log.warning("DefaultAzureCredential unavailable: %s", e)
            cred = None
        if not cred and AGENT_TOKEN:
            class StaticTokenCredential(TokenCredential):
                def get_token(self, *scopes, **kwargs):
                    from azure.core.credentials import AccessToken
                    token = AGENT_TOKEN
                    return AccessToken(token, int(time.time()) + 50 * 60)
            cred = StaticTokenCredential()
        if not cred:
            raise Exception("No valid Azure credential or AGENT_TOKEN found.")

        # --- Project/Agent bootstrap ---
        from azure.ai.projects import AIProjectClient
        project = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=cred)
        agent = project.agents.get_agent(AGENT_ID)

        # --- Session/thread management ---
        sess = SESSIONS.get(sid) if sid else None
        thread_id = None
        if sess:
            thread_id = sess.agent_thread_id or ""
        if not thread_id:
            thread = project.agents.threads.create()
            thread_id = thread.id
            if sess:
                sess.agent_thread_id = thread_id

        # --- Post user message and run the agent ---
        user_msg = project.agents.messages.create(thread_id=thread_id, role="user", content=text)
        run = project.agents.runs.create_and_process(thread_id=thread_id, agent_id=agent.id)

        # --- Poll until the run is done (avoid returning too early) ---
        max_wait = 30  # seconds
        poll_interval = 1
        waited = 0
        while run.status not in ("completed", "failed") and waited < max_wait:
            time.sleep(poll_interval)
            waited += poll_interval
            run = project.agents.runs.get(thread_id=thread_id, run_id=run.id)

        if run.status == "failed":
            log.error("Agent run failed: %s", run.last_error)
            return JSONResponse({
                "narration": "Agent run failed.",
                "briefing_md": f"### Error\n- {run.last_error}",
            }, status_code=500)

        # ---------- Robust reply selection (no ordering assumptions) ----------
        # Helpers to extract text and parse JSON (with ```json fences tolerated)
        def _extract_text(msg):
            # Try text_messages[-1].text.value, then .text, then .content
            try:
                tms = getattr(msg, "text_messages", None) or []
                if tms:
                    last = tms[-1]
                    val = getattr(getattr(last, "text", None), "value", None)
                    if not val:
                        val = getattr(last, "text", None)
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

        # Try to use run-scoped outputs first (if available on this SDK build)
        try:
            output_ids = getattr(run, "output_messages", None) or []
        except Exception:
            output_ids = []
        if output_ids:
            # If the SDK exposes message IDs for this run, fetch those exactly.
            try:
                # Some SDKs offer a get-by-id; if not, we’ll fall back to list().
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
                            return JSONResponse(_parse_payload(txt))
            except Exception:
                pass  # fall through to list-based selection

        # List ALL messages and choose:
        # 1) the newest *agent* message whose run_id == current run.id (if present)
        # 2) else the newest *agent* message by iteration order (works for asc/desc)
        msgs = project.agents.messages.list(thread_id=thread_id)

        latest_same_run = None
        latest_any = None
        idx = 0
        for m in msgs:
            idx += 1
            role_name = str(getattr(getattr(m, "role", None), "name", "")).lower()
            if role_name != "agent":
                continue
            # Prefer messages produced by this run
            mid_run_id = getattr(m, "run_id", None)
            if mid_run_id and str(mid_run_id) == str(run.id):
                latest_same_run = (idx, m)
            # Always track latest agent we see (last wins regardless of order)
            latest_any = (idx, m)

        chosen = None
        if latest_same_run is not None:
            chosen = latest_same_run[1]
        elif latest_any is not None:
            chosen = latest_any[1]

        if chosen is not None:
            txt = _extract_text(chosen)
            if txt:
                return JSONResponse(_parse_payload(txt))

        # No agent reply found; return a neutral response
        return JSONResponse({
            "narration": "No agent reply found.",
            "briefing_md": "",
            "image": None
        }, status_code=200)

    except Exception as e:
        log.exception("assist_run agent SDK error")
        return JSONResponse(
            {
                "narration": "I couldn’t reach the agent service just now. Here’s a quick brief.",
                "briefing_md": f"### {text or 'Info'}\n- The service is temporarily unavailable.\n- Please try again in a moment.",
            },
            status_code=200
        )
