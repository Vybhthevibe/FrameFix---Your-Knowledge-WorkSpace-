import os
import httpx
import glob
import time

API_URL = "http://127.0.0.1:8000"
SAMPLE_DATA_DIR = "sample_data"

def populate():
    # Ensure backend is running
    try:
        r = httpx.get(f"{API_URL}/api/health")
        if r.status_code != 200:
            print("Backend is not healthy. Start it using: uvicorn backend.main:app --reload")
            return
    except httpx.RequestError:
        print("Backend is not running. Please start it on port 8000 before running populate.py")
        return

    # Get already uploaded files to avoid duplicates
    try:
        r = httpx.get(f"{API_URL}/api/documents")
        existing_docs = [doc['filename'] for doc in r.json().get("documents", [])]
    except Exception as e:
        print(f"Failed to fetch existing documents: {e}")
        existing_docs = []

    files_to_upload = glob.glob(f"{SAMPLE_DATA_DIR}/*.md")
    
    if not files_to_upload:
        print(f"No .md files found in {SAMPLE_DATA_DIR}/")
        return

    print(f"Found {len(files_to_upload)} sample documents. Populating...")
    
    for filepath in files_to_upload:
        filename = os.path.basename(filepath)
        if filename in existing_docs:
            print(f"Skipping {filename} (already uploaded)")
            continue
            
        print(f"Uploading {filename}...")
        with open(filepath, "rb") as f:
            files = {'file': (filename, f, 'text/markdown')}
            try:
                r = httpx.post(f"{API_URL}/api/documents/upload", files=files)
                if r.status_code == 200:
                    print(f"  Success: {filename}")
                else:
                    print(f"  Failed: {filename} - {r.text}")
            except Exception as e:
                print(f"  Error uploading {filename}: {e}")

if __name__ == "__main__":
    populate()
    print("Done.")
