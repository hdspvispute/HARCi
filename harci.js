// HARCi – Fixed panels; only transcript scrolls. Latest message on TOP. (No live bubble)

let peerConnection;
let avatarSynthesizer;
let recognizer; // STT

const $ = (id) => document.getElementById(id);
const set = (id, text, cls) => { const el = $(id); if (!el) return; el.textContent = text; el.className = cls || ""; };
const cfg = () => window.HARCI_CONFIG || {};

function logStatus(s){ set("statStatus", s); console.log("[HARCi]", s); }
function setIce(s){ set("statIce", s||"-", s==="connected"?"ok":(s==="failed"?"err":"")); }
function setPc(s){ set("statPc", s||"-", s==="connected"?"ok":(s==="failed"?"err":"")); }

function addMsg(role, text){
  const t = $("transcript");
  const row = document.createElement("div");
  row.className = "msg " + (role==="user"?"user":"bot");
  const who = document.createElement("div"); who.className="who"; who.textContent = role==="user"?"You":"HARCi";
  const bubble = document.createElement("div"); bubble.className="bubble"; bubble.textContent = text;
  row.appendChild(who); row.appendChild(bubble);
  t.insertBefore(row, t.firstChild || null);
  t.scrollTop = 0;
}

function bindUI(){
  $("btnStart").onclick = start;
  $("btnStop").onclick  = stop;
  $("btnMic").onclick   = micOnce;
  $("btnSend").onclick  = () => talk(($("spokenText").value || "").trim());
  $("spokenText").addEventListener("keydown", (e)=>{
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnSend").click(); }
  });
  logStatus("ready");
}
window.addEventListener("DOMContentLoaded", bindUI);

async function start(){
  try{
    const c = cfg();
    logStatus("starting…");

    const tokRes = await fetch(c.backendBase + c.speechTokenPath);
    if (!tokRes.ok) throw new Error(`speech-token HTTP ${tokRes.status}`);
    const tok = await tokRes.json();
    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tok.token, tok.region||c.region);

    const vf = new SpeechSDK.AvatarVideoFormat();
    const avatarConfig = new SpeechSDK.AvatarConfig(c.character, c.style, vf);
    avatarConfig.backgroundColor = "#FFFFFFFF";

    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
    avatarSynthesizer.avatarEventReceived = (_, e) => console.log("[HARCi] AvatarEvent:", e.description);

    const relayRes = await fetch(c.backendBase + c.relayPath);
    if (!relayRes.ok) throw new Error(`relay-token HTTP ${relayRes.status}`);
    const relay = await relayRes.json();
    await setupWebRTC(relay.Urls[0], relay.Username, relay.Password);

    $("btnMic").disabled = false;
    $("btnStop").disabled = false;
    $("btnSend").disabled = false;
    logStatus("connected");
  }catch(e){
    console.error(e);
    alert("Failed to start: " + e.message);
    logStatus("error");
  }
}

async function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential){
  const iceServers = [{ urls:[iceServerUrl], username: iceServerUsername, credential: iceServerCredential }];
  peerConnection = new RTCPeerConnection({ iceServers });
  peerConnection.oniceconnectionstatechange = () => setIce(peerConnection.iceConnectionState);
  peerConnection.onconnectionstatechange    = () => setPc(peerConnection.connectionState);

  peerConnection.ontrack = (ev) => {
    const wrap = $("remoteVideo");
    [...wrap.childNodes].forEach(n => n.localName === ev.track.kind && wrap.removeChild(n));
    const el = document.createElement(ev.track.kind);
    el.autoplay = true; el.playsInline = true; el.srcObject = ev.streams[0];
    if (ev.track.kind === "audio") el.muted = false;
    wrap.appendChild(el);
  };

  peerConnection.addTransceiver("video", { direction: "recvonly" });
  peerConnection.addTransceiver("audio", { direction: "recvonly" });

  const r = await avatarSynthesizer.startAvatarAsync(peerConnection);
  if (r.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted){
    const cd = SpeechSDK.CancellationDetails.fromResult(r);
    throw new Error(cd?.errorDetails || "Avatar start failed");
  }
}

function speak(text){
  const c = cfg();
  const voice = c.voice || "en-US-AvaMultilingualNeural";
  const content = text || $("spokenText").value || "";
  if (!content) return;
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>` +
    `<voice name='${voice}'><mstts:leadingsilence-exact value='0'/>${escapeHtml(content)}</voice></speak>`;
  avatarSynthesizer.speakSsmlAsync(ssml).catch((e)=>console.error("speak error", e));
}

function stop(){
  try{ avatarSynthesizer?.close(); }catch{}
  try{ peerConnection?.close(); }catch{}
  $("btnMic").disabled = true;
  $("btnStop").disabled = true;
  $("btnSend").disabled = true;
  logStatus("idle");
}

function escapeHtml(text){
  const map = {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;","/":"&#x2F;"};
  return String(text).replace(/[&<>"'\/]/g, s=>map[s]);
}

async function talk(query){
  const q = (query||"").trim();
  if (!q) return;
  addMsg("user", q);
  $("spokenText").value = "";
  const c = cfg();
  try{
    const res = await fetch(c.backendBase + c.askPath, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ question: q })
    });
    let answer = "I don’t have that information yet.";
    if (res.ok){
      const data = await res.json();
      if (data && data.answer) answer = data.answer;
    }
    addMsg("bot", answer);
    speak(answer);
  }catch(err){
    console.error(err);
    addMsg("bot", "Sorry, I’m having trouble answering at the moment.");
  }
}

async function micOnce(){
  const c = cfg();
  try{
    const tokRes = await fetch(c.backendBase + c.speechTokenPath);
    if (!tokRes.ok) throw new Error(`speech-token HTTP ${tokRes.status}`);
    const tok = await tokRes.json();

    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tok.token, tok.region||c.region);
    speechConfig.speechRecognitionLanguage = "en-US";
    const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

    $("btnMic").textContent = "🎙 Listening…";
    recognizer.recognizeOnceAsync(
      result => {
        $("btnMic").textContent = "🎙 Speak";
        const text = result.text || "";
        if (text){ $("spokenText").value = text; talk(text); }
        recognizer.close();
      },
      err => {
        console.error("STT error:", err);
        $("btnMic").textContent = "🎙 Speak";
        recognizer && recognizer.close();
      }
    );
  }catch(e){
    console.error(e);
    $("btnMic").textContent = "🎙 Speak";
  }
}

window.addEventListener("DOMContentLoaded", bindUI);
