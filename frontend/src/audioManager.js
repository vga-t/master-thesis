export class AudioManager {
    constructor() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Speech recognition not supported in this browser.");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.isRecording = false;

        this.recognition.continuous = true;
        this.recognition.lang = "en-US";
        this.recognition.interimResults = false;
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = (event) => {
            let fullTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    fullTranscript += event.results[i][0].transcript.trim() + " ";
                }
            }

            if (fullTranscript && this.onTranscript) {
                this.onTranscript(fullTranscript.trim());
            }
        };

        this.recognition.onend = () => {
            if (this.isRecording) {
                this.recognition.start();
            }
        };

        this.recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
        };
        this.onTranscript = null;
    }

    start() {
        if (!this.recognition || this.isRecording) return;
        try {
            this.recognition.start();
            this.isRecording = true;
            console.log("Speech recognition started.");
        } catch (error) {
            console.error("Error starting speech recognition:", error);
        }
    }

    stop() {
        if (!this.recognition || !this.isRecording) return;
        this.recognition.stop();
        this.isRecording = false;
        console.log("Speech recognition stopped.");
    }

    toggleRecording() {
        if (this.isRecording) {
            this.stop();
        } else {
            this.start();
        }
    }
}

export default AudioManager;