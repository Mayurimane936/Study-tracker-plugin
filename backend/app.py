
from fastapi import FastAPI

app = FastAPI(
    title="StudyTrack API",
    description="Backend for the StudyTrack browser extension",
    version="1.0.0",
)


@app.get("/")
def home():
    return {
        "message": "Welcome to StudyTrack!",
        "status": "running",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
    }