# Local RAG Setup for Mini-DeFi

This guide explains how to run a **fully local AI assistant** for Mini-DeFi using:
- **Mistral-7B-Instruct** (quantized GGUF) for text generation
- **Sentence Transformers** for embeddings
- **FAISS** for vector search

No API keys required. Runs entirely on your CPU.

## Hardware Requirements

- **CPU**: Modern multi-core (Intel 10th gen+ or AMD Ryzen recommended)
- **RAM**: 16GB minimum, 32GB recommended
- **Storage**: ~5GB for model file

## Quick Start

### 1. Download the Model

The model file should be downloaded to the `models/` folder:

```powershell
# Create models folder
New-Item -ItemType Directory -Force -Path "models"

# Download Mistral-7B-Instruct Q4_K_M (~4.4 GB)
cd models
Invoke-WebRequest -Uri "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf" -OutFile "mistral-7b-instruct-v0.2.Q4_K_M.gguf"
```

Or download manually from: https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF

### 2. Install Python Dependencies

```powershell
# Create virtual environment (optional but recommended)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements-local-rag.txt
```

### 3. Start the Local RAG Server

```powershell
# Basic start (8 threads)
python scripts/local_rag_server.py

# Custom port and threads
python scripts/local_rag_server.py --port 5000 --threads 12

# Specify model path explicitly
python scripts/local_rag_server.py --model "models/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
```

### 4. Test the API

```powershell
# Health check
Invoke-RestMethod -Uri "http://localhost:5000/health" -Method GET

# Send a chat message
$body = @{ message = "How do I deposit assets?" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:5000/chat" -Method POST -Body $body -ContentType "application/json"
```

## API Endpoints

### POST /chat
Main chat endpoint. Retrieves relevant context and generates a response.

**Request:**
```json
{
  "message": "How do I check my health factor?"
}
```

**Response:**
```json
{
  "response": "Your Health Factor is displayed in the Portfolio Overview section...",
  "sources": ["Health Factor Explained", "Liquidation"]
}
```

### POST /retrieve
Get relevant knowledge base chunks without generating a response.

**Request:**
```json
{
  "query": "liquidation",
  "top_k": 3
}
```

### GET /health
Health check endpoint.

## Performance Tuning

### Thread Count
Experiment with different thread counts to find the optimal setting for your CPU:

```powershell
# Test different thread counts
python scripts/local_rag_server.py --threads 6
python scripts/local_rag_server.py --threads 8
python scripts/local_rag_server.py --threads 12
```

General guidance:
- Start with `--threads` equal to your physical CPU cores
- Try ±2 from that baseline and measure response times
- More threads isn't always faster (can cause contention)

### Environment Variables
For fine-tuned control over parallel libraries:

```powershell
$env:OMP_NUM_THREADS = "8"
$env:MKL_NUM_THREADS = "8"
python scripts/local_rag_server.py
```

## Connecting to the Frontend

To use the local RAG server with the Mini-DeFi frontend, update `frontend/app.js`:

1. Change the chat function to call your local server instead of OpenAI
2. Point to `http://localhost:5000/chat`
3. Parse the response format

Example integration (in app.js):
```javascript
async function getLocalRAGResponse(userMessage) {
    const response = await fetch('http://localhost:5000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
    });
    const data = await response.json();
    return data.response;
}
```

## Troubleshooting

### Model not found
Ensure the model file is in `models/mistral-7b-instruct-v0.2.Q4_K_M.gguf`

### Out of memory
- Close other applications
- Try a smaller model (Q4_0 instead of Q4_K_M)
- Reduce context window in the script (n_ctx parameter)

### Slow responses
- Increase thread count (if CPU is underutilized)
- Decrease max_tokens in generate_response()
- Use a smaller model

### llama-cpp-python installation fails
On Windows, you may need Visual Studio Build Tools:
```powershell
# Install via pip with pre-built wheels
pip install llama-cpp-python --prefer-binary
```

## Model Alternatives

If Mistral-7B is too large or slow, try these alternatives:

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| Mistral-7B Q4_K_M | 4.4 GB | Medium | Best |
| Mistral-7B Q4_0 | 3.8 GB | Faster | Good |
| Phi-2 (2.7B) | 1.6 GB | Fast | Moderate |

Download links at: https://huggingface.co/TheBloke
