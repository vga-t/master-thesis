from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
import tempfile
import shutil
import os
import sys

# Add parent directory to path to import state and ai_service
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from state import provenance_manager
from ai_service import generate_response

router = APIRouter()

class Command(BaseModel): 
    text: str

@router.post("/process")
def process_command(command: Command):
    user_text = command.text
    print(f"Received command: {user_text}")
    response_data={"message":user_text+"-----from backend"}
    return response_data

@router.post("/process-audio")
async def process_audio(file: UploadFile = File(...)):
    # Save audio to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_audio:
        shutil.copyfileobj(file.file, temp_audio)
        temp_audio_path = temp_audio.name
    
    try:
        # Get current columns for context
        df_columns = ", ".join(provenance_manager.get_current_df().columns)
        
        # Call AI Service
        response_data = generate_response(temp_audio_path, df_columns)
        
        generated_code = response_data.get("code", "")
        explanation = response_data.get("explanation", "Processed successfully")
        
        print(f"Generated Code: {generated_code}")
        print(f"Explanation: {explanation}")
        
        if generated_code:
            # Execute Code
            current_df = provenance_manager.get_current_df()
            original_df = provenance_manager.get_initial_df()
            
            local_scope = {
                "df": current_df.copy(),
                "original_df": original_df.copy()
            }
            
            try:
                exec(generated_code, {}, local_scope)
                new_df = local_scope["df"]
                
                # Update Provenance
                provenance_manager.update_state(new_df)
            except Exception as exec_error:
                print(f"Execution Error: {exec_error}")
                explanation = f"I generated code, but it failed to execute: {str(exec_error)}"
        
        return {"message": explanation, "code": generated_code}
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
