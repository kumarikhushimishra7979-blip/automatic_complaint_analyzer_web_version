# Trained Machine Learning Model Artifact

This directory stores the serialized machine learning model artifact (`trained_model.json`) used by the Automatic Customer Complaint Analysis System for local offline inference.

- **Algorithm**: TF-IDF Vectorizer + Multinomial Logistic Regression + Cosine Similarity Calibration
- **Candidate Group Discovery**: Spherical KMeans Clustering + Cosine Similarity Cohesion Scoring
- **Default Confidence Threshold**: `0.40` (configurable via `CONFIDENCE_THRESHOLD` in `.env`)
- **Minimum Cluster Size**: `2` (configurable via `MIN_CLUSTER_SIZE` in `.env`)

To regenerate the baseline model artifact after updating the training corpus, run:

```bash
npx tsx server/ml/train_initial_model.ts
```

During normal application execution, the backend strictly loads and caches the existing artifact from `MODEL_PATH` without retraining.
