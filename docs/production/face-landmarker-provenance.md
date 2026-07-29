# Face Landmarker model provenance

- Runtime path: `public/mediapipe/models/face_landmarker.task`
- Upstream: Google MediaPipe model storage
- Source: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- Retrieved: 2026-07-29
- Upstream object generation: `1683136941916318`
- Bytes: `3,758,596`
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- Upstream ETag: `b0e7274907a1644404fef66b28dd6d85`

The model is loaded from the game's own origin at runtime. Camera frames and
the full face mesh remain on-device. Only a ten-number V2 gaze feature vector,
bilateral blink scores, two bounded iris/eye preview contours and numeric
quality diagnostics cross the local worker boundary. None are uploaded or used
as an identity or biometric template.
