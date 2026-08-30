# Extracted Features Dataset for Prosodic Boundary Prediction for Children's Text

This document describes the features extracted for prosodic boundary prediction in children's reading materials. The features are organized into several categories that capture different aspects of linguistic structure and cognitive processing.

**Note:** These features correspond directly to the annotation data in the [data](data/README.md) folder. Each row in this features CSV can be matched to the prosodic boundary annotations using the StoryID and TokenID columns, which are consistent across both datasets.


## Dataset Structure

Each row in the features CSV represents a single word/token with its extracted features:

```
StoryID,TokenID,GT,GT_isboundary,GT_boundary_forbidden,[feature_columns...]
```

## Feature Categories

Alh the features and their purpose is explained in detail in the paper.

### Core Identification Features

| Column | Description | Example Values |
|--------|-------------|----------------|
| `StoryID` | Unique identifier for the story | G7S1 |
| `TokenID` | Unique identifier for the token within story | G7010001 |
| `GT` | Number of annotators (0-7) who marked a pause after this word | 0, 3, 7 |
| `GT_isboundary` | Labeled 1 (boundary) if more than 5 annotators mark it as a boundary; otherwise, it is labeled 0 | 1, 0 |
| `GT_boundary_forbidden` | Labeled 1 (forbidden pause) if no annotators mark it as a boundary; otherwise, it is labeled 0 | 1, 0 |

### Lexical Features

| Column | Description | Type | Example |
|--------|-------------|------|---------|
| `is_last` | Binary flag indicating if word is last in sentence | Boolean | TRUE/FALSE |
| `followed_by_punct` | Integer indicating the type of punctuation that follows the word (if any) |  Integer | 0-7 |
| `word_length` | Number of characters in the word | Integer | 5 |
| `is_capitalized` | Whether word begins with capital letter | Boolean | TRUE/FALSE |
| `is_function_word` | Binary flag for function words (pronouns, determiners, conjunctions) | Boolean | TRUE/FALSE |
| `raw_frequency` | Frequency of word in the dataset | Integer | 35 |
| `language_model_score` | BERT likelihood score for word predictability | Float | -2.127 |

### Semantic Features (Word Embeddings)

| Column | Description | Type | Example |
|--------|-------------|------|---------|
| `cluster_id` | K-means cluster ID of word's reduced BERT embedding | Integer | 2 |
| prev_cluster_id, next_cluster_id | K-means cluster ID of neighbouring words | Integer | 4 |

### POS Features

| Column | Description | Type | Example |
|--------|-------------|------|---------|
| `pos_tag` | Part-of-speech tag | Text | PRON, VERB, NOUN |
| `dep_tag` | Dependency label | Text | nsubj, root, det |
| `tag` | Fine-grained morphological POS tag | Text | PRP, VBD, DT |
| `prev_(1,2,3)_pos`, `prev_(1,2,3)_dep`, `next_(1,2,3)_pos`, `next_(1,2,3)_dep` | POS tag and dependency label of neighbouring words upto a context window of 3 tokens | Text | PRON, VERB, NOUN, root, det |

### Syntactic Structure Features

| Column | Description | Type | Example |
|--------|-------------|------|---------|
| `tree_depth` | Depth in dependency tree | Integer | 3 |
| `tree_width` | Width of syntactic subtree | Integer | 5 |
| `depth_in_tree` | Depth in constituency tree | Integer | 4 |
| `distance_from_root` | Distance from root in dependency tree | Integer | 2 |
| `smallest_constituent_label` | Label of smallest syntactic constituent | Text | NP, VP, PP |
| `smallest_constituent_length` | Length of smallest constituent | Integer | 2 |
| `is_constituent_chunk_end` | Whether word ends a syntactic chunk | Boolean | TRUE/FALSE |
| `distance_from_phrase_head` | Dependency hops from phrase head | Integer | 1 |
| `forward_position` | Position within constituent (from start) | Integer | 0 |
| `backward_position` | Position within constituent (from end) | Integer | 1 |
| `min_span_tree_label_with_next` | Minimal spanning tree label to next word | Text | S, VP |
| `min_span_tree_length_with_next` | Length of minimal spanning tree to next word | Integer | 3 |

### Positional Features

| Column | Description | Type | Example |
|--------|-------------|------|---------|
| `sentence_position` | Absolute word index in sentence (0-based) | Integer | 0, 5, 12 |
| `sentence_length` | Total words in sentence | Integer | 15 |

### Physiological Features (Child-Specific)

| Column | Description | Type | Example |
|--------|-------------|------|---------|
| `num_syllables` | Number of syllables in current word | Integer | 2 |
| `syllables_since_last_major_boundary_child` | Syllables accumulated since last major boundary | Integer | 4 |
| `syllables_remaining_till_breath_child` | Syllables remaining to reach breath threshold (7 syllables) | Integer | 3 |

## Missing Values

Some features may have missing values (represented as empty cells) when:
- Syntactic parsing fails for complex structures
- Word is at sentence/document boundaries (no previous/next context)
- Constituency parsing produces incomplete trees

## Usage Notes

- All boolean features use TRUE/FALSE values
- Numeric features are not normalized - apply scaling as needed for your model
- The `_child` suffix on physiological features indicates they're calibrated for children aged 6-12
- Features are extracted using [spaCy](https://spacy.io/) and [Berkeley Natural Parser Usage](https://github.com/nikitakit/self-attentive-parser/tree/master) for POS/dependency parsing and custom algorithms for syntactic structure.

## Citation

If you use these features in your research, please cite the original paper:

```bibtex
@inproceedings{
  dhamne2025predicting,
  title={Predicting Prosodic Boundaries for Children{\textquoteright}s Texts},
  author={Mansi Dhamne and Sneha Raman and Preeti Rao},
  booktitle={The 2025 Conference on Empirical Methods in Natural Language Processing},
  year={2025}
}
```
