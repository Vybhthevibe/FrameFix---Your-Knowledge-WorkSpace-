# FrameFix ⚡
 
FrameFix is a private, local-first AI-powered engineering knowledge assistant with a ChatGPT-inspired dark aesthetic and persistent Lightfall animation. It allows engineers to search internal technical documents, bug reports, and ADRs, and ask questions about them using RAG (Retrieval-Augmented Generation) running completely on their local machine.

## Architecture & How It Works

1. **Document Ingestion**: When you upload a `.txt` or `.md` file, the backend reads it, splits the text into small overlapping chunks, and converts these chunks into mathematical vectors (embeddings) locally using the `sentence-transformers` library (`all-MiniLM-L6-v2` model).
2. **Vector Storage**: These embeddings are stored locally in a ChromaDB database, along with metadata (like the original filename). This allows the data to persist across restarts without sending any data off-device.
3. **Semantic Search**: When you search for a term, your query is converted into an embedding locally using the same model. ChromaDB then finds the document chunks with the closest mathematical distance (cosine similarity) to your query.
4. **Local AI Answering (RAG)**: The retrieved document chunks and your question are sent to a local **Ollama** service (defaulting to the `qwen3:4b` model). The local LLM generates answers strictly from the provided internal context and adds inline numerical citations (e.g., `[S1]`) linking directly back to the source document chunks. No cloud AI provider is involved in normal question-answering.

## Prerequisites
- Python 3.11+
- Linux environment (e.g., EndeavourOS, Ubuntu, Fedora)
- [Ollama](https://ollama.com/) installed and running locally
- Ollama model `qwen3:4b` downloaded:
  ```bash
  ollama pull qwen3:4b
  ```

## Setup & Installation

1. **Activate the virtual environment**:
   ```bash
   source .venv/bin/activate
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment (Optional)**:
   The application works out of the box with default local settings (`http://localhost:11434` and model `qwen3:4b`). You can customize these in `.env`:
   ```bash
   cp .env.example .env
   # Edit .env to set OLLAMA_MODEL or OLLAMA_BASE_URL if needed
   ```

## Running the Application

1. **Ensure Ollama is running**:
   ```bash
   ollama serve
   ```

2. **Start the backend server**:
   ```bash
   source .venv/bin/activate
   uvicorn backend.main:app --reload
   ```

3. **Access the application**:
   Open your browser and navigate to: http://127.0.0.1:8000/

4. **Populate Sample Data**:
   To test the application immediately with sample engineering documents:
   ```bash
   source .venv/bin/activate
   python populate.py
   ```

## Testing

To run the automated tests:
```bash
pytest tests/
```

## Security & Privacy Note
🔒 **Local-First & Private**:
- Questions and retrieved document excerpts are sent strictly to your local Ollama service (`http://localhost:11434`).
- Embeddings and vector searches run 100% locally on CPU/GPU via `sentence-transformers` and ChromaDB.
- No question content, retrieved documentation, or internal code is sent to Google Gemini or any cloud AI API.
- There is no silent cloud fallback.
- External network requests only occur if you explicitly download dependencies or pull new Ollama models.
