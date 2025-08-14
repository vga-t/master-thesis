import Papa from "papaparse";

function loadCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(results.data);
      },
      error: (error) => {
        console.error("Error parsing CSV:", error);
        reject(error);
      }
    });
  });
}

export default loadCSV;