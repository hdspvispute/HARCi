# ...
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend + UI
COPY server.py .
COPY kb.txt ./
COPY harci_event.html .
COPY harci.js .

EXPOSE 8000
CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "-w", "2", "-b", "0.0.0.0:8000", "server:app"]
