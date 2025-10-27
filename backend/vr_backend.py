from fastapi import FastAPI
import os
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse 
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()
class Command(BaseModel): 
    text: str
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN")
GEMINI_API_KEY = os.getenv("Gemini_api_key")
print(GEMINI_API_KEY)
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
    csv_path = os.path.join(os.path.dirname(__file__),"csv/mdlon.csv")  
    if os.path.exists(csv_path):
        return FileResponse(csv_path, media_type='text/csv', filename='mdlon.csv')
    else:
        return {"error": "CSV file not found"}
@app.post("/process")
def process_command(command: Command):
    user_text = command.text
    print(f"Received command: {user_text}")
    response_data={"message":user_text+"-----from backend"}
    return response_data