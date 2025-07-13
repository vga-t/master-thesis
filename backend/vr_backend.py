from fastapi import FastAPI
import os
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN")
GEMINI_API_KEY = os.getenv("Gemini_api_key")
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"Hello": "Guys"}

@app.get("/process")
def read_root():
    return {"data": "no data currently"}