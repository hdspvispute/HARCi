az account get-access-token `
  --resource https://ai.azure.com `
  --query accessToken `
  --output tsv


  await HARCI_AVATAR.speak("Hello from the avatar. This should be audible.");


  Awesome—here’s a crisp, end-to-end requirements spec you can hand to your team.

1) Product Overview

HARCi is a mobile-first, kiosk-friendly, voice-guided event concierge for the HARC AI Launch. Guests scan a QR at the entrance, register (once), and land on an Avatar Guide that speaks answers, shows relevant images, and renders a short text briefing. The system integrates:

Azure Agents Service (knowledge + reasoning; returns JSON with narration, briefing, optional image)

Azure Speech Service (avatar WebRTC stream and text-to-speech)

Thin Python backend (tokens, session, agent proxy)

Static, professional UI (Hitachi brand)

2) Core User Flows
2.1 First-time flow

Scan QR → Landing

Registration (Name, Company) → POST /api/register

Transition screen while avatar initializes (animated loader + “HARCi is booting…”)

Guide screen with avatar, quick chips (Agenda, Venue Map, Speakers, Help), mic hold-to-talk.

2.2 Returning user

Scan QR → server checks cookie/session → skip registration

Transition (fast) if avatar not ready → Guide

2.3 Guidance interactions

Quick chips send pre-baked prompts (e.g., “Agenda”).

Hold-to-talk mic: captures speech only while pressed, sends transcription to agent.

Agent response:

Narration → avatar speaks

Briefing (markdown-lite) → right panel

Image (url, alt) → displayed in panel

2.4 Idle & End

Idle (45s): show subtle dim/“Tap to talk” state.

Auto end (long idle or user taps End Session): navigate to End page with “Talk to HARCi” button to restart.

3) UI Requirements
3.1 Pages

Register:

Brand header, short intro, fields (Name*, Company*), privacy note.

Submit → /api/register (200 → Transition; 4xx shows inline error).

Transition:

Branded full-screen animation.

Rotating tips (“Ask me for the agenda”, “Find a session room”…).

Moves on when both Speech token & Avatar relay token obtained.

Guide:

Left: Avatar video, status chip, hold-to-talk mic button (+ earcon), end button.

Right: Briefing panel (markdown-lite), image panel (if present).

Quick chips row: Agenda, Venue Map, Speakers, Help.

Accessibility: caption area for utterances.

Ended:

“Session ended” text, “Talk to HARCi” CTA returns to Transition → Guide.

3.2 Visual & Branding

Hitachi red (#E60027) accents, dark neutral background.

Clean type, large tappable targets, rounded chips.

Motion: smooth transitions (200–300ms), loader animation in Transition.

3.3 Interaction Details

Mic (press & hold):

Press: request mic permission (if needed), state “Listening…”, earcon start.

Release: stop listening, earcon stop, send transcription to agent.

Show speech state text near the button.

Quick chips: disabled while awaiting response; optimistic spinner.

Avatar: auto-start on entering Guide; retries on ICE failure (see NFRs).

4) System Architecture
4.1 Frontend (static, no framework required)

HTML templates (Jinja), Tailwind-compiled CSS or handcrafted CSS.

JS modules:

logger.js – console + memory log, log levels.

stt.js – Azure Speech SDK recognizer (hold-to-talk).

avatar_rtc.js – WebRTC avatar (Azure Relay TURN + Synthesizer).

api.js – /assist/run helper.

ui_bindings.js – wire controls, apply responses.

idle.js – idle detection.

4.2 Backend (Python)

REST endpoints:

GET / → redirect to /register or /guide.

GET /register, POST /api/register

GET /transition, GET /guide, GET /ended

POST /api/session/start – initialize per-user state (cookie/session id).

GET /speech-token – short-lived Azure Speech token { token, region }.

GET /relay-token – avatar relay TURN { Urls[], Username, Password }.

POST /assist/run – proxy to Azure Agents:

Input: { text, session_id? }

Output: { narration, briefing_md, image: {url, alt}? }

Config via .env:

PROJECT_ENDPOINT, AGENT_ID, AGENT_TOKEN (bearer, refreshed externally)

SPEECH_REGION, SPEECH_KEY (for token issuance)

AVATAR_ID, AVATAR_STYLE, SPEECH_LANG, SPEECH_VOICE

LOG_LEVEL (DEBUG|INFO|WARN|ERROR)

Sessions: cookie with user id; minimal server state (in-memory for MVP).

4.3 Integrations

Azure Agents Service:

Create thread → post user message → run → poll → list agent messages → parse agent JSON payload.

Azure Speech Service:

Token endpoint for browser SDK (STT & TTS).

Relay/TURN for WebRTC (avatar stream).

AvatarSynthesizer with enableWebrtc() → createAvatarWebRTCConnection(pc).

5) Functional Requirements

Registration & Session

Validate required fields; set cookie; skip on return.

Avatar Boot

Obtain relay & speech tokens; start WebRTC; attach audio/video tracks; autoplay audio.

Voice Input (Hold-to-talk)

Start recognizer on press; stop on release; single final text per press.

Agent Query

Send transcript/chip text; handle timeouts/retries; show errors inline & as toast.

Response Rendering

Speak narration via avatar.

Render briefing (paragraphs, line breaks).

Show image if provided (with alt).

Quick Actions

Agenda / Venue Map / Speakers / Help are one-tap prompts.

Idle & End

45s idle class; end session by long idle or explicit button; show ended page with restart CTA.

Earcons

Start/stop sounds on mic press/release (default system-like chimes).

6) Non-Functional Requirements

Performance

First paint < 2s on 4G; avatar connect < 5s median.

JS bundle small; defer non-critical scripts.

Resilience

Token issuance retries with backoff.

WebRTC ICE retry: fallback to iceTransportPolicy: 'relay' if disconnected/failed.

Network error toasts; graceful degrade (text only if avatar down).

Security

HTTPS only; CORS (MVP permissive per your note), sanitize text for rendering.

No secrets in client; speech tokens short-lived; bearer token not exposed.

Privacy

Minimal PII (name/company); retention policy; privacy copy on register.

Accessibility

Semantic landmarks; aria labels; focus states; caption area for narration; color contrast WCAG AA.

Observability

Client console logs with level; server structured logs to file.

Correlate by session id; log key milestones (register, session/start, tokens, ICE state, speak).

Compatibility

Mobile Safari/Chrome; Chrome desktop; kiosk mode compatible.

Maintainability

Clear file structure; .env driven; no framework lock-in for MVP.

Internationalization (nice-to-have)

Configurable SPEECH_LANG & SPEECH_VOICE; UI copy in dictionary.

7) API Contracts (concise)
7.1 /assist/run (POST)

Request:
{ "text": "Where is keynote?", "session_id": "abc123" }

Response:

{
  "narration": "The keynote starts at 10:00 in Hall A.",
  "briefing_md": "### Keynote\n- Time: 10:00\n- Location: Hall A",
  "image": { "url": "https://…/hall-a.png", "alt": "Map to Hall A" }
}


Errors: 429, 5xx → { error: "message" }.

7.2 /speech-token (GET)

Response: { "token": "<short-lived>", "region": "<region>" }

7.3 /relay-token (GET)

Response: { "Urls": ["turn:…","turns:…"], "Username":"…", "Password":"…" }

8) Configuration & Environments

.env

PROJECT_ENDPOINT=https://<acct>.services.ai.azure.com/api/projects/<project>

AGENT_ID=asst_…

AGENT_TOKEN (refreshed via Azure CLI)

SPEECH_REGION=eastus2

SPEECH_KEY=***

AVATAR_ID=lisa

AVATAR_STYLE=casual-sitting

SPEECH_LANG=en-US

SPEECH_VOICE=en-US-JennyNeural

LOG_LEVEL=INFO

Build

Optional Tailwind CLI for production CSS; otherwise prebuilt CSS file.

9) Acceptance Criteria

Registration persists and is skipped on return within same browser.

Guide loads with avatar; audio plays without manual unmute.

Mic (hold) yields one recognized final text per press and sends to agent.

Chips produce responses: narration audible, briefing & image visible.

Idle triggers visual state; End page accessible and restart works.

Logs show: loglevel, token OK, pc ICE/state transitions, speak success, API timings.

10) Testing Plan

Unit: API handlers (200/4xx/5xx), JSON shape validation.

Integration: end-to-end assist flow with a stub agent; speech token mock.

Manual: real device matrix (iOS Safari, Android Chrome, Windows Chrome).

Network: throttle profiles; offline/airplane mode behavior.

Edge: deny mic permission path; image missing; long narration; agent timeout.

11) Operational Runbook

Pre-event: verify AGENT_TOKEN validity; health check /guide on venue Wi-Fi; confirm TURN reachability (force iceTransportPolicy: 'relay' if needed).

Monitor: tail server logs; console live via DevTools on a staging device.

Refresh: rotate AGENT_TOKEN (CLI) every ~45–60 min if needed; restart server if avatar stalls.

12) Future Enhancements (post-MVP)

Analytics (popular intents, dwell time), multilingual UI, speaker cards, live schedule feed, push updates/toasts, offline fallback for map, registration pre-fill via invite link.