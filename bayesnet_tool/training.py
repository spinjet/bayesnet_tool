"""Model training and inference abstraction over pgmpy.

Encapsulates the creation and fitting of a DiscreteBayesianNetwork, the
application of uniform priors, and exposes a simple query interface.
"""

from typing import Any, Dict, List


class BayesianNetworkModel:
    def __init__(self, edges: List[tuple]):
        self.edges = edges
        self.model = None
        self.infer = None

    def fit(self, df: Any, estimator: Any = None, **kwargs) -> None:
        """Fit the underlying pgmpy model to the provided dataframe."""
        raise NotImplementedError

    def apply_uniform_priors(self, node_config: Dict[str, Any]) -> None:
        """Override CPDs on nodes marked for uniform prior."""
        raise NotImplementedError

    def query(self, variables: List[str], evidence: Dict[str, Any] = None) -> Any:
        """Perform inference and return a factor or distribution object."""
        raise NotImplementedError
