import os
from provenance import ProvenanceManager

# Initialize with the default CSV
CSV_PATH = os.path.join(os.path.dirname(__file__), "csv/nasa_engine_clean.csv")
provenance_manager = ProvenanceManager(CSV_PATH)
