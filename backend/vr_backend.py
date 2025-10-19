from fastapi import FastAPI
import os
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse 
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
    return "Hello"

@app.get("/csv")
def get_csv():
    csv_path = os.path.join(os.path.dirname(__file__),"csv/Leukemia.csv")  
    if os.path.exists(csv_path):
        return FileResponse(csv_path, media_type='text/csv', filename='Leukemia.csv')
    else:
        return {"error": "CSV file not found"}

@app.get("/process")
def read_root():
    return {"data": "no data currently"}