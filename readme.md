# HARCi (HARC AI Launch Demo)

## Run

### 1) Backend (FastAPI)
```bash
python -m venv .venv
.venv\Scripts\activate   # on Windows
pip install fastapi uvicorn requests
set SPEECH_REGION=eastus2
set SPEECH_KEY=<YOUR_SPEECH_KEY>
set AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
set AZURE_OPENAI_API_KEY=<YOUR_AOAI_KEY>
set AZURE_OPENAI_DEPLOYMENT=gpt-4o
uvicorn server:app --reload --port 8000
