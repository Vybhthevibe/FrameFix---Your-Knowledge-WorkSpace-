#!/bin/bash
set -e

# Change to the script directory
cd "$(dirname "$0")"

echo "Checking environment..."
if [ -d ".venv" ]; then
    echo "Activating .venv virtual environment..."
    source .venv/bin/activate
elif [ -d "venv" ]; then
    echo "Activating venv virtual environment..."
    source venv/bin/activate
else
    echo "Creating virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
fi

echo "Installing dependencies..."
pip install -r requirements.txt

echo "Starting backend server in the background..."
uvicorn backend.main:app --reload &
UVICORN_PID=$!

echo "Waiting for backend to start..."
sleep 3

echo "Populating sample data..."
python populate.py

echo "----------------------------------------------------"
echo "FrameFix is running!"
echo "Access the frontend at: http://127.0.0.1:8000"
echo "----------------------------------------------------"

# Wait for uvicorn to exit
wait $UVICORN_PID
