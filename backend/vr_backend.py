from fastapi import FastAPI
import os
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from routers import data, processing

load_dotenv()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(processing.router)

@app.get("/")
def read_root():
    return "Hello"
