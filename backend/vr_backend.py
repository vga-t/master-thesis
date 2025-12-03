from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
import os

app = FastAPI()

# Keep CORS permissive for the frontend dev server.
# frontend_origin = os.getenv("FRONTEND_ORIGIN", "*")
# Ensure it fallbacks to localhost for your computer
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
allow_origins = [FRONTEND_ORIGIN] if FRONTEND_ORIGIN != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CSV = BASE_DIR / "csv" / "wine.csv"


@app.get("/")
def read_root():
    return {"status": "ok"}


@app.get("/csv")
def get_csv():
    if not DEFAULT_CSV.exists():
        raise HTTPException(status_code=404, detail="CSV file not found")
    return FileResponse(
        path=str(DEFAULT_CSV),
        media_type="text/csv",
        filename="data.csv",
    )
