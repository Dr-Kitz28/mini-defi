"""
Local RAG (Retrieval-Augmented Generation) Server for Mini-DeFi
Uses Mistral-7B-Instruct (GGUF quantized) + FAISS + Sentence Transformers

This server provides a local AI assistant that:
1. Embeds your knowledge base (DeFi docs, platform info)
2. Retrieves relevant context for each query
3. Generates answers using a local LLM (no API keys needed)

Usage:
    python scripts/local_rag_server.py [--port 5000] [--threads 8]
"""

import os
import sys
import json
import argparse
from pathlib import Path

# Set thread count early (before importing numpy/torch)
def set_threads(n):
    os.environ["OMP_NUM_THREADS"] = str(n)
    os.environ["MKL_NUM_THREADS"] = str(n)
    os.environ["OPENBLAS_NUM_THREADS"] = str(n)
    os.environ["NUMEXPR_NUM_THREADS"] = str(n)

# Parse args early for thread setting
parser = argparse.ArgumentParser(description="Local RAG Server for Mini-DeFi")
parser.add_argument("--port", type=int, default=5000, help="Server port (default: 5000)")
parser.add_argument("--threads", type=int, default=8, help="CPU threads for inference (default: 8)")
parser.add_argument("--model", type=str, default=None, help="Path to GGUF model file")
args = parser.parse_args()

set_threads(args.threads)

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

# Lazy imports for heavy libraries
llm = None
embed_model = None
index = None
chunks = []
chunk_metadata = []

# ============================================================================
# Configuration
# ============================================================================

BASE_DIR = Path(__file__).parent.parent
MODEL_DIR = BASE_DIR / "models"
DOCS_DIR = BASE_DIR / "rag_docs"  # Additional documentation folder
DEFAULT_MODEL = "mistral-7b-instruct-v0.2.Q4_K_M.gguf"

# Knowledge base - platform-specific information
KNOWLEDGE_BASE = [
    {
        "title": "Platform Overview",
        "content": """Mini-DeFi is a decentralized lending platform supporting 100+ asset classes. 
Users can deposit assets to earn interest and use as collateral, borrow assets against their collateral,
manage positions across multiple assets with batch operations, and monitor their health factor to avoid liquidation."""
    },
    {
        "title": "How to Deposit",
        "content": """To deposit assets in Mini-DeFi:
1. Connect your wallet by clicking 'Connect Wallet' in the top-right corner
2. Select assets you want to deposit from the Asset Browser (left sidebar)
3. Set proportions for each asset (must total 100%)
4. Enter the total USD amount you want to deposit
5. Click 'Execute Deposit' and confirm the transaction in MetaMask
Tip: Use the 'Equalize' button to split your deposit evenly across selected assets."""
    },
    {
        "title": "How to Borrow",
        "content": """To borrow assets in Mini-DeFi:
1. First, you need deposited assets as collateral
2. Select the assets you want to borrow from the Asset Browser
3. Click the 'Borrow' tab in the Operation Panel
4. Set proportions and enter the amount you want to borrow
5. Click 'Execute Borrow' and confirm in MetaMask
Your borrowing power = Collateral Value × Collateral Factor. Keep your Health Factor above 1.0."""
    },
    {
        "title": "Health Factor Explained",
        "content": """Health Factor is a measure of your loan safety in Mini-DeFi.
Formula: Health Factor = (Total Collateral × Collateral Factor) / Total Borrows
- Above 1.5: Safe zone (green) - your position is healthy
- 1.0 to 1.5: Caution zone (yellow) - monitor closely
- Below 1.0: Liquidation risk (red) - your position can be liquidated
To improve your Health Factor: add more collateral, repay some debt, or withdraw less."""
    },
    {
        "title": "Liquidation",
        "content": """Liquidation occurs when your Health Factor drops below 1.0.
What happens during liquidation:
- Anyone can repay part of your debt on your behalf
- They receive your collateral at a discount (liquidation bonus, typically 5-10%)
- You lose collateral but your debt is reduced
To avoid liquidation: keep Health Factor above 1.5, monitor asset prices, repay debt if HF drops."""
    },
    {
        "title": "Interest Rates",
        "content": """Interest rates in Mini-DeFi are dynamic and based on utilization (borrowed/deposited ratio).
- Low utilization = Lower interest rates
- High utilization = Higher interest rates
The platform uses a kink model: rates increase gradually until a target utilization, then spike sharply.
Depositors earn interest (supply APY), Borrowers pay interest (borrow APY).
Rates adjust automatically to balance supply and demand."""
    },
    {
        "title": "Batch Operations",
        "content": """Mini-DeFi supports batch operations to save gas and time:
1. Select multiple assets in the Asset Browser (click to toggle selection)
2. Set proportion for each selected asset (must total 100%)
3. Use 'Equalize' button to split amounts evenly
4. Enter total amount and execute
This performs deposits/withdrawals/borrows/repays across all selected assets in fewer transactions."""
    },
    {
        "title": "Wallet Connection",
        "content": """To connect your wallet to Mini-DeFi:
1. Click the 'Connect Wallet' button in the top-right corner
2. Select MetaMask (or your preferred wallet) from the options
3. Approve the connection request in your wallet
Supported networks: Ethereum Mainnet, Polygon, Hardhat Local (for testing).
Make sure you're on the correct network before performing transactions."""
    },
    {
        "title": "Asset Categories",
        "content": """Mini-DeFi supports assets across multiple categories:
- USD Stablecoins: USDC, USDT, DAI, BUSD, etc. (high collateral factor)
- BTC Derivatives: WBTC, renBTC, sBTC, etc.
- ETH Derivatives: WETH, stETH, rETH, cbETH, etc.
- DeFi Tokens: AAVE, UNI, CRV, COMP, MKR, etc.
- Layer 2 Tokens: ARB, OP, MATIC, etc.
- Meme Coins: DOGE, SHIB, PEPE, etc. (lower collateral factor)
Use the category filter in the Asset Browser to find specific asset types."""
    },
    {
        "title": "Collateral Factor",
        "content": """Collateral Factor determines how much you can borrow against an asset.
Range: 50% to 85% depending on asset volatility and liquidity.
Example: If you deposit $1000 USDC with 75% collateral factor, you can borrow up to $750.
Stablecoins typically have higher collateral factors (safer), while volatile assets have lower factors.
The collateral factor is shown for each asset in the Asset Browser."""
    }
]

# System prompt for the LLM
SYSTEM_PROMPT = """You are a helpful AI assistant for Mini-DeFi, a decentralized lending platform.
Your role is to help users understand and use the platform effectively.

Use the provided context to answer questions accurately. If the context doesn't contain 
relevant information, say so honestly and provide general DeFi guidance.

Keep answers concise, friendly, and actionable. Use bullet points and numbered steps when appropriate.
If users ask about specific transactions, remind them to always verify details in their wallet before confirming."""

# ============================================================================
# RAG Components
# ============================================================================

def load_markdown_docs():
    """Load markdown documentation files from rag_docs folder."""
    docs = []
    if DOCS_DIR.exists():
        for md_file in sorted(DOCS_DIR.glob("*.md")):
            try:
                content = md_file.read_text(encoding='utf-8')
                # Split by headings for smaller chunks
                sections = []
                current_title = md_file.stem
                current_content = []
                
                for line in content.split('\n'):
                    if line.startswith('## '):
                        if current_content:
                            sections.append({
                                "title": current_title,
                                "content": '\n'.join(current_content)
                            })
                        current_title = line[3:].strip()
                        current_content = []
                    else:
                        current_content.append(line)
                
                # Add last section
                if current_content:
                    sections.append({
                        "title": current_title,
                        "content": '\n'.join(current_content)
                    })
                
                docs.extend(sections)
                print(f"[RAG] Loaded {len(sections)} sections from {md_file.name}")
            except Exception as e:
                print(f"[RAG] Warning: Failed to load {md_file}: {e}")
    return docs

def init_embedding_model():
    """Initialize the sentence transformer embedding model."""
    global embed_model
    if embed_model is None:
        from sentence_transformers import SentenceTransformer
        print("[RAG] Loading embedding model (all-MiniLM-L6-v2)...")
        embed_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        print("[RAG] Embedding model loaded.")
    return embed_model

def init_vector_store():
    """Build FAISS index from knowledge base."""
    global index, chunks, chunk_metadata
    if index is not None:
        return index
    
    import faiss
    
    print("[RAG] Building vector store from knowledge base...")
    model = init_embedding_model()
    
    # Create chunks from built-in knowledge base
    chunks = []
    chunk_metadata = []
    for doc in KNOWLEDGE_BASE:
        chunks.append(f"{doc['title']}\n{doc['content']}")
        chunk_metadata.append({"title": doc["title"], "source": "builtin"})
    
    # Also load markdown docs from rag_docs folder
    md_docs = load_markdown_docs()
    for doc in md_docs:
        content = doc['content'].strip()
        if len(content) > 50:  # Skip very short sections
            chunks.append(f"{doc['title']}\n{content}")
            chunk_metadata.append({"title": doc["title"], "source": "docs"})
    
    print(f"[RAG] Total chunks: {len(chunks)} (builtin: {len(KNOWLEDGE_BASE)}, docs: {len(md_docs)})")
    
    # Embed all chunks
    embeddings = model.encode(chunks, convert_to_numpy=True, show_progress_bar=True)
    
    # Build FAISS index
    d = embeddings.shape[1]
    index = faiss.IndexFlatIP(d)  # Inner product (cosine similarity with normalized vectors)
    faiss.normalize_L2(embeddings)
    index.add(embeddings)
    
    print(f"[RAG] Vector store built with {len(chunks)} chunks.")
    return index

def retrieve(query: str, top_k: int = 3) -> list:
    """Retrieve top-k relevant chunks for a query."""
    global index, chunks
    
    if index is None:
        init_vector_store()
    
    model = init_embedding_model()
    query_embedding = model.encode([query], convert_to_numpy=True)
    
    import faiss
    faiss.normalize_L2(query_embedding)
    
    scores, indices = index.search(query_embedding, top_k)
    
    results = []
    for i, idx in enumerate(indices[0]):
        if idx < len(chunks):
            results.append({
                "content": chunks[idx],
                "score": float(scores[0][i]),
                "metadata": chunk_metadata[idx]
            })
    
    return results

def init_llm(model_path: str = None):
    """Initialize the local LLM using ctransformers."""
    global llm
    if llm is not None:
        return llm
    
    from ctransformers import AutoModelForCausalLM
    
    # Find model file
    if model_path is None:
        model_path = MODEL_DIR / DEFAULT_MODEL
    else:
        model_path = Path(model_path)
    
    if not model_path.exists():
        print(f"[RAG] ERROR: Model not found at {model_path}")
        print(f"[RAG] Please download the model first. See README.local-rag.md for instructions.")
        sys.exit(1)
    
    print(f"[RAG] Loading LLM from {model_path}...")
    print(f"[RAG] Using {args.threads} CPU threads")
    
    # Use ctransformers with GGUF model
    llm = AutoModelForCausalLM.from_pretrained(
        str(model_path.parent),
        model_file=model_path.name,
        model_type="mistral",
        threads=args.threads,
        context_length=4096,
        gpu_layers=0  # CPU only
    )
    
    print("[RAG] LLM loaded successfully!")
    return llm

def generate_response(query: str, context_chunks: list) -> str:
    """Generate a response using the local LLM with retrieved context."""
    global llm
    
    if llm is None:
        init_llm(args.model)
    
    # Build context string
    context = "\n\n---\n\n".join([c["content"] for c in context_chunks])
    
    # Build prompt (Mistral Instruct format)
    prompt = f"""<s>[INST] {SYSTEM_PROMPT}

Context from knowledge base:
{context}

User question: {query} [/INST]"""
    
    # Generate response using ctransformers
    response = llm(
        prompt,
        max_new_tokens=512,
        temperature=0.7,
        top_p=0.9,
        stop=["</s>", "[INST]"]
    )
    
    return response.strip()

# ============================================================================
# Flask API
# ============================================================================

app = Flask(__name__)
CORS(app)

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok", "model": DEFAULT_MODEL})

@app.route("/chat", methods=["POST"])
def chat():
    """Main chat endpoint - retrieves context and generates response."""
    data = request.get_json()
    query = data.get("message", "").strip()
    
    if not query:
        return jsonify({"error": "No message provided"}), 400
    
    try:
        # Retrieve relevant context
        context_chunks = retrieve(query, top_k=3)
        
        # Generate response
        response = generate_response(query, context_chunks)
        
        return jsonify({
            "response": response,
            "sources": [c["metadata"]["title"] for c in context_chunks]
        })
    
    except Exception as e:
        print(f"[RAG] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/retrieve", methods=["POST"])
def retrieve_only():
    """Retrieve relevant chunks without generating a response."""
    data = request.get_json()
    query = data.get("query", "").strip()
    top_k = data.get("top_k", 3)
    
    if not query:
        return jsonify({"error": "No query provided"}), 400
    
    try:
        results = retrieve(query, top_k=top_k)
        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    import traceback
    
    print("=" * 60)
    print("Mini-DeFi Local RAG Server")
    print("=" * 60)
    print(f"Port: {args.port}")
    print(f"Threads: {args.threads}")
    print(f"Model: {args.model or (MODEL_DIR / DEFAULT_MODEL)}")
    print("=" * 60)
    
    try:
        # Pre-initialize components
        print("\n[RAG] Initializing components...")
        init_embedding_model()
        init_vector_store()
        init_llm(args.model)
        
        print(f"\n[RAG] Server starting on http://localhost:{args.port}")
        print("[RAG] Endpoints:")
        print(f"  POST /chat     - Send message, get AI response")
        print(f"  POST /retrieve - Get relevant context chunks")
        print(f"  GET  /health   - Health check")
        print("\n" + "=" * 60)
        
        # Use threaded=False to avoid potential multiprocessing issues
        app.run(host="0.0.0.0", port=args.port, debug=False, threaded=False, use_reloader=False)
    
    except KeyboardInterrupt:
        print("\n[RAG] Server stopped by user.")
    except Exception as e:
        print(f"\n[RAG] ERROR: {e}")
        traceback.print_exc()
        input("\nPress Enter to exit...")  # Keep window open for debugging
