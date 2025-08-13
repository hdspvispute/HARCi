import os, requests, re, json
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response


# ===== Azure Speech Secrets=====
SPEECH_REGION = os.getenv("SPEECH_REGION")
SPEECH_KEY = os.getenv("SPEECH_KEY")

# ===== Azure OpenAI =====
AOAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AOAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AOAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT")
AOAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

# ===== KB file path =====
KB_PATH = os.getenv("HARCI_KB_PATH", "kb.txt")

# ===== Validation =====
missing = []
if not SPEECH_REGION: missing.append("SPEECH_REGION")
if not SPEECH_KEY: missing.append("SPEECH_KEY (use ACA secret)")
if not AOAI_ENDPOINT: missing.append("AZURE_OPENAI_ENDPOINT")
if not AOAI_API_KEY: missing.append("AZURE_OPENAI_API_KEY (use ACA secret)")
if not AOAI_DEPLOYMENT: missing.append("AZURE_OPENAI_DEPLOYMENT")

if missing:
    raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5500", "http://127.0.0.1:5500", "*"
    ],  # tighten for prod
    allow_methods=["GET","POST","OPTIONS","WEBSOCKET"],
    allow_headers=["*"],
)

# Health endpoint for probes
@app.get("/healthz")
def healthz():
    return {"ok": True}

# Serve static files (JS, images) under /static
# We'll keep the HTML at root for a clean URL.
app.mount("/static", StaticFiles(directory=".", html=False), name="static")

# Root route serves the event page
@app.get("/")
def index():
    # Cache lightly to reduce cold starts; adjust as you like
    return FileResponse("harci_event.html", headers={"Cache-Control": "public, max-age=60"})

def load_kb():
    try:
        with open(KB_PATH, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""

# ---------- Avatar / Speech tokens ----------
@app.get("/relay-token")
def relay_token():
    if not SPEECH_KEY:
        raise HTTPException(500, "SPEECH_KEY not configured")
    url = f"https://{SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1"
    r = requests.get(url, headers={"Ocp-Apim-Subscription-Key": SPEECH_KEY}, timeout=10)
    if not r.ok:
        raise HTTPException(r.status_code, f"Azure error {r.status_code}: {r.text}")
    return r.json()

@app.get("/speech-token")
def speech_token():
    if not SPEECH_KEY:
        raise HTTPException(500, "SPEECH_KEY not configured")
    url = f"https://{SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    r = requests.post(url, headers={"Ocp-Apim-Subscription-Key": SPEECH_KEY}, timeout=10)
    if not r.ok:
        raise HTTPException(r.status_code, f"Token issue failed: {r.text}")
    return {"token": r.text, "region": SPEECH_REGION}

# ---------- Legacy one-shot Q&A ----------
class AskBody(BaseModel):
    question: str

@app.post("/ask")
def ask(body: AskBody):
    if not (AOAI_ENDPOINT and AOAI_API_KEY and AOAI_DEPLOYMENT):
        raise HTTPException(500, "Azure OpenAI not configured (AZURE_OPENAI_* env vars)")
    kb = load_kb()
    if not kb:
        return {"answer":"I don't have the event brief loaded yet. Please check back shortly."}

    system_prompt = (
        "You are HARCi, HITACHI's event concierge. Professional, concise, and neutral tone. "
        "Answer ONLY using the provided context. If the answer is not in context, say: "
        "\"I don’t have that information yet.\" Do not mention browsing the internet."
    )
    context = kb[:120000]
    url = f"{AOAI_ENDPOINT}/openai/deployments/{AOAI_DEPLOYMENT}/chat/completions?api-version={AOAI_API_VERSION}"
    payload = {
        "temperature": 0.2,
        "messages":[
            {"role":"system", "content": system_prompt},
            {"role":"system", "content": f"Context:\n{context}"},
            {"role":"user",   "content": body.question.strip()}
        ]
    }
    r = requests.post(url, headers={"api-key": AOAI_API_KEY, "Content-Type":"application/json"}, json=payload, timeout=30)
    if not r.ok:
        raise HTTPException(r.status_code, f"AOAI error {r.status_code}: {r.text}")
    data = r.json()
    try:
        answer = data["choices"][0]["message"]["content"].strip()
        answer = re.sub(r"\s+\n", "\n", re.sub(r"\s{2,}", " ", answer))
    except Exception:
        answer = "I don’t have that information yet."
    return {"answer": answer}

# ---------- Realtime-ish streaming over WebSocket ----------
# Browser sends: {"type":"user","text":"..."}
# Server streams back: {"type":"delta","text":"..."} and finally {"type":"done"}
@app.websocket("/rt/chat")
async def rt_chat(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                if not isinstance(data, dict) or data.get("type") != "user":
                    await ws.send_text(json.dumps({"type":"error","message":"Expected {'type':'user','text':...}"}))
                    continue
                user_text = (data.get("text") or "").strip()
                if not user_text:
                    await ws.send_text(json.dumps({"type":"error","message":"Empty text"}))
                    continue
            except Exception as e:
                await ws.send_text(json.dumps({"type":"error","message":f"Bad JSON: {e}"}))
                continue

            kb = load_kb()
            context = kb[:120000] if kb else ""
            system_prompt = (
                "You are HARCi, Hitachi’s on-site AI concierge for the HARC AI Launch. "
                "Your speaking style is energetic, warm, and confident—like a great conference host. "
                "You’re an expert in AI/ML operations, SRE, and reliability, and comfortable with executives. "
                "Use short sentences, natural contractions, and simple words. "
                "Lead with the answer in 1–2 sentences, then offer a helpful follow-up. "
                "Optionally end with a brief question to keep the conversation moving. "
                "Never invent facts. Answer ONLY using the provided context. "
                "If the answer isn’t in context, say: “I don’t have that information yet.” "
                "Do not mention browsing the internet or external sources."
            )

            url = f"{AOAI_ENDPOINT}/openai/deployments/{AOAI_DEPLOYMENT}/chat/completions?api-version={AOAI_API_VERSION}"
            payload = {
                "temperature": 0.2,
                "stream": True,
                "messages":[
                    {"role":"system", "content": system_prompt},
                    {"role":"system", "content": f"Context:\n{context}"},
                    {"role":"user",   "content": user_text}
                ]
            }
            try:
                with requests.post(url, headers={"api-key": AOAI_API_KEY, "Content-Type":"application/json"},
                                   json=payload, stream=True, timeout=60) as r:
                    if not r.ok:
                        await ws.send_text(json.dumps({"type":"error","message":f"AOAI HTTP {r.status_code}"}))
                    else:
                        buffer = []
                        for raw in r.iter_lines(decode_unicode=True):
                            if not raw:
                                continue
                            line = raw[6:] if raw.startswith("data: ") else raw
                            if line == "[DONE]":
                                if buffer:
                                    await ws.send_text(json.dumps({"type":"delta","text":"".join(buffer)}))
                                    buffer = []
                                await ws.send_text(json.dumps({"type":"done"}))
                                break
                            try:
                                j = json.loads(line)
                                delta = j.get("choices",[{}])[0].get("delta",{}).get("content")
                                if delta:
                                    buffer.append(delta)
                                    if len("".join(buffer)) >= 120 or delta.endswith((".", "!", "?")):
                                        await ws.send_text(json.dumps({"type":"delta","text":"".join(buffer)}))
                                        buffer = []
                            except Exception:
                                pass
                        if buffer:
                            await ws.send_text(json.dumps({"type":"delta","text":"".join(buffer)}))
                            await ws.send_text(json.dumps({"type":"done"}))
            except Exception as e:
                await ws.send_text(json.dumps({"type":"error","message":str(e)}))
    except WebSocketDisconnect:
        return
