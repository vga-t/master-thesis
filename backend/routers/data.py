from fastapi import APIRouter
from fastapi.responses import StreamingResponse
import io
import sys
import os

# Add parent directory to path to import state
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from state import provenance_manager

router = APIRouter()

@router.get("/csv")
def get_csv():
    stream = io.StringIO()
    provenance_manager.get_current_df().to_csv(stream, index=False)
    response = StreamingResponse(iter([stream.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=data.csv"
    return response

@router.post("/undo")
def undo_state():
    if provenance_manager.undo():
        return {"message": "Undone successfully"}
    else:
        return {"message": "Nothing to undo"}
