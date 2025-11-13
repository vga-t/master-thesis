import google.generativeai as genai
import os
from dotenv import load_dotenv
import json

load_dotenv()
GEMINI_API_KEY = os.getenv("Gemini_api_key")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found in environment variables.")

def generate_response(audio_path, df_columns):
    if not GEMINI_API_KEY:
        raise Exception("Gemini API Key not configured")

    myfile = genai.upload_file(audio_path)
    
    model = genai.GenerativeModel("gemini-2.0-flash")
    
    prompt = f"""
    You are the intelligent backend for a VR data visualization system.
    I have a pandas DataFrame named `df` (current state) with the following columns: {df_columns}.
    I also have a DataFrame named `original_df` which contains the initial, unmodified dataset.
    The frontend automatically renders whatever data is in `df` using specialized VR visualizations (heatmap, two-tone, parallel coordinates, line charts).
    
    The user has provided a voice command to transform this data.
    
    Your task is to:
    1. Generate Python code that manipulates the `df` variable to satisfy the user's request.
    2. Generate a clear, natural language explanation of what you did.
    
    CRITICAL RULES:
    - The code MUST update the `df` variable (e.g., `df = df[...]`, `df['new_col'] = ...`).
    - If the user asks to "reset", "show all", "clear filters", or "start over", you MUST set `df = original_df.copy()`.
    - If the user asks for a filter that implies starting from the full dataset (e.g., "Show me X" when the current view is already filtered to Y), consider using `original_df` as the source.
    - Do NOT generate any visualization code (no matplotlib, no seaborn, no plots, no charts). The VR frontend handles ALL visualizations including embedded charts like parallel coordinates and line charts.
    - Do NOT print anything.
    - Focus only on data transformations: filtering, sorting, aggregation, column creation, etc.
    - The "explanation" is VERY IMPORTANT. It will be spoken to the user. It must clearly state how the data was changed so the user understands the new state of the visualization.
    
    Return a JSON object with exactly two keys:
    1. "code": The Python code string.
    2. "explanation": The spoken feedback string.
    
    Example JSON:
    {{
        "code": "df = df[df['RUL'] > 100]",
        "explanation": "I have filtered the dataset to only show engines with a Remaining Useful Life greater than 100."
    }}
    
    Return ONLY the JSON string. Do not use markdown formatting.
    """
    
    result = model.generate_content([myfile, prompt])
    response_text = result.text.strip()
    
    # Clean up potential markdown formatting if the model ignores instructions
    if response_text.startswith("```json"):
        response_text = response_text[7:]
    if response_text.startswith("```"):
        response_text = response_text[3:]
    if response_text.endswith("```"):
        response_text = response_text[:-3]
        
    try:
        response_data = json.loads(response_text.strip())
        return response_data
    except json.JSONDecodeError:
        # Fallback if JSON parsing fails
        print(f"Failed to parse JSON: {response_text}")
        return {
            "code": "", 
            "explanation": "I'm sorry, I couldn't process that command correctly."
        }
