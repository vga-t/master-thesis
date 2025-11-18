import os
from provenance import ProvenanceManager

# Initialize with the default CSV
CSV_PATH = os.path.join(os.path.dirname(__file__), "csv/mdlon.csv")
provenance_manager = ProvenanceManager(CSV_PATH)
