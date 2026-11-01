import os
import uuid
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from backend.rag import RAGSystem
from backend.database import ChatDatabase

app = FastAPI(title="EngiMemory API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure upload directory exists
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Initialize RAG System (this loads the embedding model)
rag = RAGSystem()

# Initialize Persistent Chat Database (SQLite)
db = ChatDatabase()

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5

class AskRequest(BaseModel):
    query: str
    top_k: int = 5
    conversation_id: Optional[str] = None

class ConversationCreate(BaseModel):
    title: Optional[str] = None

class ConversationUpdate(BaseModel):
    title: str

@app.get("/api/conversations")
def list_conversations():
    """List all previous conversations sorted by most recently updated."""
    try:
        conversations = db.list_conversations()
        return {"conversations": conversations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/conversations")
def create_conversation(req: Optional[ConversationCreate] = None):
    """Create a new conversation."""
    try:
        title = (req.title.strip() if req and req.title and req.title.strip() else "New Conversation")
        conv = db.create_conversation(title=title)
        return conv
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str):
    """Fetch an existing conversation with its messages and grounding sources (database read only)."""
    try:
        conv = db.get_conversation(conv_id)
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conv
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/conversations/{conv_id}")
def update_conversation(conv_id: str, req: ConversationUpdate):
    """Rename a conversation."""
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    try:
        conv = db.update_conversation_title(conv_id, title)
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conv
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str):
    """Delete a conversation and its messages."""
    try:
        success = db.delete_conversation(conv_id)
        if not success:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"status": "success", "id": conv_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
def health_check():
    ollama_ready = rag.is_available()
    return {
        "status": "ok",
        "ollama_configured": ollama_ready,
        "ollama_model": rag.ollama_model,
        "ollama_url": rag.ollama_base_url,
        "gemini_configured": False,
    }

@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.endswith(('.txt', '.md')):
        raise HTTPException(status_code=400, detail="Only .txt and .md files are supported.")
    
    try:
        content = await file.read()
        text = content.decode('utf-8')
        
        # Save file to disk
        file_id = str(uuid.uuid4())
        safe_filename = file.filename.replace(" ", "_")
        file_path = os.path.join(UPLOAD_DIR, f"{file_id}_{safe_filename}")
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(text)
            
        # Add to RAG system
        rag.add_document(text, file.filename, file_id)
        
        return {"status": "success", "filename": file.filename, "id": file_id}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents")
def list_documents():
    """Returns a list of uploaded documents based on the upload folder."""
    docs = []
    if os.path.exists(UPLOAD_DIR):
        for f in os.listdir(UPLOAD_DIR):
            if f.endswith(('.txt', '.md')):
                parts = f.split("_", 1)
                if len(parts) == 2:
                    docs.append({"id": parts[0], "filename": parts[1]})
                else:
                    docs.append({"id": "unknown", "filename": f})
    return {"documents": docs}

@app.post("/api/search")
def search_documents(req: SearchRequest):
    try:
        results = rag.search(req.query, req.top_k)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ask")
def ask_question(req: AskRequest):
    try:
        # 1. Resolve or create conversation
        conv_id = req.conversation_id
        if conv_id:
            conv = db.get_conversation(conv_id)
            if not conv:
                title = db.generate_title_from_query(req.query)
                db.create_conversation(title=title, conv_id=conv_id)
            elif conv.get("title") == "New Conversation" and len(conv.get("messages", [])) == 0:
                db.update_conversation_title(conv_id, db.generate_title_from_query(req.query))
        else:
            title = db.generate_title_from_query(req.query)
            new_conv = db.create_conversation(title=title)
            conv_id = new_conv["id"]

        # 2. Persist user question
        db.add_message(conv_id=conv_id, role="user", content=req.query)

        # 3. Retrieve context via RAG
        search_results = rag.search(req.query, req.top_k)
        
        # 4. Generate answer via Ollama
        answer = rag.generate_answer(req.query, search_results)
        
        # 5. Persist assistant answer and source metadata if generation did not fail
        if not answer.startswith("Error generating answer"):
            db.add_message(conv_id=conv_id, role="assistant", content=answer, sources=search_results)
        else:
            # Still update conversation timestamp so it surfaces as latest
            db.touch_conversation(conv_id)

        return {
            "answer": answer,
            "sources": search_results,
            "conversation_id": conv_id
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files at the root
# Note: ensure 'static' directory exists in the root
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
