from engine import engine


if __name__ == "__main__":
    engine.load()
    if not engine.ready.is_set():
        raise SystemExit(engine.error or "The saved model did not load.")
    result = engine.analyze("I feel happy and excited today. I love spending time with my family.")
    print("Original BiGRU loaded and real inference completed.")
    print("Leading emotion:", result["overall"]["predicted_emotion"])
    print("Model artifact SHA-256:", result["model"]["artifact_sha256"])
