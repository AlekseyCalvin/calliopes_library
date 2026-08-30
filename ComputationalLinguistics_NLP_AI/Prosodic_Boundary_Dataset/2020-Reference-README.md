# Prosodic-Boundary-Prediction-Children-Dataset

This repository contains the dataset and resources accompanying the paper "Predicting Prosodic Boundaries for Children's Texts" accepted at EMNLP 2025.

## Overview

Reading fluency requires not only accurate word decoding but also natural prosodic phrasing—the grouping of words into rhythmically and syntactically coherent units. While adults pause meaningfully at clause or punctuation boundaries, children aged 7–12 often insert inappropriate pauses due to limited breath control and underdeveloped prosodic awareness.

This work presents the dataset used to predict cognitively appropriate pause locations in children's reading material, addressing a crucial yet underexplored dimension in reading comprehension and fluency assessment.

## Repository Structure

```
├── annotations/                   # Prosodic boundary annotations
│   ├── Batch-1.csv                # 18 stories (3 per grade)
│   ├── Batch-2.csv                # 18 stories (3 per grade)  
│   ├── Batch-3.csv                # 18 stories (3 per grade)
│   └── README.md                  # Data format and annotation details
├── features/                      # Extracted linguistic features
│   ├── features.csv               # Complete feature dataset
│   └── README.md                  # Feature descriptions and usage
└── README.md      
```

## Getting Started

### Repository Structure

The repository is organized into two main components:

1. **[Prosodic Boundary Annotations](annotations/README.md)**: Human-annotated pause locations with detailed annotation guidelines.

2. **[Extracted Features](features/README.md)**: Comprehensive linguistic features ready for machine learning, including lexical, syntactic, semantic, positional, and child-specific physiological features.

### Tasks Supported

This dataset enables research on three key tasks:

1. **Boundary Strength Regression**: Predict continuous pause likelihood (0-7 annotator votes)
2. **Binary Boundary Detection**: Determine whether a prosodic boundary is present or absent. A word is labeled **1 (boundary)** if more than 5 annotators mark it as a boundary; otherwise, it is labeled **0**.
3. **Forbidden Pause Detection**: Detect positions where pauses would be inappropriate. A word is labeled **1 (forbidden pause)** if no annotators mark it as a boundary; otherwise, it is labeled **0.**

## Applications

### Educational Technology
- **Automated reading assessment** systems for oral reading fluency
- **Personalized feedback** for reading comprehension and phrasing
- **Adaptive learning platforms** that adjust to student reading levels

### Speech Technology
- **Child-directed TTS systems** with natural prosodic phrasing
- **Reading companion applications** for language learning
- **Accessibility tools** for struggling readers

### Research Areas
- Developmental linguistics and reading acquisition
- Prosodic processing in second language learning
- Cross-linguistic prosodic boundary prediction

## Model Performance

Our LightGBM-based models achieve:

| Task | Metric | Performance |
|------|--------|-------------|
| Boundary Strength Regression | R² | 0.87 |
| | RMSE | 0.94 |
| | MAE | 0.57 |
| Prosodic Boundary Detection | F1-score | 0.89 |
| | Accuracy | 0.96 |
| Forbidden Pause Detection | F1-score | 0.87 |
| | Accuracy | 0.84 |

## Citation

If you use this dataset or build upon this work, please cite:

```bibtex
@inproceedings{dhamne2025predicting,
  title={Predicting Prosodic Boundaries for Children's Texts},
  author={Mansi Dhamne and Sneha Raman and Preeti Rao},
  booktitle={The 2025 Conference on Empirical Methods in Natural Language Processing},
  year={2025}
}
```

## Contact

For questions about this dataset or research collaboration:

- **Mansi Dhamne**: mansi.dhamne22@spit.ac.in
- **Sneha Raman**: sneha.r30@gmail.com
- **Preeti Rao**: prao@ee.iitb.ac.in

## Acknowledgments

We thank the Central Institute of English and Foreign Languages (CIEFL) for developing the original English 400 Reading Programme materials that form the basis of this annotation dataset. We also acknowledge our 21 volunteer annotators whose careful work made this research possible.

## License

This dataset is released for research purposes. Please see individual data files for specific licensing information.
