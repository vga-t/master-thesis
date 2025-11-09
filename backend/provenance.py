import pandas as pd
import os
import shutil

class ProvenanceManager:
    def __init__(self, initial_csv_path):
        self.initial_csv_path = initial_csv_path
        self.session_dir = os.path.join(os.path.dirname(__file__), "sessions")
        
        # Ensure clean session start
        if os.path.exists(self.session_dir):
            try:
                shutil.rmtree(self.session_dir)
            except Exception as e:
                print(f"Warning: Could not clean session dir: {e}")
        
        if not os.path.exists(self.session_dir):
            os.makedirs(self.session_dir)
        
        self.current_step = 0
        
        if os.path.exists(initial_csv_path):
            self.initial_df = pd.read_csv(initial_csv_path)
            self._save_step(self.initial_df, 0)
        else:
            self.initial_df = pd.DataFrame()
            print(f"Warning: Initial CSV not found at {initial_csv_path}")
            
    def _get_step_path(self, step):
        return os.path.join(self.session_dir, f"step_{step}.csv")
        
    def _save_step(self, df, step):
        df.to_csv(self._get_step_path(step), index=False)
        
    def get_current_df(self):
        # Read from the current step file to ensure we have the exact state
        return pd.read_csv(self._get_step_path(self.current_step))
    
    def get_initial_df(self):
        return self.initial_df.copy()
    
    def push_state(self):
        # In file-based approach, push_state is implicit when we increment step and save
        pass
        
    def update_state(self, new_df):
        self.current_step += 1
        self._save_step(new_df, self.current_step)
        
    def undo(self):
        if self.current_step > 0:
            self.current_step -= 1
            return True
        return False
        
    def reset(self):
        # Treat reset as a new state that copies initial data
        self.update_state(self.initial_df.copy())
