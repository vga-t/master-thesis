export class AudioManager {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.onAudioData = null;
    }

    async start() {
        if (this.isRecording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                if (this.onAudioData) {
                    this.onAudioData(audioBlob);
                }
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            console.log("Audio recording started.");
        } catch (error) {
            console.error("Error starting audio recording:", error);
        }
    }

    stop() {
        if (!this.mediaRecorder || !this.isRecording) return;
        this.mediaRecorder.stop();
        this.isRecording = false;
        console.log("Audio recording stopped.");
    }

    toggleRecording() {
        if (this.isRecording) {
            this.stop();
        } else {
            this.start();
        }
    }

    generateSpeech(message) {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 0.8;
        speechSynthesis.speak(utterance);
    }
}

export default AudioManager;