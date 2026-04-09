# bayesnet_tool

Design Space Exploration with Bayesian Networks

A Streamlit-based tool for designing and analyzing Bayesian networks with interactive visualization and probabilistic querying.

## Requirements

- **Python 3.11** (due to dependency constraints with pgmpy and numpy/pandas)

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd bayesnet_tool
```

### 2. Install the package with dependencies

```bash
pip install .
```

For development (editable mode):
```bash
pip install -e .
```

**Note:** Ensure you have Python 3.11 installed and active before running the above commands.

## Running the Application

Once the virtual environment is activated, start the Streamlit application:

```bash
streamlit run run.py
```

The application will open in your default browser at `http://localhost:8501`.

## Features

- **Data Loading**: Import and preprocess CSV datasets
- **Missing Data Management**: Handle NaN values with configurable thresholds
- **Structure Learning**: Discover Bayesian network structure from data
- **Discretisation**: Convert continuous variables to discrete states
- **Training**: Learn network parameters from data
- **Visualization**: Interactive network graph with topological layout
- **Probabilistic Queries**: Calculate conditional probabilities and inferences
